import { DeferredEventsQueue } from '@/services/background-deferred-events-queue'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Tree } from '@/services/background-tree'
import { setTabVisibilityRecursively } from '@/services/background-tree-tab-actions'
import { Settings } from '@/services/settings'
import * as TreeUtils from '@/services/tree-utils'
import * as Utils from '@/services/utils'
import { State, WindowPosition } from '@/types/session-tree'

/**
 * Sets the state of the window and all tabs to SAVED and resets the IDs.
 *
 * @param {UID} windowUid - The UID of the window to save.
 */
export function saveWindow(windowUid: UID): void {
  const window = Tree.windowsByUid.get(windowUid)
  if (window) {
    window.state = State.SAVED
    window.id = -1
    window.savedTime = Date.now()
    window.active = false
    window.tabs.forEach((tab) => {
      tab.state = State.SAVED
      tab.id = -1
      tab.savedTime = Date.now()
      tab.active = false
    })
  }
}

/**
 * Adds a blank window to the session tree,
 * and then updates it with the current state in the browser.
 *
 * @param {number} windowId - The ID of the window to add.
 */
export async function addWindow(windowId: number): Promise<void> {
  console.log('Adding Window', windowId)
  if (!Tree.windowsList.some((w) => w.id === windowId)) {
    const win = await browser.windows.get(windowId, { populate: true })
    if (!win) {
      console.error('Window not found:', windowId)
      return
    }
    const newWindow = {
      uid: Utils.createUid(Tree.existingUidsSet),
      active: win.focused,
      activeTabId: win.tabs?.find((tab) => tab.active)?.id,
      id: windowId,
      selected: false,
      state: State.OPEN,
      tabs: [],
      collapsed: false,
      indentLevel: 0,
    }
    Tree.windowsList.push(newWindow)
    // TODO: use newWindow variable instead after foreground context independent data source is implemented
    Tree.windowsByUid.set(
      newWindow.uid,
      Tree.windowsList[Tree.windowsList.length - 1]
    )
    Tree.recomputeSessionTree()
    Tree.updateWindowTabs(windowId)
    DeferredEventsQueue.processDeferredWindowEvents(windowId)
  }
}

/**
 * Updates a window in the session tree to match the current state in the browser.
 *
 * @param {number} windowId - The ID of the window to update.
 * @returns {Promise<void>} A promise that resolves when the window has been updated.
 */
export async function updateWindowTabs(windowId: number): Promise<void> {
  try {
    const win = await browser.windows.get(windowId, { populate: true })
    const window = Tree.windowsList.find((w) => w.id === windowId)
    if (window) {
      // TODO: convert this to use addTab() in the future
      window.tabs = win.tabs!.map((tab) => ({
        uid: Utils.createUid(Tree.existingUidsSet),
        active: tab.active,
        id: tab.id!,
        selected: false,
        state: tab.discarded ? State.DISCARDED : State.OPEN,
        windowUid: window.uid,
        title: tab.title!,
        url: tab.url!,
        indentLevel: 1,
      }))
      for (const tab of window.tabs) {
        Tree.tabsByUid.set(tab.uid, tab)
      }
      Tree.recomputeSessionTree()
    }
  } catch (error) {
    console.error('Error updating window tabs:', error)
  }
}

/**
 * Removes a window from the session tree.
 *
 * @param {UID} windowUid - The UID of the window to remove.
 */
export function removeWindow(windowUid: UID): void {
  const index = Tree.windowsList.findIndex((w) => w.uid === windowUid)
  const window = Tree.windowsByUid.get(windowUid)
  if (window && index !== -1) {
    // remove uids of tabs and window from set and maps
    for (const tab of window.tabs) {
      Tree.existingUidsSet.delete(tab.uid)
      Tree.tabsByUid.delete(tab.uid)
    }
    Tree.existingUidsSet.delete(window.uid)
    Tree.windowsByUid.delete(window.uid)

    Tree.windowsList.splice(index, 1)
    Tree.recomputeSessionTree()
  } else {
    console.error(`Error Removing Window ${windowUid} from sessionTree`)
  }
}

/**
 * Updates the state of a window in the session tree.
 *
 * @param {UID} windowUid - The UID of the window to update.
 * @param {State} state - The new state to assign to the window.
 */
