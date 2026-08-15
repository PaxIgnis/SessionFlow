import * as Messages from '@/services/foreground-messages'
import { openModal } from '@/services/modal-state'
import { Selection } from '@/services/selection'
import { ContextMenuItem } from '@/types/context-menu'
import { State } from '@/types/session-tree'

export const contextMenuItemsWindow: Record<string, () => ContextMenuItem> = {
  newWindow: () => {
    return {
      id: 'newWindow',
      label: 'New Window',
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

  saveWindow: () => {
    return {
      id: 'saveWindow',
      label: 'Save',
      icon: 'save',
      enabled: atLeastOneSelectedWindowOpen(),
      action: () => Messages.saveWindows(Selection.getSelectedWindows()),
    }
  },

  editWindowTitle: () => {
    return {
      id: 'editWindowTitle',
      label: 'Edit Title',
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
