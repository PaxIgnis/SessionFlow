import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Selection } from '@/services/selection'
import { SelectionType } from '@/types/session-tree'
import {
  makeForegroundNote,
  makeForegroundTab,
  makeForegroundWindow,
} from '../../helpers/foreground-tree-fixtures'

const createNote = vi.hoisted(() => vi.fn())
const removeNote = vi.hoisted(() => vi.fn())
const openEditNoteModal = vi.hoisted(() => vi.fn())

vi.mock('@/services/foreground-messages', () => ({
  createNote,
  removeNote,
}))

vi.mock('@/services/modal-state', () => ({
  openEditNoteModal,
}))

describe('note context menu items', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Selection.selectedItems.value = []
  })

  it('creates a note under the selected item when one item is selected', async () => {
    const selected = makeForegroundNote('note-parent' as UID)
    Selection.selectedItems.value = [
      { item: selected, type: SelectionType.NOTE },
    ]
    const { contextMenuItemsNote } =
      await import('@/services/context-menu-items-note')

    const menuItem = contextMenuItemsNote.createNote()
    expect(menuItem.action).toBeDefined()
    if (!menuItem.action) return
    menuItem.action()

    expect(menuItem.enabled).toBe(true)
    expect(createNote).toHaveBeenCalledWith(selected.uid)
  })

  it.each([
    {
      type: SelectionType.WINDOW,
      selected: makeForegroundWindow('window-parent' as UID),
    },
    {
      type: SelectionType.TAB,
      selected: makeForegroundTab('tab-parent' as UID),
    },
    {
      type: SelectionType.NOTE,
      selected: makeForegroundNote('note-parent' as UID),
    },
  ])(
    'creates a note under a selected $type context parent',
    async ({ selected, type }) => {
      Selection.selectedItems.value = [{ item: selected, type }]
      const { contextMenuItemsNote } =
        await import('@/services/context-menu-items-note')

      contextMenuItemsNote.createNote().action?.()

      expect(createNote).toHaveBeenCalledWith(selected.uid)
    },
  )

  it('creates a root note from the panel menu when no item is selected', async () => {
    const { contextMenuItemsNote } =
      await import('@/services/context-menu-items-note')

    const menuItem = contextMenuItemsNote.createNote()
    menuItem.action?.()

    expect(menuItem.enabled).toBe(true)
    expect(createNote).toHaveBeenCalledWith(undefined)
  })

  it('disables create note when multiple items are selected', async () => {
    const first = makeForegroundNote('note-1' as UID)
    const second = makeForegroundNote('note-2' as UID)
    Selection.selectedItems.value = [
      { item: first, type: SelectionType.NOTE },
      { item: second, type: SelectionType.NOTE },
    ]
    const { contextMenuItemsNote } =
      await import('@/services/context-menu-items-note')

    const menuItem = contextMenuItemsNote.createNote()

    expect(menuItem.enabled).toBe(false)
  })

  it('opens the edit note modal only when one note is selected', async () => {
    const note = makeForegroundNote('note-1' as UID)
    Selection.selectedItems.value = [{ item: note, type: SelectionType.NOTE }]
    const { contextMenuItemsNote } =
      await import('@/services/context-menu-items-note')

    const menuItem = contextMenuItemsNote.editNote()
    expect(menuItem.action).toBeDefined()
    if (!menuItem.action) return
    menuItem.action()

    expect(menuItem.enabled).toBe(true)
    expect(openEditNoteModal).toHaveBeenCalledWith(note)
  })

  it('removes every selected note', async () => {
    const first = makeForegroundNote('note-1' as UID)
    const second = makeForegroundNote('note-2' as UID)
    Selection.selectedItems.value = [
      { item: first, type: SelectionType.NOTE },
      { item: second, type: SelectionType.NOTE },
    ]
    const { contextMenuItemsNote } =
      await import('@/services/context-menu-items-note')

    const menuItem = contextMenuItemsNote.removeNote()
    expect(menuItem.action).toBeDefined()
    if (!menuItem.action) return
    menuItem.action()

    expect(menuItem.enabled).toBe(true)
    expect(removeNote).toHaveBeenCalledWith(first.uid)
    expect(removeNote).toHaveBeenCalledWith(second.uid)
  })
})
