import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Selection } from '@/services/selection'
import { SelectionType } from '@/types/session-tree'
import {
  makeForegroundNote,
  makeForegroundSeparator,
  makeForegroundTab,
  makeForegroundWindow,
  resetForegroundTree,
} from '../../helpers/foreground-tree-fixtures'

const createNote = vi.hoisted(() => vi.fn())
const createSeparator = vi.hoisted(() => vi.fn())
const createSeparatorBelow = vi.hoisted(() => vi.fn())
const removeSeparator = vi.hoisted(() => vi.fn())
const treeItemIndentDecrease = vi.hoisted(() => vi.fn())
const treeItemIndentIncrease = vi.hoisted(() => vi.fn())

vi.mock('@/services/foreground-messages', () => ({
  createNote,
  createSeparator,
  createSeparatorBelow,
  removeSeparator,
  treeItemIndentDecrease,
  treeItemIndentIncrease,
}))

describe('separator context menu items', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Selection.selectedItems.value = []
    resetForegroundTree()
  })

  it('adds a note below a top-level separator', async () => {
    const separator = makeForegroundSeparator('separator-root' as UID, {
      indentLevel: 0,
    })
    resetForegroundTree([separator])
    Selection.selectedItems.value = [
      { item: separator, type: SelectionType.SEPARATOR },
    ]
    const { contextMenuItemsSeparator } = await import(
      '@/services/context-menu-items-separator'
    )

    contextMenuItemsSeparator.createNote().action?.()

    expect(createNote).toHaveBeenCalledWith(undefined, 1)
  })

  it('adds a note below a window-root separator', async () => {
    const separator = makeForegroundSeparator('separator-window' as UID)
    const window = makeForegroundWindow('window-1' as UID, [separator])
    resetForegroundTree([window])
    Selection.selectedItems.value = [
      { item: separator, type: SelectionType.SEPARATOR },
    ]
    const { contextMenuItemsSeparator } = await import(
      '@/services/context-menu-items-separator'
    )

    contextMenuItemsSeparator.createNote().action?.()

    expect(createNote).toHaveBeenCalledWith(window.uid, 1)
  })

  it.each([
    ['tab', () => makeForegroundTab('tab-parent' as UID)],
    ['note', () => makeForegroundNote('note-parent' as UID)],
  ] as const)(
    'adds a note below a separator nested under a %s parent',
    async (_parentType, createParent) => {
      const parent = createParent()
      const separator = makeForegroundSeparator('separator-child' as UID, {
        parentUid: parent.uid,
        indentLevel: 2,
      })
      const window = makeForegroundWindow('window-1' as UID, [
        parent,
        separator,
      ])
      resetForegroundTree([window])
      Selection.selectedItems.value = [
        { item: separator, type: SelectionType.SEPARATOR },
      ]
      const { contextMenuItemsSeparator } = await import(
        '@/services/context-menu-items-separator'
      )

      contextMenuItemsSeparator.createNote().action?.()

      expect(createNote).toHaveBeenCalledWith(parent.uid, 2)
    },
  )

  it('disables add note when multiple separators are selected', async () => {
    const first = makeForegroundSeparator('separator-1' as UID)
    const second = makeForegroundSeparator('separator-2' as UID)
    Selection.selectedItems.value = [
      { item: first, type: SelectionType.SEPARATOR },
      { item: second, type: SelectionType.SEPARATOR },
    ]
    const { contextMenuItemsSeparator } = await import(
      '@/services/context-menu-items-separator'
    )

    const menuItem = contextMenuItemsSeparator.createNote()

    expect(menuItem.enabled).toBe(false)
  })

  it('dispatches generic indent actions with selected separator uids', async () => {
    const separator = makeForegroundSeparator('separator-1' as UID)
    Selection.selectedItems.value = [
      { item: separator, type: SelectionType.SEPARATOR },
    ]
    const { contextMenuItemsSeparator } = await import(
      '@/services/context-menu-items-separator'
    )

    contextMenuItemsSeparator.treeItemIndentIncrease().action?.()
    contextMenuItemsSeparator.treeItemIndentDecrease().action?.()

    expect(treeItemIndentIncrease).toHaveBeenCalledWith([separator.uid])
    expect(treeItemIndentDecrease).toHaveBeenCalledWith([separator.uid])
  })
})
