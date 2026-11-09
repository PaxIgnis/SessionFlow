import { i18n } from '@/services/i18n'
import * as Messages from '@/services/foreground-messages'
import { contextMenuItemsTab } from '@/services/context-menu-items-tab'
import { openModal } from '@/services/modal-state'
import { showNotification } from '@/services/notification-state'
import { Selection } from '@/services/selection'
import { collectContextMenuActionItems } from '@/services/selection-actions'
import { ContextMenuItem } from '@/types/context-menu'
import { State, type Tab, TreeItemType } from '@/types/session-tree'

export const contextMenuItemsWindow: Record<string, () => ContextMenuItem> = {
  newWindow: () => {
    return {
      id: 'newWindow',
      label: i18n.t('newWindowLabel'),
      icon: 'window',
      enabled: true,
      action: () => {
        void browser.windows.create().catch((error) => {
          console.error(
            'Failed to create a window from the context menu:',
            error,
          )
        })
      },
    }
  },

  newTab: () => {
    const windows = Selection.getSelectedWindows().filter(
      (window) => window.state === State.OPEN,
    )
    return {
      id: 'newTab',
      label: i18n.t('newTab'),
      enabled: windows.length > 0,
      action: () => {
        for (const window of windows) {
          void browser.tabs.create({ windowId: window.id }).catch((error) => {
            console.error(
              'Failed to create a tab from the context menu:',
              error,
            )
          })
        }
      },
    }
  },

  openWindow: () => {
    const windows = Selection.getSelectedWindows().filter(
      (window) => window.state === State.SAVED,
    )
    return {
      id: 'openWindow',
      label: i18n.t('open'),
      icon: 'open',
      enabled: windows.length > 0,
      action: () => Messages.openWindows(windows),
    }
  },

  // A window expands to all of its tabs, so these match the tab actions exactly.
  reloadWindow: () => ({
    ...contextMenuItemsTab.reloadTab(),
    id: 'reloadWindow',
    label: i18n.t('reloadTabs'),
  }),

  unloadWindow: () => ({
    ...contextMenuItemsTab.unloadTab(),
    id: 'unloadWindow',
    label: i18n.t('unloadTabs'),
  }),

  copyWindowUrls: () => {
    const urls = selectedWindowTabs()
      .map((tab) => tab.url)
      .filter(Boolean)
    return {
      id: 'copyWindowUrls',
      label: i18n.t('copyAllUrls'),
      enabled: urls.length > 0,
      action: () => void copyUrls(urls),
    }
  },

  saveWindow: () => {
    return {
      id: 'saveWindow',
      label: i18n.t('save'),
      icon: 'save',
      enabled: atLeastOneSelectedWindowOpen(),
      action: () => Messages.saveWindows(Selection.getSelectedWindows()),
    }
  },

  editWindowTitle: () => {
    return {
      id: 'editWindowTitle',
      label: i18n.t('editTitle'),
      icon: 'edit',
      enabled: onlySingleWindowSelected(),
      action: () => {
        const selectedWindows = Selection.getSelectedWindows()
        if (selectedWindows.length === 1) {
          openModal({ kind: 'editWindowTitle', window: selectedWindows[0] })
        }
      },
    }
  },
}

function selectedWindowTabs(): Tab[] {
  return collectContextMenuActionItems(
    Selection.getSelectedWindows(),
    'never',
  ).filter((item): item is Tab => item.type === TreeItemType.TAB)
}

async function copyUrls(urls: string[]): Promise<void> {
  try {
    // Request from the menu click gesture, before anything else is awaited.
    const granted = await browser.permissions.request({
      permissions: ['clipboardWrite'],
    })
    if (!granted) throw new Error('clipboardWrite permission was not granted')
    await navigator.clipboard.writeText(urls.join('\n'))
    showNotification(i18n.t('urlsCopied'))
  } catch (error) {
    console.error('Failed to copy window URLs:', error)
    showNotification(i18n.t('copyUrlsFailed'))
  }
}

function atLeastOneSelectedWindowOpen(): boolean {
  const selectedWindows = Selection.getSelectedWindows()
  for (const window of selectedWindows) {
    if (window.state === State.OPEN) {
      return true
    }
  }
  return false
}

function onlySingleWindowSelected(): boolean {
  const selectedWindows = Selection.getSelectedWindows()
  return selectedWindows.length === 1
}
