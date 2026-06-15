import * as Messages from '@/services/foreground-messages'
import { openModal } from '@/services/modal-state'
import { Selection } from '@/services/selection'
import {
  canDecreaseIndentSelectedItems,
  canIncreaseIndentSelectedItems,
} from '@/services/context-menu-actions'
import { ContextMenuItem } from '@/types/context-menu'
import { State } from '@/types/session-tree'

export const contextMenuItemsWindow: Record<string, () => ContextMenuItem> = {
  duplicateTreeItem: () => {
    return {
      id: 'duplicateTreeItem',
      label: 'Duplicate',
      icon: 'duplicate',
      enabled: Selection.getSelectedWindows().length > 0,
      action: () =>
        Messages.duplicateTreeItems(
          Selection.getSelectedWindows().map((window) => window.uid),
        ),
    }
  },

  treeItemIndentIncrease: () => {
    return {
      id: 'treeItemIndentIncrease',
      label: 'Increase Indent',
      icon: 'indent-increase',
      enabled: canIncreaseIndentSelectedItems(Selection.getSelectedWindows()),
      action: () =>
        Messages.treeItemIndentIncrease(
          Selection.getSelectedWindows().map((window) => window.uid),
        ),
    }
  },

  treeItemIndentDecrease: () => {
    return {
      id: 'treeItemIndentDecrease',
      label: 'Decrease Indent',
      icon: 'indent-decrease',
      enabled: canDecreaseIndentSelectedItems(Selection.getSelectedWindows()),
      action: () =>
        Messages.treeItemIndentDecrease(
          Selection.getSelectedWindows().map((window) => window.uid),
        ),
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

  closeWindow: () => {
    return {
      id: 'closeWindow',
      label: 'Close',
      icon: 'close',
      enabled: atLeastOneSelectedWindowOpen(),
      action: () => Messages.closeWindows(Selection.getSelectedWindows()),
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
