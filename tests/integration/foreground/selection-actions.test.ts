import { beforeEach, describe, expect, it } from 'vitest'
import { SessionTree } from '@/services/foreground-tree'
import { Selection } from '@/services/selection'
import { SelectionType } from '@/types/session-tree'
import {
  makeForegroundNote,
  makeForegroundSeparator,
  makeForegroundTab,
  makeForegroundWindow,
  resetForegroundTree,
} from '../../helpers/foreground-tree-fixtures'

function mouse(overrides: Partial<MouseEvent> = {}): MouseEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as MouseEvent
}

describe('selection actions', () => {
  beforeEach(() => {
    resetForegroundTree()
    Selection.selectedItems.value = []
  })

  it('selects a single item and clears prior different-type selections', () => {
    const tab = makeForegroundTab('tab-1' as UID)
    const note = makeForegroundNote('note-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [tab, note])
    resetForegroundTree([window])
    const indexedWindow = SessionTree.windowsByUid.get(window.uid)!
    const indexedTab = indexedWindow.children[0]
    const indexedNote = indexedWindow.children[1]

    Selection.selectItem(indexedTab, SelectionType.TAB, mouse())
    Selection.selectItem(indexedNote, SelectionType.NOTE, mouse())

    expect(indexedTab.selected).toBe(false)
    expect(indexedNote.selected).toBe(true)
    expect(Selection.selectedItems.value.map((item) => item.item.uid)).toEqual([
      note.uid,
    ])
  })

  it('ctrl toggles selected items of the same type', () => {
    const first = makeForegroundTab('tab-1' as UID)
    const second = makeForegroundTab('tab-2' as UID)
    const window = makeForegroundWindow('window-1' as UID, [first, second])
    resetForegroundTree([window])
    const indexedWindow = SessionTree.windowsByUid.get(window.uid)!
    const indexedFirst = indexedWindow.children[0]
    const indexedSecond = indexedWindow.children[1]

    Selection.selectItem(indexedFirst, SelectionType.TAB, mouse({ ctrlKey: true }))
    Selection.selectItem(indexedSecond, SelectionType.TAB, mouse({ ctrlKey: true }))
    Selection.selectItem(indexedFirst, SelectionType.TAB, mouse({ ctrlKey: true }))

    expect(indexedFirst.selected).toBe(false)
    expect(indexedSecond.selected).toBe(true)
    expect(Selection.selectedItems.value.map((item) => item.item.uid)).toEqual([
      second.uid,
    ])
  })

  it('shift-selects a range of mixed children in the same window', () => {
    const first = makeForegroundTab('tab-1' as UID)
    const middle = makeForegroundSeparator('separator-1' as UID)
    const last = makeForegroundTab('tab-2' as UID)
    const window = makeForegroundWindow('window-1' as UID, [
      first,
      middle,
      last,
    ])
    resetForegroundTree([window])
    const indexedWindow = SessionTree.windowsByUid.get(window.uid)!
    const indexedFirst = indexedWindow.children[0]
    const indexedLast = indexedWindow.children[2]

    Selection.selectItem(indexedFirst, SelectionType.TAB, mouse())
    Selection.selectItem(indexedLast, SelectionType.TAB, mouse({ shiftKey: true }))

    expect(Selection.selectedItems.value.map((item) => item.item.uid)).toEqual([
      first.uid,
      middle.uid,
      last.uid,
    ])
  })

  it('shift-selects a top-level range containing windows, notes, and separators', () => {
    const first = makeForegroundWindow('window-1' as UID)
    const note = makeForegroundNote('note-1' as UID, { indentLevel: 0 })
    const separator = makeForegroundSeparator('separator-1' as UID, {
      indentLevel: 0,
    })
    const last = makeForegroundWindow('window-2' as UID)
    resetForegroundTree([first, note, separator, last])
    const indexedFirst = SessionTree.windowsByUid.get(first.uid)!
    const indexedLast = SessionTree.windowsByUid.get(last.uid)!

    Selection.selectItem(indexedFirst, SelectionType.WINDOW, mouse())
    Selection.selectItem(indexedLast, SelectionType.WINDOW, mouse({ shiftKey: true }))

    expect(Selection.selectedItems.value.map((item) => item.item.uid)).toEqual([
      first.uid,
      note.uid,
      separator.uid,
      last.uid,
    ])
  })

  it('selects separators with their own selection type', () => {
    const first = makeForegroundSeparator('separator-1' as UID, {
      indentLevel: 0,
    })
    const second = makeForegroundSeparator('separator-2' as UID, {
      indentLevel: 0,
    })
    resetForegroundTree([first, second])
    const indexedFirst = SessionTree.separatorsByUid.get(first.uid)!
    const indexedSecond = SessionTree.separatorsByUid.get(second.uid)!

    Selection.selectItem(indexedFirst, SelectionType.SEPARATOR, mouse())
    Selection.selectItem(
      indexedSecond,
      SelectionType.SEPARATOR,
      mouse({ ctrlKey: true }),
    )

    expect(Selection.selectedItems.value.map((item) => item.type)).toEqual([
      SelectionType.SEPARATOR,
      SelectionType.SEPARATOR,
    ])
    expect(Selection.selectedItems.value.map((item) => item.item.uid)).toEqual([
      first.uid,
      second.uid,
    ])
  })

  it('context menu selection preserves existing selection with ctrl and replaces without ctrl', () => {
    const first = makeForegroundNote('note-1' as UID)
    const second = makeForegroundNote('note-2' as UID)
    resetForegroundTree([first, second])
    const indexedFirst = SessionTree.notesByUid.get(first.uid)!
    const indexedSecond = SessionTree.notesByUid.get(second.uid)!
    Selection.selectItemForContextMenu(
      indexedFirst,
      SelectionType.NOTE,
      mouse({ ctrlKey: true }),
    )
    Selection.selectItemForContextMenu(
      indexedSecond,
      SelectionType.NOTE,
      mouse({ ctrlKey: true }),
    )

    expect(Selection.selectedItems.value.map((item) => item.item.uid)).toEqual([
      first.uid,
      second.uid,
    ])

    Selection.selectItemForContextMenu(indexedFirst, SelectionType.NOTE, mouse())

    expect(Selection.selectedItems.value.map((item) => item.item.uid)).toEqual([
      first.uid,
      second.uid,
    ])
  })
})
