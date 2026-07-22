import * as Actions from '@/services/background-actions'
import { updateBadge } from '@/services/background-actions'
import { Browser } from '@/services/background-browser'
import { coordinateCommand } from '@/services/background-command-coordinator'
import {
  isCommandOwnedTabRemoval,
  isCommandOwnedTabRelocation,
  isCommandOwnedWindowRemoval,
} from '@/services/background-command-removal'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Tree } from '@/services/background-tree'
import { initializeSessionTreePort } from '@/services/runtime-port-service'
import * as SessionRestore from '@/services/background-session-restore'
import { Selection } from '@/services/selection'
import { Settings } from '@/services/settings'
import * as Messages from '@/types/messages'
import type { SessionTreeCommandResult } from '@/types/runtime-port-service'
import {
  LoadingStatus,
  State,
  Tab,
  TreeItemType,
  Window,
  WindowChild,
} from '@/types/session-tree'

interface PendingDetachedTab {
  tab: Tab
  token: symbol
}

const pendingDetachedTabs = new Map<number, PendingDetachedTab>()
const pendingGroupedTabRemovals = new Map<
  number,
  Array<{
    tabId: number
    removeInfo: browser.tabs._OnRemovedRemoveInfo
  }>
>()
const pendingRemovedGroups = new Map<
  number,
  {
    group: browser.tabGroups.TabGroup
    removeInfo: browser.tabGroups._RemoveInfo
  }
>()
const pendingGroupRemovalTimers = new Map<
  number,
  {
    timer: ReturnType<typeof setTimeout>
    token: symbol
  }
>()
const pendingTabCreations = new Map<number, symbol>()
const pendingWindowMoves = new Map<number, symbol>()

// ==============================
// Event Listeners
// ==============================
let containerListenersInitialized = false

export function initializeContainerListeners(): void {
  const contextualIdentities = browser.contextualIdentities
  if (containerListenersInitialized || !contextualIdentities) return

  contextualIdentities.onCreated.addListener(Tree.containerCreated)
  contextualIdentities.onRemoved.addListener(Tree.containerRemoved)
  contextualIdentities.onUpdated.addListener(Tree.containerUpdated)
  containerListenersInitialized = true
}

export function initializeListeners() {
  initializeContainerListeners()
  initializeSessionTreePort({
    dispatchCommand,
    getSnapshot: () => Tree.Items,
  })

  browser.browserAction.onClicked.addListener(browserActionOnClicked)
  browser.menus.onHidden.addListener(onContextMenuHidden)
  browser.runtime.onInstalled.addListener(updateBadge)
  browser.runtime.onMessage.addListener(onMessage)
  browser.runtime.onStartup.addListener(updateBadge)
  browser.tabs.onActivated.addListener(tabsOnActivated)
  browser.tabs.onAttached.addListener(tabsOnAttached)
  browser.tabs.onCreated.addListener(updateBadge)
  browser.tabs.onCreated.addListener(tabsOnCreated)
  browser.tabs.onDetached.addListener(tabsOnDetached)
  browser.tabs.onMoved.addListener(tabsOnMoved)
  browser.tabs.onRemoved.addListener(updateBadge)
  browser.tabs.onRemoved.addListener(tabsOnRemoved)
  browser.tabs.onUpdated.addListener(tabsOnUpdated)
  browser.tabs.onUpdated.addListener(tabsOnUpdatedFavicon)
  browser.tabGroups.onCreated.addListener(tabGroupsOnCreatedOrUpdated)
  browser.tabGroups.onMoved.addListener(Tree.tabGroupMoved)
  browser.tabGroups.onRemoved.addListener(tabGroupsOnRemoved)
  browser.tabGroups.onUpdated.addListener(tabGroupsOnCreatedOrUpdated)
  browser.windows.onCreated.addListener(windowsOnCreated)
  browser.windows.onFocusChanged.addListener(windowsOnFocusChanged)
  browser.windows.onRemoved.addListener(windowsOnRemoved)
}

/**
 * Event listener for when a tab is updated. This is used to detect when a tab's favicon is updated.
 * When a favicon is updated, a message is sent to the Vue component to update the favicon in the cache.
 * This is done in the SessionTree.vue file.
 *
 */
async function tabsOnUpdatedFavicon(
  tabId: number,
  changeInfo: browser.tabs._OnUpdatedChangeInfo,
  tab: browser.tabs.Tab,
): Promise<void> {
  if (browser.extension.getViews().length === 0 || tab.status !== 'complete') {
    return
  }

  let authoritativeTab = tab
  if (changeInfo.status === LoadingStatus.COMPLETE) {
    try {
      const currentTab = await browser.tabs.get(tabId)
      if (currentTab.id !== tabId || currentTab.windowId !== tab.windowId) {
        return
      }
      authoritativeTab = currentTab
    } catch (error) {
      console.debug('Failed to refresh completed favicon update:', error)
    }
  }
  if (authoritativeTab.status !== 'complete') return

  const message = authoritativeTab.favIconUrl
    ? {
        type: 'FAVICON_UPDATED',
        favIconUrl: authoritativeTab.favIconUrl,
        tab: authoritativeTab,
      }
    : {
        type: 'FAVICON_CLEARED',
        pageUrl: authoritativeTab.url,
      }
  window.browser.runtime.sendMessage(message).catch(() => {
    console.debug('No receivers for favicon update')
  })
}