export function updateWindowState(windowUid: UID, state: State): void {
  const window = Tree.windowsByUid.get(windowUid)
  if (window) {
    window.state = state
    if (state === State.SAVED) {
      window.savedTime = Date.now()
    }
  }
}

/**
 * Updates the id of a window in the session tree
 *
 * @param {UID} windowUid - The UID of the window to be updated.
 * @param {number} newWindowId - The new ID to assign to the window.
 */
export function updateWindowId(windowUid: UID, newWindowId: number): void {
  const window = Tree.windowsByUid.get(windowUid)
  if (window) {
    window.id = newWindowId
  }
  DeferredEventsQueue.processDeferredWindowEvents(newWindowId)
}

/**
 * Updates the stored position of a window in the session tree.
 *
 * @param {number} windowId - The ID of the window to update.
 * @param {WindowPosition} position - The new position of the window.
 */
export function updateWindowPosition(
  windowId: number,
  position: WindowPosition
): void {
  const window = Tree.windowsList.find((w) => w.id === windowId)
  if (window) {
    window.windowPosition = position
  }
}

/**
 * Updates the interval for periodically checking and updating the position of open windows.
 * This function clears the existing interval and sets a new one based on the configured update interval.
 * Is called when the related settings are changed.
 *
 */
export function updateWindowPositionInterval(): void {
  // Clear existing interval
  if (Tree.windowPositionInterval) {
    clearInterval(Tree.windowPositionInterval)
  }
  if (!Settings.values.openWindowsInSameLocation) {
    return
  }
  // Calculate interval in milliseconds
  const intervalMs =
    Settings.values.openWindowsInSameLocationUpdateInterval *
    (Settings.values.openWindowsInSameLocationUpdateIntervalUnit === 'seconds'
      ? 1000
      : 60000)
  Tree.windowPositionInterval = setInterval(async () => {
    try {
      const windows = await browser.windows.getAll()
      windows.forEach((window) => {
        if (
          window.id &&
          window.id !== Tree.sessionTreeWindowId &&
          window.left &&
          window.top &&
          window.width &&
          window.height
        ) {
          updateWindowPosition(window.id, {
            left: window.left,
            top: window.top,
            width: window.width,
            height: window.height,
          })
        }
      })
    } catch (error) {
      console.error('Error updating window positions:', error)
    }
  }, intervalMs)
}

/**
 * Removes the active status from the previous active window and sets the new active window.
 *
 * @param {number} windowId - The ID of the window to set as active.
 * @param {number} tries - The number of tries left to set the active window.
 */
export function setActiveWindow(windowId: number, tries: number = 0): void {
  if (
    windowId === undefined ||
    windowId === -1 ||
    windowId === Tree.sessionTreeWindowId
  ) {
    return
  }

  const previousActiveWindow = Tree.windowsList.find((w) => w.active)
  if (previousActiveWindow) {
    previousActiveWindow.active = false
  }

  const activeWindow = Tree.windowsList.find((w) => w.id === windowId)
  // if activeWindow is undefined, wait and try again
  if (activeWindow) {
    activeWindow.active = true
  } else {
    if (tries > 0) {
      setTimeout(() => {
        setActiveWindow(windowId, tries - 1)
      }, 100)
    }
  }
}

/**
 * Closes a window by removing it from the browser and removing it from the session tree.
 *
 * @param {Object} message - The message object containing window information.
 * @param {number} message.windowId - The ID of the window to be closed.
 * @param {UID} message.windowUid - The UID of the window to be closed.
 */
export function closeWindow(message: {
  windowId: number
  windowUid: UID
}): void {
  if (message.windowUid !== undefined) {
    Tree.removeWindow(message.windowUid)
  }
  if (message.windowId === -1 || message.windowId === 0) {
    return
  }
  browser.windows
    .get(message.windowId)
    .then((window) => {
      if (window) {
        browser.windows.remove(message.windowId).catch((error) => {
          console.error('Error closing window:', error)
        })
      }
    })
    .catch(() => {
      console.debug('Window ID not found.', message.windowId)
    })
}

/**
 * Focuses a window by updating the browser window to be active.
 *
 * @param {Object} message - The message object containing window information.
 * @param {number} message.windowId - The ID of the window to be focused.
 */
export function focusWindow(message: { windowId: number }): void {
  browser.windows.update(message.windowId, { focused: true }).catch((error) => {
    console.error('Error focusing window:', error)
  })
}

