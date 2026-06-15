import * as Messages from '@/services/foreground-messages'
import { openModal } from '@/services/modal-state'
import { Selection } from '@/services/selection'
import {
  canDecreaseIndentSelectedItems,
  canIncreaseIndentSelectedItems,
} from '@/services/context-menu-actions'
import { ContextMenuItem } from '@/types/context-menu'
import { State } from '@/types/session-tree'

export const contextMenuItemsTab: Record<string, () => ContextMenuItem> = {
  duplicateTreeItem: () => {
    return {
      id: 'duplicateTreeItem',
      label: 'Duplicate',
      icon: 'duplicate',
      enabled: Selection.getSelectedTabs().length > 0,
      action: () =>
        Messages.duplicateTreeItems(
          Selection.getSelectedTabs().map((tab) => tab.uid),
        ),
    }
  },

  openTab: () => {
    return {
      id: 'openTab',
      label: 'Open',
      icon: 'open',
      enabled: atLeastOneSelectedTabSaved(),
      action: () => Messages.openTabs(Selection.getSelectedTabs()),
    }
  },

  reloadTab: () => {
    return {
      id: 'reloadTab',
      label: 'Reload',
      icon: 'reload',
      enabled: atLeastOneSelectedTabOpen(),
      action: () => Messages.reloadTabs(Selection.getSelectedTabs()),
    }
  },

  saveTab: () => {
    return {
      id: 'saveTab',
      label: 'Save',
      icon: 'save',
      enabled: atLeastOneSelectedTabOpen(),
      action: () => Messages.saveTabs(Selection.getSelectedTabs()),
    }
  },

  closeTab: () => {
    return {
      id: 'closeTab',
      label: 'Close',
      icon: 'close',
      enabled: atLeastOneSelectedTabOpen(),
      action: () => Messages.closeTabs(Selection.getSelectedTabs()),
    }
  },

  pinTab: () => {
    return {
      id: 'pinTab',
      label: 'Pin',
      icon: 'pin',
      enabled: atLeastOneSelectedTabUnpinned(),
      action: () => Messages.pinTabs(Selection.getSelectedTabs()),
    }
  },

  unpinTab: () => {
    return {
      id: 'unpinTab',
      label: 'Unpin',
      icon: 'unpin',
      enabled: atLeastOneSelectedTabPinned(),
      action: () => Messages.unpinTabs(Selection.getSelectedTabs()),
    }
  },

  treeItemIndentIncrease: () => {
    return {
      id: 'treeItemIndentIncrease',
      label: 'Increase Indent',
      icon: 'indent-increase',
      enabled: canIncreaseIndentSelectedItems(Selection.getSelectedTabs()),
      action: () =>
        Messages.treeItemIndentIncrease(
          Selection.getSelectedTabs().map((tab) => tab.uid),
        ),
    }
  },

  treeItemIndentDecrease: () => {
    return {
      id: 'treeItemIndentDecrease',
      label: 'Decrease Indent',
      icon: 'indent-decrease',
      enabled: canDecreaseIndentSelectedItems(Selection.getSelectedTabs()),
      action: () =>
        Messages.treeItemIndentDecrease(
          Selection.getSelectedTabs().map((tab) => tab.uid),
        ),
    }
  },

  editLabel: () => {
    return {
      id: 'editLabel',
      label: 'Edit Label',
      icon: 'edit',
      enabled: onlySingleTabSelected(),
      action: () => {
        const selectedTabs = Selection.getSelectedTabs()
        if (selectedTabs.length === 1) {
          openModal({
            kind: 'editCustomLabel',
            uid: selectedTabs[0].uid,
            customLabel: selectedTabs[0].customLabel,
          })
        }
      },
    }
  },
}

function atLeastOneSelectedTabOpen(): boolean {
  const selectedTabs = Selection.getSelectedTabs()
  for (const tab of selectedTabs) {
    if (tab.state === State.OPEN || tab.state === State.DISCARDED) {
      return true
    }
  }
  return false
}

function atLeastOneSelectedTabSaved(): boolean {
  const selectedTabs = Selection.getSelectedTabs()
  for (const tab of selectedTabs) {
    if (tab.state === State.SAVED) {
      return true
    }
  }
  return false
}

function atLeastOneSelectedTabPinned(): boolean {
  const selectedTabs = Selection.getSelectedTabs()
  for (const tab of selectedTabs) {
    if (tab.pinned) {
      return true
    }
  }
  return false
}

function atLeastOneSelectedTabUnpinned(): boolean {
  const selectedTabs = Selection.getSelectedTabs()
  for (const tab of selectedTabs) {
    if (!tab.pinned) {
      return true
    }
  }
  return false
}

function onlySingleTabSelected(): boolean {
  const selectedTabs = Selection.getSelectedTabs()
  return selectedTabs.length === 1
}