/**
 * When a window is created, add it to the session tree.
 * If the window is created by the extension, do nothing as it is already in the session tree.
 */
async function windowsOnCreated(window: browser.windows.Window): Promise<void> {
  if (window.id === undefined) {
    console.error('Window ID is undefined')
    return
  }
  SessionRestore.beginWindowClassification(window.id)
  let disposition: SessionRestore.WindowCreationDisposition = 'new-window'
  try {
    const extensionWindow = await OnCreatedQueue.isNewWindowExtensionGenerated(
      window.id,
    )
    if (extensionWindow) {
      disposition = 'extension-generated'
      return
    }
    if (window.type !== undefined && window.type !== 'normal') {
      disposition = 'ignored-window'
      return
    }
    if (await SessionRestore.handleCreatedWindow(window)) {
      disposition = 'restored-window'
    } else {
      await Tree.addWindow(window.id)
    }
  } finally {
    SessionRestore.finishWindowClassification(window.id, disposition)
  }
}

/**
 * When a window is removed, remove it from the session tree.
 * If the window is saved, do nothing.
 * If the window has saved tabs, save the window instead of removing.
 * If the window only has 1 tab, save the window instead of removing.
 */
function windowsOnRemoved(windowId: number): void {
  if (isCommandOwnedWindowRemoval(windowId)) return
  Tree.removeSessionWindowId(windowId)
  const window = Tree.Items.filter(Tree.isWindow).find((w) => w.id === windowId)
  if (!window) {
    return
  }
  if (window.state === State.SAVED) {
    return
  }
  // if window has saved tabs, save the window instead of removing
  const windowTabs = Tree.getTabs(window.children)
  const savedTabs = windowTabs.filter((tab) => tab.state === State.SAVED)
  const tabCount = windowTabs.length
  if (
    tabCount > 0 &&
    (Settings.values.saveWindowOnClose ||
      (savedTabs.length > 0 &&
        Settings.values.saveWindowOnCloseIfContainsSavedTabs) ||
      (Settings.values.saveWindowOnCloseIfPreviouslySaved &&
        window.savedTime! > 0))
  ) {
    Tree.saveWindow(window.uid)
    return
  }

  // if windows has existing notes, save window instead of removing
  const windowNotes = window.children.filter(Tree.isNote)
  if (
    windowNotes.length > 0 &&
    Settings.values.saveWindowOnCloseIfContainsNotes
  ) {
    Tree.saveWindow(window.uid)
    return
  }

  // if this window only has 1 tab, then save the window instead of removing
  if (tabCount === 1) {
    const openTab = windowTabs.filter((tab) => tab.state === State.OPEN)[0]
    if (!openTab) {
      Tree.removeWindow(window.uid)
      return
    }
    // if settings set to save tab on close
    if (
      Settings.values.saveTabOnClose ||
      (Settings.values.saveTabOnCloseIfPreviouslySaved &&
        openTab.savedTime! > 0)
    ) {
      Tree.saveWindow(window.uid)
      return
    }
  }
  Tree.removeWindow(window.uid)
}

/**
 * When a tab is created, add it to the session tree.
 * If the tab is created by the extension, do nothing as it is already in the session tree.
 */
async function tabsOnCreated(tab: browser.tabs.Tab): Promise<void> {
  console.debug('Tab Created:', tab)
  if (tab.windowId === undefined || tab.id === undefined) {
    console.error('Tab or Window ID is undefined')
    return
  }
  const tabId = tab.id
  const windowId = tab.windowId
  const creationToken = Symbol(`tab-created-${tabId}`)
  pendingDetachedTabs.delete(tabId)
  pendingTabCreations.set(tabId, creationToken)
  try {
    const trackedWindow = Tree.Items.filter(Tree.isWindow).find(
      (window) => window.id === tab.windowId,
    )
    if (!trackedWindow) {
      SessionRestore.beginWindowClassification(tab.windowId)
    }
    const windowDisposition = await SessionRestore.waitForWindowClassification(
      tab.windowId,
    )
    if (pendingTabCreations.get(tab.id) !== creationToken) return
    const extensionTab = await OnCreatedQueue.isNewTabExtensionGenerated(tab.id)
    if (pendingTabCreations.get(tab.id) !== creationToken) return
    if (extensionTab) return
    const currentWindow = Tree.Items.filter(Tree.isWindow).find(
      (window) => window.id === tab.windowId,
    )
    if (
      currentWindow &&
      Tree.getTabs(currentWindow.children).some(
        (treeTab) => treeTab.id === tab.id,
      )
    ) {
      return
    }
    if (
      windowDisposition === 'new-window' ||
      windowDisposition === 'restored-window'
    ) {
      if (
        windowDisposition === 'restored-window' &&
        (await SessionRestore.handleCreatedTab(tab))
      ) {
        return
      }
      if (pendingTabCreations.get(tab.id) !== creationToken) return
      if (!currentWindow) return
      let latestTab = tab
      try {
        latestTab = {
          ...(await browser.tabs.get(tab.id)),
          id: tab.id,
          windowId: tab.windowId,
        }
      } catch (error) {
        console.debug('Failed to refresh late-created tab state:', error)
      }
      if (pendingTabCreations.get(tab.id) !== creationToken) return
      if (
        Tree.getTabs(currentWindow.children).some(
          (treeTab) => treeTab.id === tab.id,
        )
      ) {
        return
      }
      await addBrowserTabToTrackedWindow(
        { ...latestTab, id: tabId, windowId },
        currentWindow,
      )
      return
    }
    const restoredTabHandled = await SessionRestore.handleCreatedTab(tab)
    if (pendingTabCreations.get(tab.id) !== creationToken) return
    if (!restoredTabHandled) {
      const window = Tree.Items.filter(Tree.isWindow).find(
        (w) => w.id === tab.windowId,
      )
      // if Window ID is not in session tree, then the window was just opened,
      // so window listener will handle adding the tab to the session tree.
      if (!window) {
        return
      }
      await addBrowserTabToTrackedWindow(
        { ...tab, id: tabId, windowId },
        window,
      )
    }
  } finally {
    if (pendingTabCreations.get(tab.id) === creationToken) {
      pendingTabCreations.delete(tab.id)
    }
  }
}

