import { DeferredEventsQueue } from '@/services/background-deferred-events-queue'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import * as Utils from '@/services/utils'
import { State, Tab } from '@/types/session-tree'

/**
 * Adds a tab to the session tree.
 *
 * @param {boolean} active - Whether the tab is active.
 * @param {number} windowId - The ID of the window containing the tab.
 * @param {number} tabId - The ID of the tab to add.
 * @param {boolean} selected - Whether the tab is selected.
 * @param {State} state - The state of the tab.
 * @param {string} title - The title of the tab.
 * @param {string} url - The URL of the tab.
 * @param {number} index - The index to insert the tab at, if not provided the tab is added to the end.
 */
export function addTab(
  active: boolean,
  windowId: number,
  tabId: number,
  selected: boolean,
  state: State,
  title: string,
  url: string,
  index?: number,
  isParent?: boolean,
  indentLevel?: number
): void {
  console.log('Tab Added in background.ts', windowId, tabId, title, url)
  const window = Tree.windowsList.find((w) => w.id === windowId)
  if (!window) {
    console.error('Error adding tab, could not find window:', windowId)
    return
  }
  if (index !== undefined) {
    window.tabs.splice(index, 0, {
      active: active,
      id: tabId,
      serialId: 0,
      selected: false,
      state,
      title,
      url,
      windowSerialId: window.serialId,
      isParent: isParent ?? false,
      indentLevel: indentLevel ?? 1,
    })
  } else {
    window.tabs.push({
      active: active,
      id: tabId,
      selected: selected,
      serialId: 0,
      state,
      title,
      url,
      windowSerialId: window.serialId,
      isParent: isParent ?? false,
      indentLevel: indentLevel ?? 1,
    })
  }
  Tree.serializeSessionTree()
  DeferredEventsQueue.processDeferredTabEvents(tabId)
}

/**
 * Removes a tab from the session tree and updates the state.
 *
 * @param {number} windowSerialId - The serial ID of the window containing the tab.
 * @param {number} tabSerialId - The serial ID of the tab to be removed.
 */
export function removeTab(windowSerialId: number, tabSerialId: number): void {
  const window = Tree.windowsList.find((w) => w.serialId === windowSerialId)
  if (window) {
    const index = window.tabs.findIndex((tab) => tab.serialId === tabSerialId)
    if (index !== -1) {
      console.log('removeTab success', windowSerialId, tabSerialId)
      window.tabs.splice(index, 1)
      Tree.serializeSessionTree()
    } else {
      console.error('Error removing tab:', windowSerialId, tabSerialId)
    }
  }
}

/**
 * Updates the state, title, URL and id of a tab in the session tree.
 *
 * @param {Object} id - An object containing the windowId and tabId of the tab to be updated.
 * @param {Partial<Tab>} tabContents - An object containing the updated properties for the tab.
 */
export function updateTab(
  id: { windowId: number; tabId: number },
  tabContents: Partial<Tab>
): void {
  const window = Tree.windowsList.find((w) => w.id === id.windowId)
  if (!window) {
    DeferredEventsQueue.addDeferredWindowEvent(id.windowId, () =>
      Tree.updateTab(id, tabContents)
    )
    return
  }
  const tab = window.tabs.find((t) => t.id === id.tabId) as Tab
  if (!tab) {
    DeferredEventsQueue.addDeferredTabEvent(id.tabId, () =>
      Tree.updateTab(id, tabContents)
    )
    return
  }
  // If the tab object exists update the new values
  Object.assign(tab, tabContents)
}

/**
 * Updates the id of a tab in the session tree
 *
 * @param {number} windowSerialId - The current Serial ID of the window to be updated.
 * @param {number} tabSerialId - The current Serial ID of the tab to be updated.
 * @param {number} newTabId - The new ID to assign to the tab.
 */
export function updateTabId(
  windowSerialId: number,
  tabSerialId: number,
  newTabId: number
): void {
  const window = Tree.windowsList.find((w) => w.serialId === windowSerialId)
  if (window) {
    const tab = window.tabs.find((t) => t.serialId === tabSerialId)
    if (tab) {
      tab.id = newTabId
    }
    DeferredEventsQueue.processDeferredTabEvents(newTabId)
  }
}

