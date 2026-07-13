import * as Actions from '@/services/background-actions'
import { updateBadge } from '@/services/background-actions'
import { Browser } from '@/services/background-browser'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Tree } from '@/services/background-tree'
import { initializeSessionTreePort } from '@/services/runtime-port-service'
import { Selection } from '@/services/selection'
import { Settings } from '@/services/settings'
import * as Messages from '@/types/messages'
import {
  LoadingStatus,
  State,
  Tab,
  TabGroupMetadata,
  TreeItemType,
  Window,
  WindowChild,
} from '@/types/session-tree'

const detachedTabGroups = new Map<number, TabGroupMetadata | undefined>()
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
  ReturnType<typeof setTimeout>
>()

// ==============================
// Event Listeners
// ==============================
export function initializeListeners() {
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
  browser.tabGroups.onCreated.addListener(Tree.tabGroupUpdated)
  browser.tabGroups.onMoved.addListener(Tree.tabGroupMoved)
  browser.tabGroups.onRemoved.addListener(tabGroupsOnRemoved)
  browser.tabGroups.onUpdated.addListener(Tree.tabGroupUpdated)
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
function tabsOnUpdatedFavicon(
  tabId: number,
  changeInfo: browser.tabs._OnUpdatedChangeInfo,
  tab: browser.tabs.Tab,
): void {
  if (
    tab.favIconUrl &&
    browser.extension.getViews().length > 0 &&
    tab.status === 'complete'
  ) {
    window.browser.runtime
      .sendMessage({
        type: 'FAVICON_UPDATED',
        favIconUrl: tab.favIconUrl,
        tab: tab,
      })
      .catch(() => {
        console.debug('No receivers for favicon update')
      })
  }
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
  const extensionWindow = await OnCreatedQueue.isNewWindowExtensionGenerated(
    window.id,
  )
  if (!extensionWindow) {
    await Tree.addWindow(window.id)
  }
}

/**
 * When a window is removed, remove it from the session tree.
 * If the window is saved, do nothing.
 * If the window has saved tabs, save the window instead of removing.
 * If the window only has 1 tab, save the window instead of removing.
 */
function windowsOnRemoved(windowId: number): void {
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
  const extensionTab = await OnCreatedQueue.isNewTabExtensionGenerated(tab.id)
  if (!extensionTab) {
    const window = Tree.Items.filter(Tree.isWindow).find(
      (w) => w.id === tab.windowId,
    )
    // if Window ID is not in session tree, then the window was just opened,
    // so window listener will handle adding the tab to the session tree.
    if (!window) {
      return
    }
    // translate index from browser to session tree, as browser index includes all tabs, but session tree index only includes open and discarded tabs
    const openSessionTreeTabs = Tree.getTabs(window.children).filter(
      (tab) => tab.state === State.OPEN || tab.state === State.DISCARDED,
    )
    const tabToLeft = openSessionTreeTabs[Math.max(tab.index - 1, 0)]
    const tabToLeftIndex = tabToLeft
      ? window.children.findIndex((t) => t.uid === tabToLeft.uid)
      : 0
    const tabUid = Tree.addTab(
      tab.active,
      window.uid,
      tab.id,
      false,
      tab.discarded ? State.DISCARDED : State.OPEN,
      tab.title || 'Untitled',
      tab.url || '',
      tab.pinned || false,
      tabToLeft ? tabToLeftIndex + 1 : undefined,
    )
    if (tabUid && (tab.groupId ?? -1) !== -1) {
      await Tree.tabGroupMembershipChanged(tab.id, tab.groupId!)
    }
  }
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

function scheduleGroupedTabRemoval(groupId: number): void {
  const existingTimer = pendingGroupRemovalTimers.get(groupId)
  if (existingTimer) clearTimeout(existingTimer)

  pendingGroupRemovalTimers.set(
    groupId,
    setTimeout(() => finalizeGroupedTabRemoval(groupId), 100),
  )
}

function finalizeGroupedTabRemoval(groupId: number): void {
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
function tabsOnUpdated(
  tabId: number,
  changeInfo: browser.tabs._OnUpdatedChangeInfo,
  tab: browser.tabs.Tab,
): void {
  if (tab.windowId === undefined || tab.id === undefined) {
    console.error('Tab or Window ID is undefined')
    return
  }
  const tabContents: Partial<Tab> = {
    state: tab.discarded ? State.DISCARDED : State.OPEN,
  }
  if (tab.status) tabContents.loadingStatus = tab.status as LoadingStatus
  // only update title and url if the tab is complete
  // this is to prevent the tab from being updated with eroneous data such as new tab
  if (tab.status === 'complete') {
    if (tab.title) tabContents.title = tab.title
    if (tab.url) tabContents.url = tab.url
  }
  if (changeInfo.pinned !== undefined) {
    tabContents.pinned = tab.pinned
    const t = Tree.Items.filter(Tree.isWindow)
      .find((t) => t.id === tab.windowId)
      ?.children.find(
        (t): t is Tab => t.type === TreeItemType.TAB && t.id === tab.id,
      )
    if (!t) {
      console.error(
        'Error updating pinned state, could not find tab in tree:',
        tab.windowId,
        tab.id,
      )
      return
    }
    if (tab.pinned) {
      Tree.pinTabInTree(t.uid)
    } else {
      Tree.unpinTabInTree(t.uid)
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
  const openBrowserTabs = await browser.tabs.query({
    windowId: moveInfo.windowId,
  })
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
    const tabUid = Tree.addTab(
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
    )
    if (tabUid && tab.tabGroup) {
      Tree.updateTab({ tabUid }, { tabGroup: tab.tabGroup })
    }
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

    const tabUid = Tree.addTab(
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
    )
    if (tabUid && tab.tabGroup) {
      Tree.updateTab({ tabUid }, { tabGroup: tab.tabGroup })
    }
  }
  Tree.recomputeSessionTree()
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
  detachedTabGroups.set(
    tabId,
    detachedTab.type === TreeItemType.TAB ? detachedTab.tabGroup : undefined,
  )
  Tree.removeTab(window.children[index].uid)
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
  const extensionTab = await OnCreatedQueue.isNewTabExtensionGenerated(tabId)
  if (extensionTab) {
    console.log('tabsOnAttached: Tab created by extension, ignoring: ', tabId)
    return
  }
  console.log('tabsOnAttached: Processing attached tab: ', tabId)
  if (attachInfo.newWindowId === undefined || tabId === undefined) {
    console.error('Tab or Window ID is undefined')
    return
  }
  const window = Tree.Items.filter(Tree.isWindow).find(
    (w) => w.id === attachInfo.newWindowId,
  )
  if (!window) {
    console.error('Window not found in session tree')
    return
  }
  const tab = await browser.tabs.get(tabId)
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
  const tabToRight = await browser.tabs.query({
    windowId: attachInfo.newWindowId,
    index: tab.index + 1,
  })
  const tabToRightId = tabToRight.length > 0 ? tabToRight[0].id : undefined
  // if there is no tab to the right, add the tab to the end, if pinned, at end of pinned tabs
  if (tabToRightId === undefined) {
    const targetTabIndex = tab.pinned
      ? window.children.findLastIndex(
          (t) => t.type === TreeItemType.TAB && t.pinned,
        ) + 1
      : undefined
    const tabUid = Tree.addTab(
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
    const detachedGroup = detachedTabGroups.get(tabId)
    if (tabUid && detachedGroup) {
      Tree.updateTab({ tabUid }, { tabGroup: detachedGroup })
    }
    detachedTabGroups.delete(tabId)
    if (tabUid && (tab.groupId ?? -1) !== -1) {
      await Tree.tabGroupMembershipChanged(tabId, tab.groupId!)
    }
    return
  } else {
    // if there is a tab to the right, insert it to the left of that tab
    const tabToRightIndex = window.children.findIndex(
      (tab) => tab.type === TreeItemType.TAB && tab.id === tabToRightId,
    )
    const lastPinnedIndex =
      window.children.findLastIndex(
        (t) => t.type === TreeItemType.TAB && t.pinned,
      ) + 1
    const tabUid = Tree.addTab(
      tab.active,
      window.uid,
      tabId,
      false,
      tab.discarded ? State.DISCARDED : State.OPEN,
      tab.title || 'Untitled',
      tab.url || '',
      tab.pinned || false,
      tab.pinned && lastPinnedIndex < tabToRightIndex
        ? lastPinnedIndex
        : tabToRightIndex,
    )
    const detachedGroup = detachedTabGroups.get(tabId)
    if (tabUid && detachedGroup) {
      Tree.updateTab({ tabUid }, { tabGroup: detachedGroup })
    }
    detachedTabGroups.delete(tabId)
    if (tabUid && (tab.groupId ?? -1) !== -1) {
      await Tree.tabGroupMembershipChanged(tabId, tab.groupId!)
    }
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
): Promise<void> {
  if (message.action === 'closeTab') {
    Tree.closeTab(message)
  } else if (message.action === 'saveTab') {
    Tree.saveTab(message)
  } else if (message.action === 'openTab') {
    await Tree.openTab(message)
  } else if (message.action === 'reloadTab') {
    Browser.reloadTab(message)
  } else if (message.action === 'closeWindow') {
    Tree.closeWindow(message)
  } else if (message.action === 'saveWindow') {
    Tree.saveAndRemoveWindow(message)
  } else if (message.action === 'openWindow') {
    await Tree.openWindow(message)
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
    Tree.moveWindows(message.windowUIDs, message.targetIndex, message.copy)
  } else if (message.action === 'duplicateTreeItems') {
    Tree.duplicateTreeItems(message.itemUIDs)
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