async function addBrowserTabToTrackedWindow(
  tab: browser.tabs.Tab & { id: number; windowId: number },
  window: Window,
): Promise<void> {
  // Translate the browser index because saved tabs, notes, and separators do
  // not consume positions in Firefox's live tab strip.
  const openSessionTreeTabs = Tree.getTabs(window.children).filter(
    (treeTab) =>
      treeTab.state === State.OPEN || treeTab.state === State.DISCARDED,
  )
  const tabToLeft =
    tab.index > 0 ? openSessionTreeTabs[tab.index - 1] : undefined
  const tabToLeftIndex = tabToLeft
    ? window.children.findIndex((item) => item.uid === tabToLeft.uid)
    : 0
  const targetIndex =
    tab.index === 0 ? 0 : tabToLeft ? tabToLeftIndex + 1 : undefined
  const tabUid = Tree.addTab(
    tab.active,
    window.uid,
    tab.id,
    false,
    tab.discarded ? State.DISCARDED : State.OPEN,
    tab.title || 'Untitled',
    tab.url || '',
    tab.pinned || false,
    targetIndex,
  )
  updateTabContainerFromBrowserTab(tabUid, tab)
  if (tabUid && (tab.groupId ?? -1) !== -1) {
    await Tree.tabGroupMembershipChanged(tab.id, tab.groupId!)
  }
}

function updateTabContainerFromBrowserTab(
  tabUid: UID | void,
  tab: browser.tabs.Tab,
): void {
  if (!tabUid) return
  const container = Tree.containerForCookieStore(tab.cookieStoreId)
  if (container) Tree.updateTab({ tabUid }, { container })
}

/**
 * When a tab is removed, remove it from the session tree.
 * If the tab is saved, do nothing.
 * If the window is also closing, do nothing.
 */
function tabsOnRemoved(
  tabId: number,
  removeInfo: browser.tabs._OnRemovedRemoveInfo,
): void {
  console.debug('Tab Removed:', tabId, removeInfo)
  pendingTabCreations.delete(tabId)
  pendingDetachedTabs.delete(tabId)
  if (isCommandOwnedTabRemoval(tabId)) return
  if (removeInfo.windowId === undefined) {
    console.error('Window ID is undefined')
    return
  }
  const window = Tree.Items.filter(Tree.isWindow).find(
    (w) => w.id === removeInfo.windowId,
  )
  if (!window) {
    return
  }
  const tabs = Tree.getTabs(window.children)
  const index = tabs.findIndex((tab) => tab.id === tabId)
  if (index === -1) {
    return
  }
  const tab = tabs[index]
  if (
    Settings.values.saveTabsWhenTabGroupDeleted &&
    !removeInfo.isWindowClosing &&
    tab.tabGroup?.id !== undefined &&
    tab.tabGroup.id !== -1
  ) {
    const pending = pendingGroupedTabRemovals.get(tab.tabGroup.id) ?? []
    pending.push({ tabId, removeInfo })
    pendingGroupedTabRemovals.set(tab.tabGroup.id, pending)
    scheduleGroupedTabRemoval(tab.tabGroup.id)
    return
  }

  finishTabRemoval(tabId, removeInfo)
}

