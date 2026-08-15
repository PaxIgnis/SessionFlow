import {
  ContainerMetadata,
  Note,
  TreeItem,
  TreeItemType,
  Window,
} from '@/types/session-tree'
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
  | {
      kind: 'deleteTreeItems'
      itemUids: UID[]
      counts: DeleteTreeItemCounts
    }
  | null

export interface DeleteTreeItemCounts {
  windows: number
  tabs: number
  notes: number
  separators: number
}

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

export function openDeleteTreeItemsModal(items: readonly TreeItem[]): void {
  openModal({
    kind: 'deleteTreeItems',
    itemUids: items.map((item) => item.uid),
    counts: {
      windows: items.filter((item) => item.type === TreeItemType.WINDOW).length,
      tabs: items.filter((item) => item.type === TreeItemType.TAB).length,
      notes: items.filter((item) => item.type === TreeItemType.NOTE).length,
      separators: items.filter((item) => item.type === TreeItemType.SEPARATOR)
        .length,
    },
  })
}
