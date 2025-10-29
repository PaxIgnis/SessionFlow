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
}

function atLeastOneSelectedTabOpen(): boolean {
  const selectedTabs = Selection.getSelectedTabs()
  for (const tab of selectedTabs) {
    if (tab.state === State.OPEN) {
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
