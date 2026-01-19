import { Browser } from '@/services/background-browser'

/**
 * Focuses a tab and corresponding window.
 *
 * @param {Object} message - The message object containing tab information.
 * @param {number} message.tabId - The ID of the tab to be focused.
 * @param {number} message.windowId - The ID of the window containing the tab.
 */
export function focusTabAndWindow(message: {
  tabId: number
  windowId: number
}): void {
  Browser.focusTab({ tabId: message.tabId })
  Browser.focusWindow({ windowId: message.windowId })
}
