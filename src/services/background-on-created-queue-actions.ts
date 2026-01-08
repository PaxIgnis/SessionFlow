import { OnCreatedQueue } from '@/services/background-on-created-queue'

/**
 * Adds a tab to the pending tabs queue or updates an existing entry.
 * Tabs in this queue are tracked to coordinate between tab creation
 * and the onCreated event listener.
 *
 * When a tab is created, both the creator and listener must resolve
 * before the tab is considered complete. This function manages the
 * resolution flags for both parties.
 *
 * @param {number} tabId - The ID of the tab to add/update
 * @param {boolean} creatorResolved - Flag indicating if creator has resolved
 * @param {boolean} listenerResolved - Flag indicating if listener has resolved
 */
export function addPendingTabToQueue(
  tabId: number,
  creatorResolved: boolean,
  listenerResolved: boolean
): void {
  if (!OnCreatedQueue.pendingTabs.has(tabId)) {
    OnCreatedQueue.pendingTabs.set(tabId, {
      id: tabId,
      complete: false,
      creatorResolved: creatorResolved,
      listenerResolved: listenerResolved,
    })
  } else {
    const tab = OnCreatedQueue.pendingTabs.get(tabId)
    if (tab) {
      if (creatorResolved) {
        tab.creatorResolved = true
      } else if (listenerResolved) {
        tab.listenerResolved = true
      }
    }
  }
}

/**
 * Adds a window to the pending windows queue or updates an existing entry.
 * Windows in this queue are tracked to coordinate between window creation
 * and the onCreated event listener.
 *
 * When a window is created, both the creator and listener must resolve
 * before the window is considered complete. This function manages the
 * resolution flags for both parties.
 *
 * @param {number} windowId - The ID of the window to add/update
 * @param {boolean} creatorResolved - Flag indicating if creator has resolved
 * @param {boolean} listenerResolved - Flag indicating if listener has resolved
 */
export function addPendingWindowToQueue(
  windowId: number,
  creatorResolved: boolean,
  listenerResolved: boolean
): void {
  if (!OnCreatedQueue.pendingWindows.has(windowId)) {
    OnCreatedQueue.pendingWindows.set(windowId, {
      id: windowId,
      complete: false,
      creatorResolved: creatorResolved,
      listenerResolved: listenerResolved,
    })
  } else {
    const window = OnCreatedQueue.pendingWindows.get(windowId)
    if (window) {
      if (creatorResolved) {
        window.creatorResolved = true
      } else if (listenerResolved) {
        window.listenerResolved = true
      }
    }
  }
}

/**
 * Checks if a tab was created by the extension by tracking it in the pending tabs queue.
 * Returns true if the tab was created by the extension, false if created by user action.
 * This function is called be the onCreated listener for new tabs.
 *
 * @param {number} tabId - The ID of the tab to check.
 * @returns {Promise<boolean>} A promise that resolves to true if tab was created by extension.
 */
export async function isNewTabExtensionGenerated(
  tabId: number
): Promise<boolean> {
  const waitForTabId = (tabId: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (OnCreatedQueue.pendingTabCount > 0) {
          addPendingTabToQueue(tabId, false, true)
          const tab = OnCreatedQueue.pendingTabs.get(tabId)
          if (tab && tab.complete) {
            OnCreatedQueue.pendingTabCount--
            OnCreatedQueue.pendingTabs.delete(tabId)
            clearInterval(interval)
            resolve(true)
          }
        } else {
          OnCreatedQueue.pendingTabs.delete(tabId)
          clearInterval(interval)
          resolve(false)
        }
      }, 100)
    })
  }
  return await waitForTabId(tabId)
}

/**
 * Checks if a window was created by the extension by tracking it in the pending windows queue.
 * Returns true if the window was created by the extension, false if created by user action.
 * This function is called be the onCreated listener for new windows.
 *
 * @param {number} windowId - The ID of the window to check.
 * @returns {Promise<boolean>} A promise that resolves to true if window was created by extension.
 */
export async function isNewWindowExtensionGenerated(
  windowId: number
): Promise<boolean> {
  const waitForWindowId = (windowId: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (OnCreatedQueue.pendingWindowCount > 0) {
          addPendingWindowToQueue(windowId, false, true)
          const window = OnCreatedQueue.pendingWindows.get(windowId)
          if (window && window.complete) {
            OnCreatedQueue.pendingWindowCount--
            OnCreatedQueue.pendingWindows.delete(windowId)
            clearInterval(interval)
            resolve(true)
          }
        } else {
          OnCreatedQueue.pendingWindows.delete(windowId)
          clearInterval(interval)
          resolve(false)
        }
      }, 100)
    })
  }
  return await waitForWindowId(windowId)
}

