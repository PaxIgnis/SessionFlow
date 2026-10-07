import { i18n } from '@/services/i18n'
import * as Messages from '@/services/foreground-messages'
import { openDeleteTreeItemsModal } from '@/services/modal-state'
import { Selection } from '@/services/selection'
import {
  collectContextMenuActionItems,
  type ContextMenuDescendantScope,
} from '@/services/selection-actions'
import { Settings } from '@/services/settings'
import { ContextMenuItem } from '@/types/context-menu'
import {
  canDecreaseIndentSelectedItems,
  canIncreaseIndentSelectedItems,
} from '@/services/context-menu-actions'

function selectedItems() {
  return Selection.selectedItems.value.map((selected) => selected.item)
}

function duplicateScope(): ContextMenuDescendantScope {
  if (Settings.values.duplicateTreeItemDescendants === 'complete-subtree') {
    return 'always'
  }
  if (Settings.values.duplicateTreeItemDescendants === 'collapsed') {
    return 'collapsed'
  }
  return 'never'
}

export const contextMenuItemsTree: Record<string, () => ContextMenuItem> = {
  deleteTreeItem: () => {
    const items = collectContextMenuActionItems(
      selectedItems(),
      Settings.values.contextMenuDeleteDescendants,
    )
    return {
      id: 'deleteTreeItem',
      label: i18n.t('delete'),
      icon: 'close',
      enabled: items.length > 0,
      action: () => openDeleteTreeItemsModal(items),
    }
  },

  duplicateTreeItem: () => {
    const items = collectContextMenuActionItems(
      selectedItems(),
      duplicateScope(),
    )
    return {
      id: 'duplicateTreeItem',
      label: i18n.t('duplicate'),
      icon: 'duplicate',
      enabled: items.length > 0,
      action: () =>
        Messages.duplicateTreeItems(
          items.map((item) => item.uid),
          false,
        ),
    }
  },

  treeItemIndentIncrease: () => {
    const items = selectedItems()
    const uids = items.map((item) => item.uid)
    return {
      id: 'treeItemIndentIncrease',
      label: i18n.t('increaseIndent'),
      icon: 'indent-increase',
      enabled: canIncreaseIndentSelectedItems(items),
      action: () => Messages.treeItemIndentIncrease(uids),
    }
  },

  treeItemIndentDecrease: () => {
    const items = selectedItems()
    const uids = items.map((item) => item.uid)
    return {
      id: 'treeItemIndentDecrease',
      label: i18n.t('decreaseIndent'),
      icon: 'indent-decrease',
      enabled: canDecreaseIndentSelectedItems(items),
      action: () => Messages.treeItemIndentDecrease(uids),
    }
  },
}
