import { beforeEach, describe, expect, it } from 'vitest'
import { SessionTree } from '@/services/foreground-tree'
import { Selection } from '@/services/selection'
import { SelectionType } from '@/types/session-tree'
import { collectContextMenuActionItems } from '@/services/selection-actions'
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

    Selection.selectItem(
      indexedFirst,
      SelectionType.TAB,
      mouse({ ctrlKey: true }),
    )
    Selection.selectItem(
      indexedSecond,
      SelectionType.TAB,
      mouse({ ctrlKey: true }),
    )
    Selection.selectItem(
      indexedFirst,
      SelectionType.TAB,
      mouse({ ctrlKey: true }),
    )

    expect(indexedFirst.selected).toBe(false)
    expect(indexedSecond.selected).toBe(true)
    expect(Selection.selectedItems.value.map((item) => item.item.uid)).toEqual([
      second.uid,
    ])
  })

  it('ctrl toggles windows, tabs, notes, and separators in one mixed selection', () => {
    const tab = makeForegroundTab('tab-1' as UID)
    const note = makeForegroundNote('note-1' as UID)
    const separator = makeForegroundSeparator('separator-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [
      tab,
      note,
      separator,
    ])
    resetForegroundTree([window])
    const indexedWindow = SessionTree.windowsByUid.get(window.uid)!
    const indexedTab = SessionTree.tabsByUid.get(tab.uid)!
    const indexedNote = SessionTree.notesByUid.get(note.uid)!
    const indexedSeparator = SessionTree.separatorsByUid.get(separator.uid)!

    Selection.selectItem(
      indexedWindow,
      SelectionType.WINDOW,
      mouse({ ctrlKey: true }),
    )
    Selection.selectItem(
      indexedTab,
      SelectionType.TAB,
      mouse({ ctrlKey: true }),
    )
    Selection.selectItem(
      indexedNote,
      SelectionType.NOTE,
      mouse({ ctrlKey: true }),
    )
    Selection.selectItem(
      indexedSeparator,
      SelectionType.SEPARATOR,
      mouse({ ctrlKey: true }),
    )

    expect(Selection.selectedItems.value.map(({ item }) => item.uid)).toEqual([
      window.uid,
      tab.uid,
      note.uid,
      separator.uid,
    ])

    Selection.selectItem(
      indexedTab,
      SelectionType.TAB,
      mouse({ ctrlKey: true }),
    )
    Selection.selectItem(
      indexedNote,
      SelectionType.NOTE,
      mouse({ ctrlKey: true }),
    )

    expect(Selection.selectedItems.value.map(({ item }) => item.uid)).toEqual([
      window.uid,
      separator.uid,
    ])
  })

  it('meta toggles mixed item types without clearing the existing selection', () => {
    const tab = makeForegroundTab('tab-1' as UID)
    const note = makeForegroundNote('note-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [tab, note])
    resetForegroundTree([window])
    const indexedTab = SessionTree.tabsByUid.get(tab.uid)!
    const indexedNote = SessionTree.notesByUid.get(note.uid)!

    Selection.selectItem(
      indexedTab,
      SelectionType.TAB,
      mouse({ metaKey: true }),
    )
    Selection.selectItem(
      indexedNote,
      SelectionType.NOTE,
      mouse({ metaKey: true }),
    )

    expect(Selection.selectedItems.value.map(({ item }) => item.uid)).toEqual([
      tab.uid,
      note.uid,
    ])

    Selection.selectItem(
      indexedTab,
      SelectionType.TAB,
      mouse({ metaKey: true }),
    )
    expect(Selection.selectedItems.value.map(({ item }) => item.uid)).toEqual([
      note.uid,
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
    Selection.selectItem(
      indexedLast,
      SelectionType.TAB,
      mouse({ shiftKey: true }),
    )

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
    Selection.selectItem(
      indexedLast,
      SelectionType.WINDOW,
      mouse({ shiftKey: true }),
    )

    expect(Selection.selectedItems.value.map((item) => item.item.uid)).toEqual([
      first.uid,
      note.uid,
      separator.uid,
      last.uid,
    ])
  })

  it('shift-selects the full logical range across windows and collapsed hidden descendants', () => {
    const topNote = makeForegroundNote('top-note' as UID, {
      indentLevel: 0,
      windowUid: undefined,
    })
    const parent = makeForegroundTab('parent-tab' as UID, {
      collapsed: true,
      isParent: true,
    })
    const hiddenNote = makeForegroundNote('hidden-note' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
      isVisible: false,
    })
    const hiddenSeparator = makeForegroundSeparator('hidden-separator' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
      isVisible: false,
    })
    const firstWindow = makeForegroundWindow('window-1' as UID, [
      parent,
      hiddenNote,
      hiddenSeparator,
    ])
    const secondTab = makeForegroundTab('second-tab' as UID)
    const secondWindow = makeForegroundWindow('window-2' as UID, [secondTab])
    const tail = makeForegroundSeparator('tail' as UID, {
      indentLevel: 0,
      windowUid: undefined,
    })
    resetForegroundTree([topNote, firstWindow, secondWindow, tail])

    Selection.selectItem(
      SessionTree.notesByUid.get(topNote.uid)!,
      SelectionType.NOTE,
      mouse(),
    )
    Selection.selectItem(
      SessionTree.separatorsByUid.get(tail.uid)!,
      SelectionType.SEPARATOR,
      mouse({ shiftKey: true }),
    )

    expect(Selection.selectedItems.value.map(({ item }) => item.uid)).toEqual([
      topNote.uid,
      firstWindow.uid,
      parent.uid,
      hiddenNote.uid,
      hiddenSeparator.uid,
      secondWindow.uid,
      secondTab.uid,
      tail.uid,
    ])
  })

  it('selects the same full logical range in reverse order', () => {
    const firstTab = makeForegroundTab('tab-1' as UID)
    const firstWindow = makeForegroundWindow('window-1' as UID, [firstTab])
    const note = makeForegroundNote('note-1' as UID, {
      indentLevel: 0,
      windowUid: undefined,
    })
    const secondWindow = makeForegroundWindow('window-2' as UID)
    resetForegroundTree([firstWindow, note, secondWindow])

    Selection.selectItem(
      SessionTree.windowsByUid.get(secondWindow.uid)!,
      SelectionType.WINDOW,
      mouse(),
    )
    Selection.selectItem(
      SessionTree.windowsByUid.get(firstWindow.uid)!,
      SelectionType.WINDOW,
      mouse({ shiftKey: true }),
    )

    expect(Selection.selectedItems.value.map(({ item }) => item.uid)).toEqual([
      firstWindow.uid,
      firstTab.uid,
      note.uid,
      secondWindow.uid,
    ])
  })

  it('ctrl-shift adds a mixed logical range without duplicating existing items', () => {
    const first = makeForegroundNote('note-1' as UID, {
      indentLevel: 0,
      windowUid: undefined,
    })
    const window = makeForegroundWindow('window-1' as UID, [
      makeForegroundTab('tab-1' as UID),
    ])
    const tail = makeForegroundSeparator('tail' as UID, {
      indentLevel: 0,
      windowUid: undefined,
    })
    resetForegroundTree([first, window, tail])
    const indexedFirst = SessionTree.notesByUid.get(first.uid)!
    const indexedTail = SessionTree.separatorsByUid.get(tail.uid)!

    Selection.selectItem(indexedFirst, SelectionType.NOTE, mouse())
    Selection.selectItem(
      indexedTail,
      SelectionType.SEPARATOR,
      mouse({ ctrlKey: true, shiftKey: true }),
    )

    expect(Selection.selectedItems.value.map(({ item }) => item.uid)).toEqual([
      first.uid,
      window.uid,
      window.children[0].uid,
      tail.uid,
    ])
  })

  it('uses the clicked item as the new anchor when the old anchor was removed', () => {
    const removedAnchor = makeForegroundTab('removed' as UID)
    const remaining = makeForegroundTab('remaining' as UID)
    const tail = makeForegroundTab('tail' as UID)
    const window = makeForegroundWindow('window-1' as UID, [
      removedAnchor,
      remaining,
      tail,
    ])
    resetForegroundTree([window])
    Selection.selectItem(
      SessionTree.tabsByUid.get(removedAnchor.uid)!,
      SelectionType.TAB,
      mouse(),
    )
    resetForegroundTree([
      makeForegroundWindow('window-1' as UID, [remaining, tail]),
    ])

    Selection.selectItem(
      SessionTree.tabsByUid.get(tail.uid)!,
      SelectionType.TAB,
      mouse({ shiftKey: true }),
    )

    expect(Selection.selectedItems.value.map(({ item }) => item.uid)).toEqual([
      tail.uid,
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

    Selection.selectItemForContextMenu(
      indexedFirst,
      SelectionType.NOTE,
      mouse(),
    )

    expect(Selection.selectedItems.value.map((item) => item.item.uid)).toEqual([
      first.uid,
      second.uid,
    ])
  })

  it('right-clicking an already-selected mixed type preserves the complete selection', () => {
    const tab = makeForegroundTab('tab-1' as UID)
    const note = makeForegroundNote('note-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [tab, note])
    resetForegroundTree([window])
    const indexedTab = SessionTree.tabsByUid.get(tab.uid)!
    const indexedNote = SessionTree.notesByUid.get(note.uid)!
    indexedTab.selected = true
    indexedNote.selected = true
    Selection.selectedItems.value = [
      { item: indexedTab, type: SelectionType.TAB },
      { item: indexedNote, type: SelectionType.NOTE },
    ]

    Selection.selectItemForContextMenu(indexedNote, SelectionType.NOTE, mouse())

    expect(Selection.selectedItems.value.map(({ item }) => item.uid)).toEqual([
      tab.uid,
      note.uid,
    ])
  })

  it('includes descendants only for collapsed roots in collapsed scope', () => {
    const parent = makeForegroundTab('parent' as UID, {
      collapsed: true,
      isParent: true,
    })
    const child = makeForegroundNote('child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
      isParent: true,
    })
    const grandchild = makeForegroundSeparator('grandchild' as UID, {
      parentUid: child.uid,
      indentLevel: 3,
    })
    const sibling = makeForegroundTab('sibling' as UID)
    const window = makeForegroundWindow('window-1' as UID, [
      parent,
      child,
      grandchild,
      sibling,
    ])
    resetForegroundTree([window])
    const indexedParent = SessionTree.tabsByUid.get(parent.uid)!

    expect(
      collectContextMenuActionItems([indexedParent], 'collapsed').map(
        (item) => item.uid,
      ),
    ).toEqual([parent.uid, child.uid, grandchild.uid])

    indexedParent.collapsed = false
    expect(
      collectContextMenuActionItems([indexedParent], 'collapsed').map(
        (item) => item.uid,
      ),
    ).toEqual([parent.uid])
  })

  it('supports selected-only and complete-subtree scopes without duplicate descendants', () => {
    const parent = makeForegroundNote('parent' as UID, {
      windowUid: undefined,
      indentLevel: 0,
      isParent: true,
    })
    const child = makeForegroundNote('child' as UID, {
      windowUid: undefined,
      parentUid: parent.uid,
      indentLevel: 1,
    })
    const tail = makeForegroundSeparator('tail' as UID, {
      windowUid: undefined,
      indentLevel: 0,
    })
    resetForegroundTree([parent, child, tail])

    expect(
      collectContextMenuActionItems([parent, child], 'never').map(
        (item) => item.uid,
      ),
    ).toEqual([parent.uid, child.uid])
    expect(
      collectContextMenuActionItems([parent, child], 'always').map(
        (item) => item.uid,
      ),
    ).toEqual([parent.uid, child.uid])
  })

  it('always includes window contents regardless of descendant scope', () => {
    const tab = makeForegroundTab('tab' as UID)
    const note = makeForegroundNote('note' as UID)
    const window = makeForegroundWindow('window-1' as UID, [tab, note], {
      collapsed: false,
    })
    resetForegroundTree([window])

    expect(
      collectContextMenuActionItems([window], 'never').map((item) => item.uid),
    ).toEqual([window.uid, tab.uid, note.uid])
  })
})
