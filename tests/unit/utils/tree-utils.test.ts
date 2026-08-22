import { describe, expect, it } from 'vitest'
import {
  countTreeItemDescendants,
  createTreeItemTally,
  formatStateBreakdown,
  formatTallyLine,
  formatTallyLines,
  tallyTreeItem,
} from '@/services/tree-utils'
import { State } from '@/types/session-tree'
import {
  makeForegroundNote,
  makeForegroundSeparator,
  makeForegroundTab,
  makeForegroundWindow,
} from '../../helpers/foreground-tree-fixtures'

describe('tree-utils', () => {
  it('counts descendant window children for a note with child windows', () => {
    const note = makeForegroundNote('note-parent' as UID, {
      indentLevel: 0,
      isParent: true,
      windowUid: undefined,
    })
    const firstWindow = makeForegroundWindow(
      'window-first' as UID,
      [
        makeForegroundTab('tab-first-a' as UID, { indentLevel: 2 }),
        makeForegroundTab('tab-first-b' as UID, { indentLevel: 2 }),
      ],
      {
        indentLevel: 1,
        parentUid: note.uid,
      },
    )
    const secondWindow = makeForegroundWindow(
      'window-second' as UID,
      [makeForegroundTab('tab-second-a' as UID, { indentLevel: 2 })],
      {
        indentLevel: 1,
        parentUid: note.uid,
      },
    )

    expect(
      countTreeItemDescendants(note, [note, firstWindow, secondWindow]),
    ).toBe(5)
  })

  it('counts flat note and tab descendants inside a window', () => {
    const parent = makeForegroundNote('note-parent' as UID, {
      isParent: true,
    })
    const childTab = makeForegroundTab('tab-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const grandchildNote = makeForegroundNote('note-grandchild' as UID, {
      parentUid: childTab.uid,
      indentLevel: 3,
    })
    const sibling = makeForegroundTab('tab-sibling' as UID)
    const window = makeForegroundWindow('window-1' as UID, [
      parent,
      childTab,
      grandchildNote,
      sibling,
    ])

    expect(countTreeItemDescendants(parent, window.children)).toBe(2)
  })

  it('counts all descendants of a window', () => {
    const note = makeForegroundNote('note-parent' as UID, {
      isParent: true,
    })
    const childTab = makeForegroundTab('tab-child' as UID, {
      parentUid: note.uid,
      indentLevel: 2,
    })
    const rootTab = makeForegroundTab('tab-root' as UID)
    const window = makeForegroundWindow('window-1' as UID, [
      note,
      childTab,
      rootTab,
    ])

    expect(countTreeItemDescendants(window)).toBe(3)
  })

  it("tallies a window's children by kind and tab state", () => {
    const tally = createTreeItemTally()
    for (const child of [
      makeForegroundTab('tab-open' as UID, { state: State.OPEN }),
      makeForegroundTab('tab-unloaded' as UID, { state: State.DISCARDED }),
      makeForegroundTab('tab-saved-a' as UID, { state: State.SAVED }),
      makeForegroundTab('tab-saved-b' as UID, { state: State.SAVED }),
      makeForegroundNote('note-a' as UID),
      makeForegroundSeparator('sep-a' as UID),
    ]) {
      tallyTreeItem(tally, child)
    }

    expect(tally).toEqual({
      open: 1,
      unloaded: 1,
      saved: 2,
      tabs: 4,
      notes: 1,
      separators: 1,
    })
  })

  it('names only the states a tally actually has', () => {
    expect(formatStateBreakdown({ open: 1, unloaded: 2, saved: 3 })).toBe(
      '1 open \u00b7 2 unloaded \u00b7 3 saved',
    )
    expect(formatStateBreakdown({ open: 0, unloaded: 0, saved: 3 })).toBe(
      '3 saved',
    )
    expect(formatStateBreakdown({ open: 0, unloaded: 0, saved: 0 })).toBe('')
  })

  it('drops the parenthetical when there is no breakdown to give', () => {
    expect(formatTallyLine('Windows', 2, '2 open')).toBe('Windows: 2 (2 open)')
    expect(formatTallyLine('Windows', 0)).toBe('Windows: 0')
  })

  it('always reports tabs but stays quiet about absent categories', () => {
    const tally = createTreeItemTally()
    expect(formatTallyLines(tally)).toEqual(['Tabs: 0'])

    tallyTreeItem(
      tally,
      makeForegroundTab('tab-1' as UID, { state: State.OPEN }),
    )
    tallyTreeItem(tally, makeForegroundNote('note-1' as UID))
    expect(formatTallyLines(tally)).toEqual(['Tabs: 1 (1 open)', 'Notes: 1'])
  })
})
