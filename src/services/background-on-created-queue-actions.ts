import { OnCreatedQueue } from '@/services/background-on-created-queue'

const CREATION_EVENT_TIMEOUT_MS = 15000
const CREATION_EVENT_POLL_MS = 100

function waitForListenerResolution(
  pendingItems: Map<number, { listenerResolved: boolean; complete: boolean }>,
  id: number,
  itemType: 'tab' | 'window',
): Promise<void> {
  return new Promise((resolve, reject) => {
    let elapsedMs = 0
    const interval = setInterval(() => {
      const item = pendingItems.get(id)
      if (item?.listenerResolved) {
        item.complete = true
        clearInterval(interval)
        resolve()
        return
      }
      elapsedMs += CREATION_EVENT_POLL_MS
      if (elapsedMs >= CREATION_EVENT_TIMEOUT_MS) {
        clearInterval(interval)
        reject(
          new Error(`Timed out waiting for Firefox ${itemType} creation event`),
        )
      }
    }, CREATION_EVENT_POLL_MS)
  })
}

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
  listenerResolved: boolean,
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
  listenerResolved: boolean,
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
  tabId: number,
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
  windowId: number,
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
  properties: browser.tabs._CreateCreateProperties,
): Promise<browser.tabs.Tab> {
  OnCreatedQueue.pendingTabCount++
  const tab = await browser.tabs.create(properties).catch((error) => {
    console.error('Error creating tab:', error)
    OnCreatedQueue.pendingTabCount--
    throw error
  })
  if (tab.id === undefined) {
    console.error('Tab ID is undefined')
    OnCreatedQueue.pendingTabCount = Math.max(
      0,
      OnCreatedQueue.pendingTabCount - 1,
    )
    throw new Error('Tab creation returned no ID')
  }
  addPendingTabToQueue(tab.id, true, false)
  try {
    await waitForListenerResolution(OnCreatedQueue.pendingTabs, tab.id, 'tab')
  } catch (error) {
    OnCreatedQueue.pendingTabs.delete(tab.id)
    OnCreatedQueue.pendingTabCount = Math.max(
      0,
      OnCreatedQueue.pendingTabCount - 1,
    )
    await browser.tabs.remove(tab.id).catch(() => undefined)
    throw error
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
  properties?: browser.windows._CreateCreateData,
): Promise<browser.windows.Window> {
  OnCreatedQueue.pendingWindowCount++
  let tabCount = 0
  if (properties?.url) {
    // Handle both string and string[] cases
    tabCount = Array.isArray(properties.url) ? properties.url.length : 1
  }
  // Capture pinned state for any existing tabs being moved (properties.tabId)
  const pinnedTabIds = new Set<number>()
  if (properties?.tabId) {
    const ids = Array.isArray(properties.tabId)
      ? properties.tabId
      : [properties.tabId]
    // record pinned state before moving tabs
    await Promise.all(
      ids.map(async (id) => {
        try {
          const t = await browser.tabs.get(id as number)
          if (t && t.pinned) pinnedTabIds.add(id as number)
        } catch (e) {
          console.error('Error reading tab before move:', id, e)
        }
      }),
    )
    tabCount += ids.length
  }
  if (tabCount > 0) OnCreatedQueue.pendingTabCount += tabCount

  const window = await browser.windows
    .create(properties || {})
    .catch((error) => {
      console.error('Error creating window:', error)
      OnCreatedQueue.pendingWindowCount = Math.max(
        0,
        OnCreatedQueue.pendingWindowCount - 1,
      )
      OnCreatedQueue.pendingTabCount = Math.max(
        0,
        OnCreatedQueue.pendingTabCount - tabCount,
      )
      throw error
    })
  try {
    if (window.id === undefined || !window.tabs) {
      throw new Error('Window creation failed: ID or tabs undefined')
    }
    if (tabCount > 0 && window.tabs.some((tab) => tab.id === undefined)) {
      throw new Error('Tab ID is undefined')
    }
    // Update window position if provided. This is necessary
    // because top/left are ignored before Firefox 109.
    const positionUpdate: browser.windows._UpdateUpdateInfo = {}
    if (properties?.left !== undefined) {
      positionUpdate.left = properties.left
    }
    if (properties?.top !== undefined) {
      positionUpdate.top = properties.top
    }
    if (Object.keys(positionUpdate).length > 0) {
      await browser.windows.update(window.id, positionUpdate)
    }

    addPendingWindowToQueue(window.id, true, false)
    await waitForListenerResolution(
      OnCreatedQueue.pendingWindows,
      window.id,
      'window',
    )
    if (tabCount > 0) {
      const promises: Promise<void>[] = []
      for (const tab of window.tabs) {
        if (!tab.id) {
          throw new Error('Tab ID is undefined')
        }
        addPendingTabToQueue(tab.id, true, false)
        promises.push(
          waitForListenerResolution(OnCreatedQueue.pendingTabs, tab.id, 'tab'),
        )
      }
      await Promise.all(promises)
      // then pin tabs that were previously pinned
      for (const tab of window.tabs) {
        if ((tab.id && pinnedTabIds.has(tab.id)) || tab.pinned) {
          await browser.tabs.update(tab.id!, { pinned: true })
        }
      }
    }
    return window
  } catch (error) {
    if (window.id !== undefined) {
      OnCreatedQueue.pendingWindows.delete(window.id)
    }
    for (const tab of window.tabs ?? []) {
      if (tab.id !== undefined) OnCreatedQueue.pendingTabs.delete(tab.id)
    }
    OnCreatedQueue.pendingWindowCount = Math.max(
      0,
      OnCreatedQueue.pendingWindowCount - 1,
    )
    OnCreatedQueue.pendingTabCount = Math.max(
      0,
      OnCreatedQueue.pendingTabCount - tabCount,
    )
    if (window.id !== undefined) {
      await browser.windows.remove(window.id).catch((removeError) => {
        console.error('Error removing partially created window:', removeError)
      })
    }
    throw error
  }
}
