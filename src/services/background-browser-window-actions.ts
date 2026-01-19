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
