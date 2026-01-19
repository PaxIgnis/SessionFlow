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
