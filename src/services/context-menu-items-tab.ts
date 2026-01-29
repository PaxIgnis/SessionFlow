import * as Messages from '@/services/foreground-messages'
import { Selection } from '@/services/selection'
import { ContextMenuItem } from '@/types/context-menu'
import { State } from '@/types/session-tree'

export const contextMenuItemsTab: Record<string, () => ContextMenuItem> = {
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

  tabIndentIncrease: () => {
    return {
      id: 'tabIndentIncrease',
      label: 'Increase Indent',
      icon: 'indent-increase',
      enabled: Selection.getSelectedTabs().length > 0,
      action: () => Messages.tabIndentIncrease(Selection.getSelectedTabs()),
    }
  },

  tabIndentDecrease: () => {
    return {
      id: 'tabIndentDecrease',
      label: 'Decrease Indent',
      icon: 'indent-decrease',
      enabled: Selection.getSelectedTabs().length > 0,
      action: () => Messages.tabIndentDecrease(Selection.getSelectedTabs()),
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
