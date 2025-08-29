import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Tree } from '@/services/background-tree'
import { deferredEventsQueue } from '@/services/deferred.events.queue'
import { Settings } from '@/services/settings'
import * as Utils from '@/services/utils'
import { State, WindowPosition } from '@/types/session-tree'

/**
 * Sets the state of the window and all tabs to SAVED and resets the IDs.
 *
 * @param {number} windowSerialId - The Serial ID of the window to save.
 */
export function saveWindow(windowSerialId: number): void {
  const window = Tree.windowsList.find((w) => w.serialId === windowSerialId)
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
      active: win.focused,
      activeTabId: win.tabs?.find((tab) => tab.active)?.id,
      id: windowId,
      serialId: 0,
      selected: false,
      state: State.OPEN,
      tabs: [],
      collapsed: false,
    }
    Tree.windowsList.push(newWindow)
    Tree.serializeSessionTree()
    Tree.updateWindowTabs(windowId)
    deferredEventsQueue.processDeferredWindowEvents(windowId)
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
      window.tabs = win.tabs!.map((tab) => ({
        active: tab.active,
        id: tab.id!,
        serialId: 0,
        selected: false,
        state: tab.discarded ? State.DISCARDED : State.OPEN,
        windowSerialId: window.serialId,
        title: tab.title!,
        url: tab.url!,
      }))
      Tree.serializeSessionTree()
    }
  } catch (error) {
    console.error('Error updating window tabs:', error)
  }
}

/**
 * Removes a window from the session tree.
 *
 * @param {number} windowSerialId - The serial ID of the window to remove.
 */
export function removeWindow(windowSerialId: number): void {
  console.debug('Remove Window', windowSerialId)
  const index = Tree.windowsList.findIndex((w) => w.serialId === windowSerialId)
  if (index !== -1) {
    console.log(`Success Removing Window ${windowSerialId} from sessionTree`)
    Tree.windowsList.splice(index, 1)
    Tree.serializeSessionTree()
  } else {
    console.error(`Error Removing Window ${windowSerialId} from sessionTree`)
  }
}

/**
 * Updates the state of a window in the session tree.
 *
 * @param {number} windowSerialId - The serial ID of the window to update.
 * @param {State} state - The new state to assign to the window.
 */
export function updateWindowState(windowSerialId: number, state: State): void {
  const window = Tree.windowsList.find((w) => w.serialId === windowSerialId)
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
 * @param {number} windowSerialId - The current Serial ID of the window to be updated.
 * @param {number} newWindowId - The new ID to assign to the window.
 */
export function updateWindowId(
  windowSerialId: number,
  newWindowId: number
): void {
  const window = Tree.windowsList.find((w) => w.serialId === windowSerialId)
  if (window) {
    window.id = newWindowId
  }
  deferredEventsQueue.processDeferredWindowEvents(newWindowId)
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
 * @param {number} message.windowSerialId - The Serial ID of the window to be closed.
 */
export function closeWindow(message: {
  windowId: number
  windowSerialId: number
}): void {
  if (message.windowSerialId !== undefined) {
    Tree.removeWindow(message.windowSerialId)
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
 * @param {number} message.windowSerialId - The Serial ID of the window to be opened from sessionTree.
 */
export async function openWindow(message: {
  windowSerialId: number
}): Promise<void> {
  // First change the state of the window in sessionTree to from SAVED to OPEN
  Tree.updateWindowState(message.windowSerialId, State.OPEN)
  try {
    const sessionTreeWindow = Tree.windowsList.find(
      (w) => w.serialId === message.windowSerialId
    )
    if (!sessionTreeWindow) {
      throw new Error('Saved window not found')
    }
    const urls: string[] = []
    for (const tab of sessionTreeWindow.tabs) {
      let url = String(tab.url)
      // if the URL is a privileged URL, open a redirect page instead
      if (Utils.isPrivilegedUrl(url)) {
        const title = Tree.getTabTitle(sessionTreeWindow.serialId, tab.serialId)
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
    Tree.updateWindowId(message.windowSerialId, window.id)
    window.tabs.forEach((tab, index) => {
      Tree.updateTabId(
        sessionTreeWindow?.serialId,
        sessionTreeWindow?.tabs[index].serialId,
        tab.id!
      )
      Tree.updateTabState(
        sessionTreeWindow?.serialId,
        sessionTreeWindow?.tabs[index].serialId,
        State.OPEN
      )
    })
    if (Settings.values.openWindowWithTabsDiscarded && urls.length > 1) {
      for (const tab of sessionTreeWindow.tabs) {
        if (tab.state === State.SAVED) {
          Tree.openTab({
            tabSerialId: tab.serialId,
            windowSerialId: message.windowSerialId,
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
 * @param {number} message.windowSerialId - The Serial ID of the window to be saved.
 */
export function saveAndRemoveWindow(message: {
  windowId: number
  windowSerialId: number
}): void {
  Tree.saveWindow(message.windowSerialId)
  browser.windows.remove(message.windowId).catch((error) => {
    console.error('Error saving window:', error)
  })
}