function finishTabRemoval(
  tabId: number,
  removeInfo: browser.tabs._OnRemovedRemoveInfo,
): void {
  const window = Tree.Items.filter(Tree.isWindow).find(
    (w) => w.id === removeInfo.windowId,
  )
  if (!window) return
  const tabs = Tree.getTabs(window.children)
  const index = tabs.findIndex((tab) => tab.id === tabId)
  if (index === -1) return
  if (tabs[index].state === State.SAVED) {
    return
  }
  if (removeInfo.isWindowClosing) {
    return
  }
  if (
    Settings.values.saveTabOnClose ||
    (Settings.values.saveTabOnCloseIfPreviouslySaved &&
      tabs[index].savedTime! > 0)
  ) {
    Tree.setTabSaved(tabs[index].uid)
    return
  }
  Tree.removeTab(tabs[index].uid)
}

function tabGroupsOnRemoved(
  group: browser.tabGroups.TabGroup,
  removeInfo: browser.tabGroups._RemoveInfo,
): void {
  if (removeInfo.isWindowClosing) {
    Tree.tabGroupWindowClosed(group)
    return
  }

  if (!Settings.values.saveTabsWhenTabGroupDeleted) {
    Tree.tabGroupRemoved(group)
    return
  }

  pendingRemovedGroups.set(group.id, { group, removeInfo })
  scheduleGroupedTabRemoval(group.id)
}

function tabGroupsOnCreatedOrUpdated(group: browser.tabGroups.TabGroup): void {
  cancelPendingGroupedRemoval(group.id)
  Tree.tabGroupUpdated(group)
}

function cancelPendingGroupedRemoval(groupId: number): void {
  const pendingTimer = pendingGroupRemovalTimers.get(groupId)
  if (!pendingTimer) return
  clearTimeout(pendingTimer.timer)
  finalizeGroupedTabRemoval(groupId, pendingTimer.token)
}

function scheduleGroupedTabRemoval(groupId: number): void {
  const existingTimer = pendingGroupRemovalTimers.get(groupId)
  if (existingTimer) clearTimeout(existingTimer.timer)

  const token = Symbol(`group-removal-${groupId}`)
  const timer = setTimeout(() => finalizeGroupedTabRemoval(groupId, token), 100)
  pendingGroupRemovalTimers.set(groupId, { timer, token })
}

function finalizeGroupedTabRemoval(groupId: number, token: symbol): void {
  if (pendingGroupRemovalTimers.get(groupId)?.token !== token) return
  const groupRemoval = pendingRemovedGroups.get(groupId)
  const tabRemovals = pendingGroupedTabRemovals.get(groupId) ?? []

  if (groupRemoval) {
    Tree.tabGroupRemoved(groupRemoval.group, tabRemovals.length > 0)
  }
  for (const removal of tabRemovals) {
    finishTabRemoval(removal.tabId, removal.removeInfo)
  }

  pendingRemovedGroups.delete(groupId)
  pendingGroupedTabRemovals.delete(groupId)
  pendingGroupRemovalTimers.delete(groupId)
}

/**
 * When a tab is updated, update the session tree to match the new tab state.
 */
async function tabsOnUpdated(
  tabId: number,
  changeInfo: browser.tabs._OnUpdatedChangeInfo,
  tab: browser.tabs.Tab,
): Promise<void> {
  if (tab.windowId === undefined || tab.id === undefined) {
    console.error('Tab or Window ID is undefined')
    return
  }
  const indexedTab = Tree.Items.filter(Tree.isWindow)
    .find((window) => window.id === tab.windowId)
    ?.children.find(
      (item): item is Tab =>
        item.type === TreeItemType.TAB && item.id === tab.id,
    )
  if (!indexedTab) return

  let authoritativeTab = tab
  if (changeInfo.status === LoadingStatus.COMPLETE) {
    try {
      const currentTab = await browser.tabs.get(tabId)
      if (currentTab.id !== tabId || currentTab.windowId !== tab.windowId) {
        return
      }
      authoritativeTab = currentTab
    } catch (error) {
      console.debug('Failed to refresh completed tab update:', error)
      return
    }
  }
  const tabContents: Partial<Tab> = {
    state: authoritativeTab.discarded ? State.DISCARDED : State.OPEN,
  }
  if (authoritativeTab.status) {
    tabContents.loadingStatus = authoritativeTab.status as LoadingStatus
  }
  // only update title and url if the tab is complete
  // this is to prevent the tab from being updated with eroneous data such as new tab
  if (authoritativeTab.status === 'complete') {
    if (authoritativeTab.title) tabContents.title = authoritativeTab.title
    if (authoritativeTab.url) tabContents.url = authoritativeTab.url
  }
  if (changeInfo.pinned !== undefined) {
    tabContents.pinned = authoritativeTab.pinned
    if (authoritativeTab.pinned) {
      Tree.pinTabInTree(indexedTab.uid)
    } else {
      Tree.unpinTabInTree(indexedTab.uid)
    }
  }

  Tree.updateTab({ windowId: tab.windowId, tabId: tab.id }, tabContents)
  const groupId = (changeInfo as { groupId?: number }).groupId
  if (groupId !== undefined) {
    void Tree.tabGroupMembershipChanged(tabId, groupId).catch((error) => {
      console.error('Error updating tab group membership:', error)
    })
  }
}

/**
 * When a tab is moved within a window, update the session tree to match the new tab order.
 */
