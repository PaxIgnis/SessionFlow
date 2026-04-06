import { Tree } from '@/services/background-tree'
import { openSessionTree } from '@/services/background-tree-actions'
import { updateWindowPositionInterval } from '@/services/background-tree-window-actions'
import { Settings } from '@/services/settings'

// Updates Extension badge Text and Title to show open tab/window count
export async function updateBadge() {
  const tabs = await browser.tabs.query({})
  const tabCount = tabs.length
  const windows = await browser.windows.getAll()
  const windowCount = windows.length
  await browser.browserAction.setBadgeText({ text: `${tabCount}` })
  await browser.browserAction.setTitle({
    title: `${windowCount} windows / ${tabCount} tabs`,
  })
}

/**
 * Calls the updateBadge function every second for 10 seconds after startup to ensure the badge is updated correctly.
 */
export async function updateBadgeOnStartup() {
  for (let i = 0; i < 10; i++) {
    await updateBadge()
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

export const initializeSettings = async () => {
  try {
    await Settings.loadSettingsFromStorage()
    if (Settings.values.openSessionTreeOnStartup) {
      setTimeout(() => {
        openSessionTree()
      }, 1000)
    }
    updateWindowPositionInterval()
  } catch (error) {
    console.error('Failed to initialize settings:', error)
  }
}

export function setupBrowserActionMenu(): void {
  browser.menus.create({
    id: 'open-sessiontree',
    title: 'Open SessionTree',
    onclick: () => {
      Tree.openSessionTree()
    },
    contexts: ['browser_action'],
  })

  browser.menus.create({
    id: 'open-settings',
    title: 'Settings',
    onclick: () => {
      browser.runtime.openOptionsPage()
    },
    contexts: ['browser_action'],
  })
}
