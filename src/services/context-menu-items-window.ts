import * as Messages from '@/services/foreground-messages'
import { Selection } from '@/services/selection'
import { ContextMenuItem } from '@/types/context-menu'
import { State } from '@/types/session-tree'

export const contextMenuItemsWindow: Record<string, () => ContextMenuItem> = {
  saveWindow: () => {
    return {
      id: 'saveWindow',
      label: 'Save',
      icon: 'save',
      enabled: atLeastOneSelectedWindowOpen(),
      action: () => Messages.saveWindows(Selection.getSelectedWindows()),
    }
  },

  closeWindow: () => {
    return {
      id: 'closeWindow',
      label: 'Close',
      icon: 'close',
      enabled: atLeastOneSelectedWindowOpen(),
      action: () => Messages.closeWindows(Selection.getSelectedWindows()),
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
