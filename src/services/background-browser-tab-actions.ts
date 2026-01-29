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
 * Reloads a tab in the browser.
 *
 * @param {Object} message - The message object containing tab information.
 * @param {number} message.tabId - The ID of the tab to be reloaded.
 */
export function reloadTab(message: { tabId: number }): void {
  browser.tabs.reload(message.tabId).catch((error) => {
    console.error('Error reloading tab:', error)
  })
}

/**
 * Pins a tab in the browser.
 *
 * @param {number} tabId - The ID of the tab to be pinned.
 */
export function pinTab(tabId: number): void {
  browser.tabs.update(tabId, { pinned: true }).catch((error) => {
    console.error('Error pinning tab:', error)
  })
}

/**
 * Unpins a tab in the browser.
 *
 * @param {number} tabId - The ID of the tab to be unpinned.
 */
export function unpinTab(tabId: number): void {
  browser.tabs.update(tabId, { pinned: false }).catch((error) => {
    console.error('Error unpinning tab:', error)
  })
}