/**
 * Opens a window by creating it in the browser and updating the session tree.
 *
 * @param {Object} message - The message object containing window information.
 * @param {UID} message.windowUid - The UID of the window to be opened from sessionTree.
 */
export async function openWindow(message: { windowUid: UID }): Promise<void> {
  // First change the state of the window in sessionTree to from SAVED to OPEN
  Tree.updateWindowState(message.windowUid, State.OPEN)
  try {
    const sessionTreeWindow = Tree.windowsByUid.get(message.windowUid)
    if (!sessionTreeWindow) {
      throw new Error('Saved window not found')
    }
    const urls: string[] = []
    for (const tab of sessionTreeWindow.tabs) {
      let url = String(tab.url)
      // if the URL is a privileged URL, open a redirect page instead
      if (Utils.isPrivilegedUrl(url)) {
        const title = Tree.getTabTitle(tab.uid)
        url = Utils.getRedirectUrl(url, title)
      } else if (
        url === 'about:newtab' ||
        url === 'chrome://browser/content/blanktab.html'
      ) {
        // don't set the URL for new tabs
        url = 'about:blank'
      }
      urls.push(url)
    }
    const properties: browser.windows._CreateCreateData = {}
    if (urls.length > 0) properties.url = urls
    if (Settings.values.openWindowWithTabsDiscarded) {
      if (urls.length > 1) {
        properties.url = urls[0]
      }
    }
    if (
      Settings.values.openWindowsInSameLocation &&
      sessionTreeWindow.windowPosition
    ) {
      properties.left = sessionTreeWindow.windowPosition.left
      properties.top = sessionTreeWindow.windowPosition.top
      properties.width = sessionTreeWindow.windowPosition.width
      properties.height = sessionTreeWindow.windowPosition.height
    }
    const window = await OnCreatedQueue.createWindowAndWait(properties)
    if (!Settings.values.focusWindowOnOpen && Tree.sessionTreeWindowId) {
      focusWindow({ windowId: Tree.sessionTreeWindowId })
    }
    if (!window.id || !window.tabs) {
      throw new Error('Window ID is undefined')
    }

    // then update the saved window object id to represent the newly opened window
    Tree.updateWindowId(message.windowUid, window.id)
    window.tabs.forEach((tab, index) => {
      Tree.updateTabId(sessionTreeWindow?.tabs[index].uid, tab.id!)
      Tree.updateTabState(sessionTreeWindow?.tabs[index].uid, State.OPEN)
    })
    if (Settings.values.openWindowWithTabsDiscarded && urls.length > 1) {
      for (const tab of sessionTreeWindow.tabs) {
        if (tab.state === State.SAVED) {
          Tree.openTab({
            tabUid: tab.uid,
            windowUid: message.windowUid,
            discarded: true,
          })
        }
      }
    }
  } catch (error) {
    console.error('Error opening window:', error)
  }
}

/**
 * Saves a window by removing it from the browser and updating the session tree.
 *
 * @param {Object} message - The message object containing window information.
 * @param {number} message.windowId - The ID of the window to be saved.
 * @param {UID} message.windowUid - The UID of the window to be saved.
 */
export function saveAndRemoveWindow(message: {
  windowId: number
  windowUid: UID
}): void {
  Tree.saveWindow(message.windowUid)
  browser.windows.remove(message.windowId).catch((error) => {
    console.error('Error saving window:', error)
  })
}

/**
 * Toggles the collapsed state of a window.
 * When collapsing, all tabs are hidden.
 * When expanding, root tabs are shown and child tab visibility respects their own collapsed states.
 *
 * @param {UID} windowUid - The UID of the window to toggle.
 */
export function toggleCollapseWindow(windowUid: UID): void {
  const win = Tree.windowsByUid.get(windowUid)
  if (!win) {
    console.error(`Window with UID ${windowUid} not found`)
    return
  }

  win.collapsed = !win.collapsed

  // build parent -> children map for tabs in this window
  const childrenMap = TreeUtils.buildChildrenMap(win.tabs)

  // root tabs are those without a parentUid
  const roots = win.tabs.filter((t) => t.parentUid === undefined)

  // if window is collapsed, hide all tabs; otherwise show roots and
  // let recursion respect per-tab collapsed flags
  if (win.collapsed) {
    setTabVisibilityRecursively(roots, childrenMap, false)
  } else {
    setTabVisibilityRecursively(roots, childrenMap, true)
  }
}
