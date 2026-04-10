import { Window } from '@/types/session-tree'
import { reactive } from 'vue'

export type ActiveModal = {
  kind: 'editWindowTitle'
  window: Window
} | null

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