async function tabsOnMoved(
  tabId: number,
  moveInfo: browser.tabs._OnMovedMoveInfo,
): Promise<void> {
  console.debug('Tab Moved:', tabId, moveInfo)
  if (
    SessionRestore.isTabRelocating(tabId) ||
    isCommandOwnedTabRelocation(tabId)
  )
    return
  if (
    moveInfo.windowId === undefined ||
    moveInfo.toIndex === undefined ||
    tabId === undefined
  ) {
    console.error('Tab or Window ID is undefined')
    return
  }
  const window = Tree.Items.filter(Tree.isWindow).find(
    (w) => w.id === moveInfo.windowId,
  )
  if (!window) {
    console.error('Window not found in session tree')
    return
  }
  const openSessionTreeTabs = Tree.getTabs(window.children).filter(
    (tab) => tab.state === State.OPEN || tab.state === State.DISCARDED,
  )
  const moveToken = Symbol(`window-move-${moveInfo.windowId}`)
  pendingWindowMoves.set(moveInfo.windowId, moveToken)
  try {
    let openBrowserTabs: browser.tabs.Tab[]
    try {
      openBrowserTabs = await browser.tabs.query({
        windowId: moveInfo.windowId,
      })
    } catch (error) {
      console.error('Failed to reconcile moved tab:', error)
      return
    }
    if (pendingWindowMoves.get(moveInfo.windowId) !== moveToken) return
    if (!openSessionTreeTabs || !openBrowserTabs) {
      console.error('Error getting tabs')
      return
    }
    const repairedChildrenPlacedBeforeParents =
      repairChildrenPlacedBeforeParents(window)
    // return if order matches
    if (
      openSessionTreeTabs.every(
        (tab, index) => tab.id === openBrowserTabs[index].id,
      )
    ) {
      if (repairedChildrenPlacedBeforeParents) {
        Tree.recomputeSessionTree()
      }
      return
    }
    // if order doesn't match, update the sessionTree order to match the browser order
    const movedTabIndex = window.children.findIndex(
      (tab) => tab.type === TreeItemType.TAB && tab.id === tabId,
    )
    if (movedTabIndex === -1) {
      console.warn('Moved tab not found in session tree:', tabId)
      return
    }
    const tab = window.children[movedTabIndex] as Tab
    Tree.removeTab(tab.uid)
    if (moveInfo.toIndex + 1 >= openSessionTreeTabs.length) {
      // place in last position, or if pinned, at end of pinned tabs
      const targetTabIndex =
        window.children.findLastIndex(
          (t) => t.type === TreeItemType.TAB && t.pinned,
        ) + 1
      Tree.addTab(
        tab.active ?? false,
        window.uid,
        tab.id,
        false,
        tab.state,
        tab.title,
        tab.url,
        tab.pinned || false,
        tab.pinned ? targetTabIndex : undefined,
        undefined,
        tab.uid,
        true,
        tab.tabGroup,
        tab.container,
      )
    } else {
      // move to the position immediately before the tab to the right in the browser
      const rightTabId = openBrowserTabs[moveInfo.toIndex + 1].id
      let targetTabIndex = window.children.findIndex(
        (tab) => tab.type === TreeItemType.TAB && tab.id === rightTabId,
      )
      // if tab is pinned and the tab to the right is not pinned, adjust to place at end of pinned tabs
      if (tab.pinned && !openBrowserTabs[moveInfo.toIndex + 1].pinned) {
        targetTabIndex =
          window.children.findLastIndex(
            (t) => t.type === TreeItemType.TAB && t.pinned,
          ) + 1
      }

      Tree.addTab(
        tab.active ?? false,
        window.uid,
        tab.id,
        false,
        tab.state,
        tab.title,
        tab.url,
        tab.pinned || false,
        targetTabIndex,
        undefined,
        tab.uid,
        true,
        tab.tabGroup,
        tab.container,
      )
    }
    Tree.recomputeSessionTree()
  } finally {
    if (pendingWindowMoves.get(moveInfo.windowId) === moveToken) {
      pendingWindowMoves.delete(moveInfo.windowId)
    }
  }
}

/**
 * Repairs child items that appear before their parent in a window child list.
 * Repeats until multi-level inversions are resolved.
 *
 * @param {Window} window - The window whose child ordering should be repaired.
 * @returns {boolean} Whether any child parent or indent metadata was updated.
 */
function repairChildrenPlacedBeforeParents(window: Window): boolean {
  let repaired = false
  let changedInPass = true
  while (changedInPass) {
    changedInPass = false
    const childIndexByUid = new Map<UID, number>(
      window.children.map((child, index) => [child.uid, index]),
    )

    for (const [index, child] of window.children.entries()) {
      if (!child.parentUid) continue

      const parentIndex = childIndexByUid.get(child.parentUid)
      if (parentIndex === undefined || parentIndex < index) continue

      const parent = window.children[parentIndex]
      // If a child appears before its parent, promote it to the parent's level
      // so future recompute passes do not keep an impossible ordering.
      const parentUid = parent.uid === child.uid ? undefined : parent.parentUid
      const indentLevel =
        parent.uid === child.uid ? 1 : (parent.indentLevel ?? 1)
      if (updateWindowChildParent(child, parentUid, indentLevel)) {
        updateParentFlagIfEmpty(window, parent)
        repaired = true
        changedInPass = true
      }
    }
  }
  return repaired
}

