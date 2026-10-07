import { i18n } from '@/services/i18n'
import * as Messages from '@/services/foreground-messages'
import { openEditNoteModal } from '@/services/modal-state'
import { Selection } from '@/services/selection'
import { ContextMenuItem } from '@/types/context-menu'

function selectedParentUid(): UID | undefined {
  const selected = Selection.selectedItems.value[0]?.item
  return selected?.uid
}

export const contextMenuItemsNote: Record<string, () => ContextMenuItem> = {
  createNote: () => {
    return {
      id: 'createNote',
      label: i18n.t('addNoteLabel'),
      icon: 'note',
      enabled: Selection.selectedItems.value.length <= 1,
      action: () => Messages.createNote(selectedParentUid()),
    }
  },

  editNote: () => {
    return {
      id: 'editNote',
      label: i18n.t('editNote'),
      icon: 'edit',
      enabled: Selection.getSelectedNotes().length === 1,
      action: () => {
        const note = Selection.getSelectedNotes()[0]
        if (note) openEditNoteModal(note)
      },
    }
  },
}
