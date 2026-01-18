import * as Actions from '@/services/background-actions'
import { updateBadge } from '@/services/background-actions'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Tree } from '@/services/background-tree'
import { Selection } from '@/services/selection'
import { Settings } from '@/services/settings'
import * as Messages from '@/types/messages'
import { LoadingStatus, State, Tab } from '@/types/session-tree'

// ==============================
// Event Listeners
// ==============================
export function initializeListeners() {
  browser.browserAction.onClicked.addListener(browserActionOnClicked)
  browser.menus.onHidden.addListener(onContextMenuHidden)
  browser.runtime.onInstalled.addListener(updateBadge)
  browser.runtime.onMessage.addListener(onMessage)
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
    Tree.addWindow(window.id)
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
  const window = Tree.windowsList.find((w) => w.id === windowId)
  if (!window) {
    return
  }
  if (window.state === State.SAVED) {
    return
  }
  // if window has saved tabs, save the window instead of removing
  const savedTabs = window.tabs.filter((tab) => tab.state === State.SAVED)
  const tabCount = window.tabs.length
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

  // if this window only has 1 tab, then save the window instead of removing
  if (tabCount === 1) {
    const openTab = window.tabs.filter((tab) => tab.state === State.OPEN)[0]
    if (!openTab) {
      Tree.removeWindow(window.uid)
    }
    // if settings set to save tab on close
    if (
      Settings.values.saveTabOnClose ||
      (Settings.values.saveTabOnCloseIfPreviouslySaved &&
        openTab.savedTime! > 0)
    ) {
      Tree.saveWindow(window.uid)
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
    const window = Tree.windowsList.find((w) => w.id === tab.windowId)
    // if Window ID is not in session tree, then the window was just opened,
    // so window listener will handle adding the tab to the session tree.
    if (!window) {
      return
    }
    Tree.addTab(
      tab.active,
      window.uid,
      tab.id,
      false,
      tab.discarded ? State.DISCARDED : State.OPEN,
      tab.title || 'Untitled',
      tab.url || '',
      tab.index,
    )
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
  const window = Tree.windowsList.find((w) => w.id === removeInfo.windowId)
  if (!window) {
    return
  }
  const index = window.tabs.findIndex((tab) => tab.id === tabId)
  if (index === -1) {
    return
  }
  if (window.tabs[index].state === State.SAVED) {
    return
  }
  if (removeInfo.isWindowClosing) {
    return
  }
  if (
    Settings.values.saveTabOnClose ||
    (Settings.values.saveTabOnCloseIfPreviouslySaved &&
      window.tabs[index].savedTime! > 0)
  ) {
    Tree.setTabSaved(window.tabs[index].uid)
    return
  }
  Tree.removeTab(window.tabs[index].uid)
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

  Tree.updateTab({ windowId: tab.windowId, tabId: tab.id }, tabContents)
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
  const window = Tree.windowsList.find((w) => w.id === moveInfo.windowId)
  if (!window) {
    console.error('Window not found in session tree')
    return
  }
  const openSessionTreeTabs = window.tabs.filter(
    (tab) => tab.state === State.OPEN || tab.state === State.DISCARDED,
  )
  const openBrowserTabs = await browser.tabs.query({
    windowId: moveInfo.windowId,
  })
  if (!openSessionTreeTabs || !openBrowserTabs) {
    console.error('Error getting tabs')
    return
  }
  // return if order matches
  if (
    openSessionTreeTabs.every(
      (tab, index) => tab.id === openBrowserTabs[index].id,
    )
  ) {
    return
  }
  // if order doesn't match, update the sessionTree order to match the browser order
  const movedTabIndex = window.tabs.findIndex((tab) => tab.id === tabId)
  const tab = window.tabs[movedTabIndex]
  Tree.removeTab(tab.uid)
  if (moveInfo.toIndex + 1 >= openSessionTreeTabs.length) {
    // place in last position
    Tree.addTab(
      tab.active ?? false,
      window.uid,
      tab.id,
      false,
      tab.state,
      tab.title,
      tab.url,
    )
  } else {
    // move to the position immediately before the tab to the right in the browser
    const rightTabId = openBrowserTabs[moveInfo.toIndex + 1].id
    const rightTabIndex = window.tabs.findIndex((tab) => tab.id === rightTabId)
    Tree.addTab(
      tab.active ?? false,
      window.uid,
      tab.id,
      false,
      tab.state,
      tab.title,
      tab.url,
      rightTabIndex,
    )
  }
  Tree.recomputeSessionTree()
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
  const window = Tree.windowsList.find((w) => w.id === detachInfo.oldWindowId)
  if (!window) {
    return
  }
  const index = window.tabs.findIndex((tab) => tab.id === tabId)
  if (index === -1) {
    return
  }
  Tree.removeTab(window.tabs[index].uid)
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
  const window = Tree.windowsList.find((w) => w.id === attachInfo.newWindowId)
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
  const existingTab = window.tabs.find((t) => t.id === tabId)
  if (existingTab) return

  // get the id of the tab to the right in the browser
  const tabToRight = await browser.tabs.query({
    windowId: attachInfo.newWindowId,
    index: tab.index + 1,
  })
  const tabToRightId = tabToRight.length > 0 ? tabToRight[0].id : undefined
  // if there is no tab to the right, add the tab to the end
  if (tabToRightId === undefined) {
    Tree.addTab(
      tab.active,
      window.uid,
      tabId,
      false,
      tab.discarded ? State.DISCARDED : State.OPEN,
      tab.title || 'Untitled',
      tab.url || '',
    )
    return
  } else {
    // if there is a tab to the right, insert it to the left of that tab
    const tabToRightIndex = window.tabs.findIndex(
      (tab) => tab.id === tabToRightId,
    )
    Tree.addTab(
      tab.active,
      window.uid,
      tabId,
      false,
      tab.discarded ? State.DISCARDED : State.OPEN,
      tab.title || 'Untitled',
      tab.url || '',
      tabToRightIndex,
    )
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
  if (message.action === 'closeTab') {
    Tree.closeTab(message)
  } else if (message.action === 'saveTab') {
    Tree.saveTab(message)
  } else if (message.action === 'openTab') {
    Tree.openTab(message)
  } else if (message.action === 'reloadTab') {
    Tree.reloadTab(message)
  } else if (message.action === 'closeWindow') {
    Tree.closeWindow(message)
  } else if (message.action === 'saveWindow') {
    Tree.saveAndRemoveWindow(message)
  } else if (message.action === 'openWindow') {
    Tree.openWindow(message)
  } else if (message.action === 'focusTab') {
    Tree.focusTabAndWindow(message)
  } else if (message.action === 'focusWindow') {
    Tree.focusWindow(message)
  } else if (message.action === 'openWindowsInSameLocationUpdated') {
    Tree.updateWindowPositionInterval()
  } else if (message.action === 'toggleCollapseTab') {
    Tree.toggleCollapseTab(message.tabUid)
  } else if (message.action === 'toggleCollapseWindow') {
    Tree.toggleCollapseWindow(message.windowUid)
  } else if (message.action === 'deselectAllItems') {
    Tree.deselectAllItems()
  } else if (message.action === 'tabIndentIncrease') {
    Tree.tabIndentIncrease(message.tabUids)
  } else if (message.action === 'tabIndentDecrease') {
    Tree.tabIndentDecrease(message.tabUids)
  } else if (message.action === 'moveTabs') {
    Tree.moveTabs(
      message.tabUIDs,
      message.targetWindowUid,
      message.targetIndex,
      message.parentUid,
      message.copy,
    )
  } else if (message.action === 'moveWindows') {
    Tree.moveWindows(message.windowUIDs, message.targetIndex, message.copy)
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
