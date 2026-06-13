import { describe, expect, it } from 'vitest'
import { countTreeItemDescendants } from '@/services/tree-utils'
import {
  makeForegroundNote,
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
})