/**
 * Updates a window child item parent and indent metadata.
 *
 * @param {WindowChild} child - The child item to update.
 * @param {UID} [parentUid] - The new parent UID, or undefined for a root child.
 * @param {number} indentLevel - The child indent level after repair.
 * @returns {boolean} Whether the child metadata changed.
 */
function updateWindowChildParent(
  child: WindowChild,
  parentUid: UID | undefined,
  indentLevel: number,
): boolean {
  if (child.parentUid === parentUid && child.indentLevel === indentLevel) {
    return false
  }

  const updates = { parentUid, indentLevel }
  if (child.type === TreeItemType.TAB) {
    Tree.updateTab({ tabUid: child.uid }, updates)
  } else if (child.type === TreeItemType.NOTE) {
    Tree.updateNote(child.uid, updates)
  } else if (child.type === TreeItemType.SEPARATOR) {
    Tree.updateSeparator(child.uid, updates)
  }
  child.parentUid = parentUid
  child.indentLevel = indentLevel
  return true
}

/**
 * Clears the parent flag when an item no longer has children.
 *
 * @param {Window} window - The window containing the potential parent item.
 * @param {WindowChild} parent - The item whose parent flag may be cleared.
 */
function updateParentFlagIfEmpty(window: Window, parent: WindowChild): void {
  if (
    parent.type === TreeItemType.SEPARATOR ||
    window.children.some((child) => child.parentUid === parent.uid)
  ) {
    return
  }

  if (parent.type === TreeItemType.TAB) {
    Tree.updateTab({ tabUid: parent.uid }, { isParent: false })
    parent.isParent = false
  } else if (parent.type === TreeItemType.NOTE) {
    Tree.updateNote(parent.uid, { isParent: false })
    parent.isParent = false
  }
}

/**
 * When a tab is detached from a window, remove it from the session tree.
 */
function tabsOnDetached(
  tabId: number,
  detachInfo: browser.tabs._OnDetachedDetachInfo,
): void {
  console.debug('Tab Detached:', tabId, detachInfo)
  if (
    SessionRestore.isTabRelocating(tabId) ||
    isCommandOwnedTabRelocation(tabId)
  )
    return
  if (detachInfo.oldWindowId === undefined || tabId === undefined) {
    console.error('Tab or Window ID is undefined')
    return
  }
  const window = Tree.Items.filter(Tree.isWindow).find(
    (w) => w.id === detachInfo.oldWindowId,
  )
  if (!window) {
    return
  }
  const index = window.children.findIndex(
    (tab) => tab.type === TreeItemType.TAB && tab.id === tabId,
  )
  if (index === -1) {
    return
  }
  const detachedTab = window.children[index]
  if (detachedTab.type !== TreeItemType.TAB) return
  pendingDetachedTabs.set(tabId, {
    tab: structuredClone(detachedTab),
    token: Symbol(`tab-detached-${tabId}`),
  })
  Tree.removeTab(detachedTab.uid)
}

/**
 * When a tab is attached to a window, add it to the session tree.
 * If the tab is attached to the left of another tab, insert it at that index.
 */