/**
 * Updates the state of a tab in the session tree.
 *
 * @param {number} windowSerialId - The serial ID of the window containing the tab.
 * @param {number} tabSerialId - The serial ID of the tab to update.
 * @param {State} state - The new state to assign to the tab.
 */
export function updateTabState(
  windowSerialId: number,
  tabSerialId: number,
  state: State
): void {
  const window = Tree.windowsList.find((w) => w.serialId === windowSerialId)
  if (window) {
    const tab = window.tabs.find((t) => t.serialId === tabSerialId)
    if (tab) {
      tab.state = state
      if (state === State.SAVED) {
        tab.savedTime = Date.now()
      }
    }
  }
}

/**
 * Sets the state of the tab to SAVED and resets the ID.
 *
 * @param {number} windowSerialId - The Serial ID of the window containing the tab.
 * @param {number} tabSerialId - The Serial ID of the tab to save.
 */
export function setTabSaved(windowSerialId: number, tabSerialId: number): void {
  const window = Tree.windowsList.find((w) => w.serialId === windowSerialId)
  if (window) {
    const tab = window.tabs.find((t) => t.serialId === tabSerialId)
    if (tab) {
      tab.state = State.SAVED
      tab.id = -1
      tab.savedTime = Date.now()
      tab.active = false
    }
  }
}

/**
 * Updates active tab status in session tree
 */
export function tabOnActivated(
  activeInfo: browser.tabs._OnActivatedActiveInfo,
  tries: number = 0
): void {
  const window = Tree.windowsList.find((w) => w.id === activeInfo.windowId)
  const activeTab = Tree.windowsList
    .find((w) => w.id === activeInfo.windowId)
    ?.tabs.find((t) => t.id === activeInfo.tabId)
  const previousActiveTab = Tree.windowsList
    .find((w) => w.id === activeInfo.windowId)
    ?.tabs.find((t) => t.id === activeInfo.previousTabId)
  // remove active status from previous active tab (not when detached/attached)
  if (activeInfo.previousTabId !== activeInfo.tabId && previousActiveTab) {
    previousActiveTab.active = false
  }
  // if window or activeTab is undefined, wait and try again
  if (!window || !activeTab) {
    if (tries > 0) {
      setTimeout(() => {
        tabOnActivated(activeInfo, tries - 1)
      }, 100)
    }
    return
  }
  window.activeTabId = activeInfo.tabId
  activeTab.active = true
}

/**
 * Returns the title of a tab in the session tree.
 *
 * @param {number} windowSerialId - The serial ID of the window containing the tab.
 * @param {number} tabSerialId - The serial ID of the tab to get the title of.
 * @returns {string} The title of the tab, or an empty string if not found.
 */
export function getTabTitle(
  windowSerialId: number,
  tabSerialId: number
): string {
  const window = Tree.windowsList.find((w) => w.serialId === windowSerialId)
  if (window) {
    const tab = window.tabs.find((t) => t.serialId === tabSerialId)
    if (tab) {
      return tab.title
    }
  }
  return ''
}

/**
 * Returns the state of a tab in the session tree.
 *
 * @param {number} windowSerialId - The serial ID of the window containing the tab.
 * @param {number} tabSerialId - The serial ID of the tab to get the state of.
 * @returns {State} The state of the tab.
 */
export function getTabState(
  windowSerialId: number,
  tabSerialId: number
): State {
  const window = Tree.windowsList.find((w) => w.serialId === windowSerialId)
  if (window) {
    const tab = window.tabs.find((t) => t.serialId === tabSerialId)
    if (tab) {
      return tab.state
    }
  }
  return State.OTHER
}

/**
 * Closes a tab by removing it from the browser and removing it from the session tree.
 *
 * @param {Object} message - The message object containing tab and window information.
 * @param {number} message.tabId - The ID of the tab to be closed.
 * @param {number} message.tabSerialId - The Serial ID of the tab to be closed.
 * @param {number} message.windowSerialId - The Serial ID of the window containing the tab.
 */