/**
 * Creates a new tab and waits for both the creation event and listener
 * acknowledgment before resolving. This ensures the tab is fully initialized
 * before continuing.
 *
 * The function:
 * 1. Increments pending tab count
 * 2. Creates new tab
 * 3. Adds tab to pending queue
 * 4. Waits for listener to resolve
 *
 * @param {Object} properties - The properties to create the tab with
 * @returns {Promise<browser.tabs.Tab>} The fully initialized tab object
 * @throws {Error} If tab creation fails or tab ID is undefined
 *
 */
export async function createTabAndWait(
  properties: browser.tabs._CreateCreateProperties
): Promise<browser.tabs.Tab> {
  OnCreatedQueue.pendingTabCount++
  const tab = await browser.tabs.create(properties).catch((error) => {
    console.error('Error creating tab:', error)
    OnCreatedQueue.pendingTabCount--
    throw error
  })
  const waitForTabId = (tabId: number): Promise<void> => {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const tab = OnCreatedQueue.pendingTabs.get(tabId)
        if (tab && tab.listenerResolved) {
          tab.complete = true
          clearInterval(interval)
          resolve()
        }
      }, 100)
    })
  }
  if (tab.id !== undefined) {
    addPendingTabToQueue(tab.id, true, false)
    await waitForTabId(tab.id)
  } else {
    console.error('Tab ID is undefined')
  }
  return tab
}

/**
 * Creates a new browser window and waits for both the creation event and listener
 * acknowledgment before resolving. This ensures the window is fully initialized
 * before continuing.
 *
 * The function:
 * 1. Increments pending window count
 * 2. Creates new window
 * 3. Adds window to pending queue
 * 4. Waits for listener to resolve
 *
 * @param {Object} properties - The properties to create the window with
 * @returns {Promise<browser.windows.Window>} The fully initialized window object
 * @throws {Error} If window creation fails or window ID is undefined
 *
 */
export async function createWindowAndWait(
  properties?: browser.windows._CreateCreateData
): Promise<browser.windows.Window> {
  OnCreatedQueue.pendingWindowCount++
  let tabCount = 0
  if (properties?.url) {
    // Handle both string and string[] cases
    tabCount = Array.isArray(properties.url) ? properties.url.length : 1
  }
  // case when creating window with specific tabIds (e.g., moving tabs to new window)
  if (properties?.tabId) {
    tabCount += Array.isArray(properties.tabId) ? properties.tabId.length : 1
  }
  if (tabCount > 0) OnCreatedQueue.pendingTabCount += tabCount

  const window = await browser.windows
    .create(properties || {})
    .catch((error) => {
      console.error('Error creating window:', error)
      OnCreatedQueue.pendingTabCount -= tabCount
      throw error
    })
  // Update window position if provided. This is necessary
  // because top/left are ignored before Firefox 109.
  if (properties?.left && properties?.top) {
    await browser.windows.update(window.id!, {
      left: properties.left,
      top: properties.top,
    })
  }

  const waitForWindowId = (windowId: number): Promise<void> => {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const window = OnCreatedQueue.pendingWindows.get(windowId)
        if (window && window.listenerResolved) {
          window.complete = true
          clearInterval(interval)
          resolve()
        }
      }, 100)
    })
  }
  if (!window.id || !window.tabs) {
    throw new Error('Window creation failed: ID or tabs undefined')
  }
  addPendingWindowToQueue(window.id, true, false)
  await waitForWindowId(window.id)
  if (tabCount > 0) {
    const promises: Promise<void>[] = []
    const waitForTabId = (tabId: number): Promise<void> => {
      return new Promise((resolve) => {
        const interval = setInterval(() => {
          const tab = OnCreatedQueue.pendingTabs.get(tabId)
          if (tab && tab.listenerResolved) {
            tab.complete = true
            clearInterval(interval)
            resolve()
          }
        }, 100)
      })
    }
    for (const tab of window.tabs) {
      if (!tab.id) {
        throw new Error('Tab ID is undefined')
      }
      addPendingTabToQueue(tab.id, true, false)
      promises.push(waitForTabId(tab.id))
    }
    await Promise.all(promises)
  }
  return window
}