async function tabsOnAttached(
  tabId: number,
  attachInfo: browser.tabs._OnAttachedAttachInfo,
): Promise<void> {
  console.debug('Tab Attached:', tabId, attachInfo)
  if (
    SessionRestore.isTabRelocating(tabId) ||
    isCommandOwnedTabRelocation(tabId)
  )
    return
  const extensionTab = await OnCreatedQueue.isNewTabExtensionGenerated(tabId)
  if (extensionTab) {
    pendingDetachedTabs.delete(tabId)
    console.log('tabsOnAttached: Tab created by extension, ignoring: ', tabId)
    return
  }
  console.log('tabsOnAttached: Processing attached tab: ', tabId)
  if (attachInfo.newWindowId === undefined || tabId === undefined) {
    console.error('Tab or Window ID is undefined')
    return
  }
  const pendingDetachedTab = pendingDetachedTabs.get(tabId)
  const transferToken = pendingDetachedTab?.token
  let window = Tree.Items.filter(Tree.isWindow).find(
    (w) => w.id === attachInfo.newWindowId,
  )
  if (!window) {
    SessionRestore.beginWindowClassification(attachInfo.newWindowId)
    await SessionRestore.waitForWindowClassification(attachInfo.newWindowId)
    if (
      transferToken &&
      pendingDetachedTabs.get(tabId)?.token !== transferToken
    ) {
      return
    }
    window = Tree.Items.filter(Tree.isWindow).find(
      (w) => w.id === attachInfo.newWindowId,
    )
    if (!window) {
      console.error('Window not found in session tree')
      return
    }
  }
  let tab: browser.tabs.Tab
  try {
    tab = await browser.tabs.get(tabId)
  } catch (error) {
    console.error('Failed to read attached tab:', error)
    return
  }
  if (
    transferToken &&
    pendingDetachedTabs.get(tabId)?.token !== transferToken
  ) {
    return
  }
  if (!tab) {
    console.error('Tab not found in window')
    return
  }

  // if tab is already added to tree, return
  const existingTab = window.children.find(
    (t) => t.type === TreeItemType.TAB && t.id === tabId,
  )
  if (existingTab) return

  // get the id of the tab to the right in the browser
  let tabToRight: browser.tabs.Tab[]
  try {
    tabToRight = await browser.tabs.query({
      windowId: attachInfo.newWindowId,
      index: tab.index + 1,
    })
  } catch (error) {
    console.error('Failed to read attached tab position:', error)
    return
  }
  if (
    transferToken &&
    pendingDetachedTabs.get(tabId)?.token !== transferToken
  ) {
    return
  }
  const tabToRightId = tabToRight.length > 0 ? tabToRight[0].id : undefined
  let targetTabIndex: number | undefined
  if (tabToRightId === undefined) {
    targetTabIndex = tab.pinned
      ? window.children.findLastIndex(
          (t) => t.type === TreeItemType.TAB && t.pinned,
        ) + 1
      : undefined
  } else {
    // if there is a tab to the right, insert it to the left of that tab
    const tabToRightIndex = window.children.findIndex(
      (tab) => tab.type === TreeItemType.TAB && tab.id === tabToRightId,
    )
    const lastPinnedIndex =
      window.children.findLastIndex(
        (t) => t.type === TreeItemType.TAB && t.pinned,
      ) + 1
    targetTabIndex =
      tab.pinned && lastPinnedIndex < tabToRightIndex
        ? lastPinnedIndex
        : tabToRightIndex
  }

  const detachedSnapshot = pendingDetachedTab?.tab
  const parentUid =
    detachedSnapshot?.parentUid &&
    window.children.some((child) => child.uid === detachedSnapshot.parentUid)
      ? detachedSnapshot.parentUid
      : undefined
  const container =
    Tree.containerForCookieStore(tab.cookieStoreId) ??
    detachedSnapshot?.container
  const tabUid = detachedSnapshot
    ? Tree.addTab(
        tab.active,
        window.uid,
        tabId,
        false,
        tab.discarded ? State.DISCARDED : State.OPEN,
        tab.title || 'Untitled',
        tab.url || '',
        tab.pinned || false,
        targetTabIndex,
        parentUid,
        detachedSnapshot.uid,
        true,
        detachedSnapshot.tabGroup,
        container,
      )
    : Tree.addTab(
        tab.active,
        window.uid,
        tabId,
        false,
        tab.discarded ? State.DISCARDED : State.OPEN,
        tab.title || 'Untitled',
        tab.url || '',
        tab.pinned || false,
        targetTabIndex,
      )
  if (!detachedSnapshot) updateTabContainerFromBrowserTab(tabUid, tab)
  if (tabUid && detachedSnapshot) {
    Tree.updateTab(
      { tabUid },
      {
        collapsed: detachedSnapshot.collapsed,
        customLabel: detachedSnapshot.customLabel,
        isParent: detachedSnapshot.isParent,
        isVisible: detachedSnapshot.isVisible,
        savedTime: detachedSnapshot.savedTime,
      },
    )
  }
  if (
    transferToken &&
    pendingDetachedTabs.get(tabId)?.token === transferToken
  ) {
    pendingDetachedTabs.delete(tabId)
  }
  if (tabUid && (tab.groupId ?? -1) !== -1) {
    await Tree.tabGroupMembershipChanged(tabId, tab.groupId!)
  }
}

/**
 * When a window is focused, set the active window in the session tree.
 */
function windowsOnFocusChanged(windowId: number): void {
  Tree.setActiveWindow(windowId, 5)
}

/**
 * When a tab is activated, set the active tab in the session tree.
 */
function tabsOnActivated(
  activeInfo: browser.tabs._OnActivatedActiveInfo,
): void {
  Tree.tabOnActivated(activeInfo, 5)
}

/**
 * When the browser action is clicked, open the session tree.
 */
function browserActionOnClicked(): void {
  Tree.openSessionTree().catch((error) => {
    console.error('Error opening SessionTree:', error)
  })
}

/**
 * Listen for messages from the Vue component session tree.
 * Most of these will be user actions performed in the session tree.
 */
function onMessage(message: Messages.SessionTreeMessage): void {
  void dispatchCommand(message)
}

async function dispatchCommand(
  message: Messages.SessionTreeMessage,
): Promise<void | SessionTreeCommandResult> {
  const coordination = getCommandCoordination(message)
  if (coordination) {
    return coordinateCommand({
      itemUids: coordination.itemUids,
      operationKey: JSON.stringify(message),
      coalesce: coordination.coalesce,
      run: () => dispatchCommandNow(message),
    })
  }

  return dispatchCommandNow(message)
}