export function closeTab(message: {
  tabId: number
  tabSerialId: number
  windowSerialId: number
}): void {
  if (
    message.tabSerialId !== undefined &&
    message.windowSerialId !== undefined
  ) {
    Tree.removeTab(message.windowSerialId, message.tabSerialId)
    // if this is the last open tab in the window but there are other saved tabs then
    // update the window state to SAVED and reset id
    const window = Tree.windowsList.find(
      (w) => w.serialId === message.windowSerialId
    )
    if (window) {
      const openTabs = window.tabs.filter(
        (tab) => tab.state === State.OPEN || tab.state === State.DISCARDED
      )
      if (window.tabs.length > 0 && openTabs.length === 0) {
        Tree.updateWindowState(message.windowSerialId, State.SAVED)
        Tree.updateWindowId(message.windowSerialId, -1)
      } else if (window.tabs.length === 0) {
        // if there are no tabs left in the window, remove the window
        Tree.removeWindow(message.windowSerialId)
      }
    }
  }
  // only close the tab if it is open
  if (message.tabId === -1 || message.tabId === 0) {
    return
  }
  browser.tabs
    .get(message.tabId)
    .then((tab) => {
      if (tab !== undefined) {
        browser.tabs.remove(message.tabId)
      }
    })
    .catch((error) => {
      console.debug('Error closing tab:', error)
    })
}

/**
 * Focuses a tab by updating the browser tab to be active.
 *
 * @param {Object} message - The message object containing tab information.
 * @param {number} message.tabId - The ID of the tab to be focused.
 */
export function focusTab(message: { tabId: number }): void {
  browser.tabs.update(message.tabId, { active: true }).catch((error) => {
    console.error('Error focusing tab:', error)
  })
}

/**
 * Opens a tab by creating it in the browser and updating the session tree.
 *
 * @param {Object} message - The message object containing tab and window information.
 * @param {number} message.tabSerialId - The Serial ID of the tab to be opened.
 * @param {number} message.windowSerialId - The Serial ID of the window containing the tab.
 * @param {string} message.url - The URL to be opened in the tab.
 */
export async function openTab(message: {
  tabSerialId: number
  windowSerialId: number
  url?: string
  discarded?: boolean
}): Promise<void> {
  const sessionTreeWindow = Tree.windowsList.find(
    (w) => w.serialId === message.windowSerialId
  )
  if (!sessionTreeWindow) {
    throw new Error('Saved window not found')
  }
  const sessionTreeTab = sessionTreeWindow.tabs.find(
    (t) => t.serialId === message.tabSerialId
  )
  if (!sessionTreeTab) {
    throw new Error('Saved tab not found')
  }
  let url = message.url
  if (url === undefined) url = sessionTreeTab.url
  // if the URL is a privileged URL, open a redirect page instead
  if (Utils.isPrivilegedUrl(url)) {
    const title = Tree.getTabTitle(message.windowSerialId, message.tabSerialId)
    url = Utils.getRedirectUrl(url, title)
  } else if (
    url === 'about:newtab' ||
    url === 'about:blank' ||
    url === 'chrome://browser/content/blanktab.html'
  ) {
    // don't set the URL for new tabs
    url = undefined
  }
  Tree.updateTabState(
    message.windowSerialId,
    message.tabSerialId,
    message.discarded ? State.DISCARDED : State.OPEN
  )
  if (sessionTreeWindow.state === State.SAVED) {
    // if the window is saved, open the window first
    Tree.updateWindowState(message.windowSerialId, State.OPEN)
    const properties: browser.windows._CreateCreateData = {}
    if (url) properties.url = url
    if (
      Settings.values.openWindowsInSameLocation &&
      sessionTreeWindow.windowPosition
    ) {
      properties.left = sessionTreeWindow.windowPosition.left
      properties.top = sessionTreeWindow.windowPosition.top
      properties.width = sessionTreeWindow.windowPosition.width
      properties.height = sessionTreeWindow.windowPosition.height
    }
    try {
      const window = await OnCreatedQueue.createWindowAndWait(properties).catch(
        (error) => {
          console.error('Error creating window:', error)
          // revert changes since window wasn't created
          Tree.updateWindowState(message.windowSerialId, State.SAVED)
          Tree.updateTabState(
            message.windowSerialId,
            message.tabSerialId,
            State.SAVED
          )
          return
        }
      )
      if (!window) {
        console.error('Window is undefined')
        return
      }
      // because Firefox doesn't support opening unfocused windows, we send focus back
      if (!Settings.values.focusWindowOnOpen && Tree.sessionTreeWindowId) {
        Tree.focusWindow({ windowId: Tree.sessionTreeWindowId })
      }
      if (!window.id) {
        throw new Error('Window ID is undefined')
      }
      // then update the saved window object id to represent the newly opened window
      Tree.updateWindowId(message.windowSerialId, window.id)
      const tab = window.tabs![0]
      Tree.updateTabId(message.windowSerialId, message.tabSerialId, tab.id!)
      Tree.updateTabState(
        message.windowSerialId,
        message.tabSerialId,
        State.OPEN
      )
    } catch (error) {
      console.error('Error opening window:', error)
    }
  } else {
    const properties: browser.tabs._CreateCreateProperties = {}
    if (url) properties.url = url
    // if the window is currently open
    properties.windowId = sessionTreeWindow.id
    if (message.discarded) {
      // some urls cannot be opened as discarded
      if (url && Utils.discardedUrlPrecheck(url)) {
        properties.discarded = true
        properties.active = false
        properties.title = sessionTreeTab.title
      } else {
        properties.active = false
        properties.discarded = false
      }
    } else {
      properties.active = true
    }

    // find id of first open tab to the right
    const tabToRightIndex = sessionTreeWindow.tabs
      .filter(
        (tab) => tab.state === State.OPEN || tab.state === State.DISCARDED
      )
      .findIndex(
        (tab, index, array) =>
          array[index - 1]?.serialId === message.tabSerialId
      )
    if (tabToRightIndex !== -1) {
      properties.index = tabToRightIndex - 1
    }
    try {
      const tab = await OnCreatedQueue.createTabAndWait(properties).catch(
        (error) => {
          console.error('Error creating tab:', error)
          // revert changes since window wasn't created
          Tree.updateTabState(
            message.windowSerialId,
            message.tabSerialId,
            State.SAVED
          )
          return
        }
      )
      if (!tab) {
        console.error('Tab is undefined')
        return
      }
      Tree.updateTabId(message.windowSerialId, message.tabSerialId, tab.id!)
      Tree.updateTabState(
        message.windowSerialId,
        message.tabSerialId,
        tab.discarded ? State.DISCARDED : State.OPEN
      )
    } catch (error) {
      console.error('Error opening tab:', error)
    }
  }
}

