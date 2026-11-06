import { i18n } from '@/services/i18n'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import type { PendingItem } from '@/types/session-tree'

const CREATION_EVENT_TIMEOUT_MS = 15000
const CREATION_EVENT_POLL_MS = 100

/**
 * How extension-created tabs and windows are told apart from the user's:
 *
 * Firefox fires onCreated before tabs.create() or windows.create() resolves,
 * so a listener can see an extension tab before its creator knows the ID.
 * Each creator counts itself as unregistered until create() returns, then
 * claims the returned IDs in the pending map and stops counting itself in the
 * same synchronous step.
 *
 * A listener therefore only has to wait while some create() call has not yet
 * returned. Once none are outstanding, an ID nobody claimed belongs to the
 * user. Waiting for whole creations to finish instead would hold every user
 * tab behind an extension tab whose event is slow or never arrives.
 */

function waitForListenerResolution(
  pendingItems: Map<number, PendingItem>,
  id: number,
  itemType: 'tab' | 'window',
): Promise<void> {
  return new Promise((resolve, reject) => {
    let elapsedMs = 0
    const interval = setInterval(() => {
      const item = pendingItems.get(id)
      if (item?.listenerResolved) {
        pendingItems.delete(id)
        clearInterval(interval)
        resolve()
        return
      }
      elapsedMs += CREATION_EVENT_POLL_MS
      if (elapsedMs >= CREATION_EVENT_TIMEOUT_MS) {
        clearInterval(interval)
        reject(
          new Error(
            i18n.t(
              itemType === 'tab'
                ? 'tabCreationTimeout'
                : 'windowCreationTimeout',
            ),
          ),
        )
      }
    }, CREATION_EVENT_POLL_MS)
  })
}

/**
 * Answers a creation listener: true once a creator has claimed the ID, false
 * once no create() call is still waiting for the ID Firefox will return.
 */
function waitForCreatorClaim(
  pendingItems: Map<number, PendingItem>,
  id: number,
  unregisteredCreations: () => number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const settle = (): boolean => {
      const item = pendingItems.get(id)
      if (item?.creatorResolved) {
        item.listenerResolved = true
        resolve(true)
        return true
      }
      if (unregisteredCreations() === 0) {
        resolve(false)
        return true
      }
      return false
    }
    if (settle()) return
    const interval = setInterval(() => {
      if (settle()) clearInterval(interval)
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
 * Checks if a tab was created by the extension.
 * Returns true if the tab was created by the extension, false if created by user action.
 * This function is called by the onCreated and onAttached listeners for tabs.
 *
 * @param {number} tabId - The ID of the tab to check.
 * @returns {Promise<boolean>} A promise that resolves to true if tab was created by extension.
 */
export function isNewTabExtensionGenerated(tabId: number): Promise<boolean> {
  return waitForCreatorClaim(
    OnCreatedQueue.pendingTabs,
    tabId,
    () => OnCreatedQueue.unregisteredTabCreations,
  )
}

/**
 * Checks if a window was created by the extension.
 * Returns true if the window was created by the extension, false if created by user action.
 * This function is called by the onCreated listener for new windows.
 *
 * @param {number} windowId - The ID of the window to check.
 * @returns {Promise<boolean>} A promise that resolves to true if window was created by extension.
 */
export function isNewWindowExtensionGenerated(
  windowId: number,
): Promise<boolean> {
  return waitForCreatorClaim(
    OnCreatedQueue.pendingWindows,
    windowId,
    () => OnCreatedQueue.unregisteredWindowCreations,
  )
}

/**
 * Creates a new tab and waits for both the creation event and listener
 * acknowledgment before resolving. This ensures the tab is fully initialized
 * before continuing.
 *
 * The function:
 * 1. Counts the creation as unregistered
 * 2. Creates new tab
 * 3. Claims the tab ID and stops counting the creation
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
  OnCreatedQueue.unregisteredTabCreations++
  const tab = await browser.tabs.create(properties).catch((error) => {
    console.error('Error creating tab:', error)
    releaseUnregisteredCreations(0, 1)
    throw error
  })
  if (tab.id !== undefined) addPendingTabToQueue(tab.id, true, false)
  releaseUnregisteredCreations(0, 1)
  if (tab.id === undefined) {
    console.error('Tab ID is undefined')
    throw new Error(i18n.t('tabCreationNoId'))
  }
  try {
    await waitForListenerResolution(OnCreatedQueue.pendingTabs, tab.id, 'tab')
  } catch (error) {
    OnCreatedQueue.pendingTabs.delete(tab.id)
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
 * 1. Counts the window and its requested tabs as unregistered
 * 2. Creates new window
 * 3. Claims the window and tab IDs and stops counting them
 * 4. Waits for listeners to resolve
 *
 * @param {Object} properties - The properties to create the window with
 * @returns {Promise<browser.windows.Window>} The fully initialized window object
 * @throws {Error} If window creation fails or window ID is undefined
 *
 */
export async function createWindowAndWait(
  properties?: browser.windows._CreateCreateData,
): Promise<browser.windows.Window> {
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
  OnCreatedQueue.unregisteredWindowCreations++
  OnCreatedQueue.unregisteredTabCreations += tabCount

  const window = await browser.windows
    .create(properties || {})
    .catch((error) => {
      console.error('Error creating window:', error)
      releaseUnregisteredCreations(1, tabCount)
      throw error
    })
  if (window.id !== undefined) addPendingWindowToQueue(window.id, true, false)
  if (tabCount > 0) {
    for (const tab of window.tabs ?? []) {
      if (tab.id !== undefined) addPendingTabToQueue(tab.id, true, false)
    }
  }
  releaseUnregisteredCreations(1, tabCount)
  try {
    if (window.id === undefined || !window.tabs) {
      throw new Error(i18n.t('windowCreationIncomplete'))
    }
    if (tabCount > 0 && window.tabs.some((tab) => tab.id === undefined)) {
      throw new Error(i18n.t('tabIdMissing'))
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

    await waitForListenerResolution(
      OnCreatedQueue.pendingWindows,
      window.id,
      'window',
    )
    if (tabCount > 0) {
      await Promise.all(
        window.tabs.map((tab) =>
          waitForListenerResolution(OnCreatedQueue.pendingTabs, tab.id!, 'tab'),
        ),
      )
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
    if (window.id !== undefined) {
      await browser.windows.remove(window.id).catch((removeError) => {
        console.error('Error removing partially created window:', removeError)
      })
    }
    throw error
  }
}

function releaseUnregisteredCreations(windows: number, tabs: number): void {
  OnCreatedQueue.unregisteredWindowCreations = Math.max(
    0,
    OnCreatedQueue.unregisteredWindowCreations - windows,
  )
  OnCreatedQueue.unregisteredTabCreations = Math.max(
    0,
    OnCreatedQueue.unregisteredTabCreations - tabs,
  )
}
