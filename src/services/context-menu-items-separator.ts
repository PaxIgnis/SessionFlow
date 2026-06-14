import * as Messages from '@/services/foreground-messages'
import { SessionTree } from '@/services/foreground-tree'
import { Selection } from '@/services/selection'
import { ContextMenuItem } from '@/types/context-menu'
import { Separator, TreeItem } from '@/types/session-tree'

function selectedParentUid(): UID | undefined {
  const selected = Selection.selectedItems.value[0]?.item
  return selected?.uid
}

function selectedItemUids(): UID[] {
  return Selection.selectedItems.value.map((selected) => selected.item.uid)
}

function getCreateNoteTargetBelowSeparator(
  separator: Separator,
): { parentUid: UID | undefined; index: number | undefined } {
  const containingItems = getContainingItems(separator)
  const index = containingItems.findIndex((item) => item.uid === separator.uid)
  const parentUid =
    separator.parentUid ??
    (separator.windowUid ? separator.windowUid : undefined)

  return {
    parentUid,
    index: index === -1 ? undefined : index + 1,
  }
}

function getContainingItems(separator: Separator): TreeItem[] {
  if (separator.windowUid) {
    return SessionTree.windowsByUid.get(separator.windowUid)?.children ?? []
  }

  return SessionTree.reactiveItems.value as TreeItem[]
}

export const contextMenuItemsSeparator: Record<string, () => ContextMenuItem> =
  {
    createNote: () => {
      return {
        id: 'createNote',
        label: 'Add Note',
        icon: 'note',
        enabled: Selection.selectedItems.value.length <= 1,
        action: () => {
          const separator = Selection.getSelectedSeparators()[0]
          if (!separator) {
            Messages.createNote(selectedParentUid())
            return
          }
          const { parentUid, index } =
            getCreateNoteTargetBelowSeparator(separator)
          Messages.createNote(parentUid, index)
        },
      }
    },

    createSeparator: () => {
      return {
        id: 'createSeparator',
        label: 'Add Separator',
        icon: 'separator',
        enabled: Selection.selectedItems.value.length <= 1,
        action: () => Messages.createSeparator(selectedParentUid()),
      }
    },

    createSeparatorBelow: () => {
      return {
        id: 'createSeparatorBelow',
        label: 'Add Separator',
        icon: 'separator',
        enabled: Selection.getSelectedSeparators().length === 1,
        action: () => {
          const separator = Selection.getSelectedSeparators()[0]
          if (separator) Messages.createSeparatorBelow(separator.uid)
        },
      }
    },

    treeItemIndentIncrease: () => {
      return {
        id: 'treeItemIndentIncrease',
        label: 'Increase Indent',
        icon: 'indent-increase',
        enabled: Selection.selectedItems.value.length > 0,
        action: () => {
          Messages.treeItemIndentIncrease(selectedItemUids())
        },
      }
    },

    treeItemIndentDecrease: () => {
      return {
        id: 'treeItemIndentDecrease',
        label: 'Decrease Indent',
        icon: 'indent-decrease',
        enabled: Selection.selectedItems.value.length > 0,
        action: () => {
          Messages.treeItemIndentDecrease(selectedItemUids())
        },
      }
    },

    removeSeparator: () => {
      return {
        id: 'removeSeparator',
        label: 'Remove Separator',
        icon: 'close',
        enabled: Selection.getSelectedSeparators().length > 0,
        action: () => {
          Selection.getSelectedSeparators().forEach((separator) =>
            Messages.removeSeparator(separator.uid),
          )
        },
      }
    },
  }