function getCommandCoordination(message: Messages.SessionTreeMessage):
  | {
      itemUids: UID[]
      coalesce: boolean
    }
  | undefined {
  if (
    message.action === 'openTab' ||
    message.action === 'closeTab' ||
    message.action === 'saveTab'
  ) {
    return { itemUids: [message.tabUid], coalesce: true }
  }
  if (
    message.action === 'openWindow' ||
    message.action === 'closeWindow' ||
    message.action === 'saveWindow'
  ) {
    return { itemUids: [message.windowUid], coalesce: true }
  }
  if (
    message.action === 'moveTreeItems' ||
    message.action === 'duplicateTreeItems' ||
    message.action === 'treeItemIndentIncrease' ||
    message.action === 'treeItemIndentDecrease'
  ) {
    return { itemUids: message.itemUIDs, coalesce: false }
  }
  if (message.action === 'moveWindows') {
    return { itemUids: message.windowUIDs, coalesce: false }
  }
}

async function dispatchCommandNow(
  message: Messages.SessionTreeMessage,
): Promise<void | SessionTreeCommandResult> {
  if (message.action === 'closeTab') {
    await Tree.closeTab(message)
  } else if (message.action === 'saveTab') {
    await Tree.saveTab(message)
  } else if (message.action === 'openTab') {
    await Tree.openTab(message)
  } else if (message.action === 'reloadTab') {
    Browser.reloadTab(message)
  } else if (message.action === 'closeWindow') {
    await Tree.closeWindow(message)
  } else if (message.action === 'saveWindow') {
    await Tree.saveAndRemoveWindow(message)
  } else if (message.action === 'openWindow') {
    return Tree.openWindow(message)
  } else if (message.action === 'focusTab') {
    Browser.focusTabAndWindow(message)
  } else if (message.action === 'focusWindow') {
    Browser.focusWindow(message)
  } else if (message.action === 'openWindowsInSameLocationUpdated') {
    Tree.updateWindowPositionInterval()
  } else if (message.action === 'registerSessionTreeWindow') {
    Tree.registerSessionTreeWindow(message.windowId)
  } else if (message.action === 'toggleCollapseTab') {
    Tree.toggleCollapseTab(message.tabUid)
  } else if (message.action === 'toggleCollapseWindow') {
    Tree.toggleCollapseWindow(message.windowUid)
  } else if (message.action === 'updateWindowTitle') {
    const window = Tree.windowsByUid.get(message.windowUid)
    if (window) {
      Tree.updateWindow(message.windowUid, { title: message.newTitle })
    }
  } else if (message.action === 'updateCustomLabel') {
    const tab = Tree.tabsByUid.get(message.uid)
    if (tab) {
      Tree.updateTab(
        { tabUid: message.uid },
        { customLabel: message.customLabel?.trim() || undefined },
      )
    }
  } else if (message.action === 'createNote') {
    Tree.createNote(message.parentUid, message.index, message.text)
  } else if (message.action === 'updateNoteText') {
    Tree.updateNoteText(message.noteUid, message.text)
  } else if (message.action === 'toggleCollapseNote') {
    Tree.toggleCollapseNote(message.noteUid)
  } else if (message.action === 'removeNote') {
    Tree.removeNote(message.noteUid)
  } else if (message.action === 'createSeparator') {
    Tree.createSeparator(message.parentUid, message.index)
  } else if (message.action === 'removeSeparator') {
    Tree.removeSeparator(message.separatorUid)
  } else if (message.action === 'createSeparatorBelow') {
    Tree.createSeparatorBelow(message.separatorUid)
  } else if (message.action === 'deselectAllItems') {
    Tree.deselectAllItems()
  } else if (message.action === 'importExternalUrls') {
    await Tree.importExternalUrls(message)
  } else if (message.action === 'moveTreeItems') {
    await Tree.moveTreeItems(
      message.itemUIDs,
      message.targetIndex,
      message.parentUid,
      message.targetWindowUid,
      message.copy,
      message.includeDescendants,
    )
  } else if (message.action === 'moveWindows') {
    await Tree.moveWindows(
      message.windowUIDs,
      message.targetIndex,
      message.copy,
    )
  } else if (message.action === 'duplicateTreeItems') {
    await Tree.duplicateTreeItems(message.itemUIDs)
  } else if (message.action === 'treeItemIndentIncrease') {
    await Tree.treeItemIndentIncrease(message.itemUIDs)
  } else if (message.action === 'treeItemIndentDecrease') {
    await Tree.treeItemIndentDecrease(message.itemUIDs)
  } else if (message.action === 'pinTab') {
    Tree.pinTab(message.tabUid)
  } else if (message.action === 'unpinTab') {
    Tree.unpinTab(message.tabUid)
  } else if (message.action === 'printSessionTree') {
    Tree.printSessionTree()
  }
}

/**
 * When the context menu is closed, clear Selection and remove all custom context menu items,
 * then recreate the browser action context menu.
 */
function onContextMenuHidden(): void {
  Selection.clearSelection()
  browser.menus.removeAll()
  Actions.setupBrowserActionMenu()
}
