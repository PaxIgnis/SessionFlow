import * as Messages from '@/services/foreground-messages'
import { openModal } from '@/services/modal-state'
import { Selection } from '@/services/selection'
import {
  collectContextMenuActionItems,
  type ContextMenuDescendantScope,
} from '@/services/selection-actions'
import { Settings } from '@/services/settings'
import { ContextMenuItem } from '@/types/context-menu'
import { State, type Tab, TreeItemType } from '@/types/session-tree'

export const contextMenuItemsTab: Record<string, () => ContextMenuItem> = {
  openTab: () => {
    const tabs = selectedTabsForScope(
      Settings.values.contextMenuOpenDescendants,
    )
    return {
      id: 'openTab',
      label: 'Open',
      icon: 'open',
      enabled: tabs.some((tab) => tab.state === State.SAVED),
      action: () => Messages.openTabs(tabs),
    }
  },

  reloadTab: () => {
    const tabs = selectedTabsForScope(
      Settings.values.contextMenuReloadDescendants,
    )
    return {
      id: 'reloadTab',
      label: 'Reload',
      icon: 'reload',
      enabled: tabs.some(isOpenTab),
      action: () => Messages.reloadTabs(tabs),
    }
  },

  saveTab: () => {
    const tabs = selectedTabsForScope(
      Settings.values.contextMenuSaveDescendants,
    )
    return {
      id: 'saveTab',
      label: 'Save',
      icon: 'save',
      enabled: tabs.some(isOpenTab),
      action: () => Messages.saveTabs(tabs),
    }
  },

  pinTab: () => {
    const tabs = selectedTabsForScope(Settings.values.contextMenuPinDescendants)
    return {
      id: 'pinTab',
      label: 'Pin',
      icon: 'pin',
      enabled: tabs.some((tab) => !tab.pinned),
      action: () => Messages.pinTabs(tabs),
    }
  },

  unpinTab: () => {
    const tabs = selectedTabsForScope(Settings.values.contextMenuPinDescendants)
    return {
      id: 'unpinTab',
      label: 'Unpin',
      icon: 'unpin',
      enabled: tabs.some((tab) => tab.pinned),
      action: () => Messages.unpinTabs(tabs),
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

function selectedTabsForScope(scope: ContextMenuDescendantScope): Tab[] {
  return collectContextMenuActionItems(
    Selection.selectedItems.value.map((selected) => selected.item),
    scope,
  ).filter((item): item is Tab => item.type === TreeItemType.TAB)
}

function isOpenTab(tab: Tab): boolean {
  return tab.state === State.OPEN || tab.state === State.DISCARDED
}

function onlySingleTabSelected(): boolean {
  const selectedTabs = Selection.getSelectedTabs()
  return selectedTabs.length === 1
}