/**
 * Saves a tab by removing it from the browser and updating the session tree.
 * If it is the last open tab in the window, the window state is updated to SAVED and the ID is reset.
 * Then the same is done for the tab and finally the tab is removed from the browser.
 *
 * @param {Object} message - The message object containing tab and window information.
 * @param {number} message.tabId - The ID of the tab to be saved.
 * @param {number} message.tabSerialId - The Serial ID of the tab to be saved.
 * @param {number} message.windowSerialId - The Serial ID of the window containing the tab.
 */
export function saveTab(message: {
  tabId: number
  tabSerialId: number
  windowSerialId: number
}): void {
  if (
    message.tabSerialId !== undefined &&
    message.windowSerialId !== undefined
  ) {
    if (
      Tree.getTabState(message.windowSerialId, message.tabSerialId) ===
      State.SAVED
    ) {
      // tab is already saved, do nothing
      return
    }
    // if this is the last open tab in the window, update the window state to SAVED and reset id
    const window = Tree.windowsList.find(
      (w) => w.serialId === message.windowSerialId
    )
    if (window) {
      const openTabs = window.tabs.filter(
        (tab) => tab.state === State.OPEN || tab.state === State.DISCARDED
      )
      if (openTabs.length === 1) {
        Tree.saveWindow(message.windowSerialId)
      }
    }
    Tree.setTabSaved(message.windowSerialId, message.tabSerialId)
  }
  browser.tabs.remove(message.tabId).catch((error) => {
    console.error('Error saving tab:', error)
  })
}

/**
 * Reloads a tab in the browser.
 *
 * @param {Object} message - The message object containing tab information.
 * @param {number} message.tabId - The ID of the tab to be reloaded.
 * @param {number} message.tabSerialId - The Serial ID of the tab to be reloaded.
 * @param {number} message.windowSerialId - The Serial ID of the window containing the tab.
 */
export function reloadTab(message: {
  tabId: number
  tabSerialId: number
  windowSerialId: number
}): void {
  browser.tabs.reload(message.tabId).catch((error) => {
    console.error('Error reloading tab:', error)
  })
}
