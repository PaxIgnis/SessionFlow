import { beforeEach, describe, expect, it } from 'vitest'
import {
  closeEditWindowTitleModal,
  closeModal,
  ModalState,
  openEditCustomLabelModal,
  openEditNoteModal,
  openEditWindowTitleModal,
  openContainerRecoveryModal,
  openModal,
} from '@/services/modal-state'
import {
  makeForegroundNote,
  makeForegroundWindow,
} from '../../helpers/foreground-tree-fixtures'

describe('modal state', () => {
  beforeEach(() => {
    ModalState.active = null
  })

  it('opens and closes arbitrary modal state', () => {
    openModal({ kind: 'editCustomLabel', uid: 'tab-1' as UID })
    expect(ModalState.active).toEqual({
      kind: 'editCustomLabel',
      uid: 'tab-1',
    })

    closeModal()

    expect(ModalState.active).toBeNull()
  })

  it('opens and closes window title modal helpers', () => {
    const window = makeForegroundWindow('window-1' as UID)

    openEditWindowTitleModal(window)
    expect(ModalState.active).toEqual({
      kind: 'editWindowTitle',
      window,
    })

    closeEditWindowTitleModal()
    expect(ModalState.active).toBeNull()
  })

  it('opens custom label and note edit modals', () => {
    const note = makeForegroundNote('note-1' as UID)

    openEditCustomLabelModal('tab-1' as UID, 'Label')
    expect(ModalState.active).toEqual({
      kind: 'editCustomLabel',
      uid: 'tab-1',
      customLabel: 'Label',
    })

    openEditNoteModal(note)
    expect(ModalState.active).toEqual({
      kind: 'editNote',
      note,
    })
  })

  it('stores a serializable missing-container recovery target', () => {
    const container = {
      cookieStoreId: 'firefox-container-1',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
    }

    openContainerRecoveryModal(
      {
        type: 'tab',
        tabUid: 'tab-1' as UID,
        windowUid: 'window-1' as UID,
        url: 'https://example.test/work',
      },
      [container],
    )

    expect(ModalState.active).toEqual({
      kind: 'containerRecovery',
      target: {
        type: 'tab',
        tabUid: 'tab-1',
        windowUid: 'window-1',
        url: 'https://example.test/work',
      },
      missingContainers: [container],
    })
  })
})
