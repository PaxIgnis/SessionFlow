import { ContainerMetadata, Note, Window } from '@/types/session-tree'
import { reactive } from 'vue'

export type ActiveModal =
  | {
      kind: 'editWindowTitle'
      window: Window
    }
  | {
      kind: 'editCustomLabel'
      uid: UID
      customLabel?: string
    }
  | {
      kind: 'editNote'
      note: Note
    }
  | {
      kind: 'containerRecovery'
      target: ContainerRecoveryTarget
      missingContainers: ContainerMetadata[]
    }
  | null

export type ContainerRecoveryTabTarget = {
  type: 'tab'
  tabUid: UID
  windowUid: UID
  url: string
  containerStoreId?: string
  active?: boolean
}

export type ContainerRecoveryTarget =
  | ContainerRecoveryTabTarget
  | {
      type: 'tabs'
      tabs: ContainerRecoveryTabTarget[]
    }
  | { type: 'window'; windowUid: UID }

export const ModalState = reactive<{
  active: ActiveModal
}>({
  active: null,
})

export function openModal(modal: ActiveModal) {
  ModalState.active = modal
}

export function closeModal() {
  ModalState.active = null
}

export function openEditWindowTitleModal(window: Window) {
  openModal({ kind: 'editWindowTitle', window })
}

export function closeEditWindowTitleModal() {
  closeModal()
}

export function openEditCustomLabelModal(uid: UID, customLabel?: string) {
  openModal({ kind: 'editCustomLabel', uid, customLabel })
}

export function openEditNoteModal(note: Note) {
  openModal({ kind: 'editNote', note })
}

export function openContainerRecoveryModal(
  target: ContainerRecoveryTarget,
  missingContainers: ContainerMetadata[],
) {
  openModal({
    kind: 'containerRecovery',
    target: structuredClone(target),
    missingContainers: structuredClone(missingContainers),
  })
}
