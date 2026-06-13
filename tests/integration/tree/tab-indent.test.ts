import { beforeEach, describe, expect, it } from 'vitest'
import { Tree } from '@/services/background-tree'
import {
  createNote,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

describe('tab indentation', () => {
  beforeEach(() => {
    resetTree()
  })

  it('sets a preceding note sibling as parent when increasing tab indent', () => {
    const note = createNote('note-parent' as UID)
    const tab = createTab('tab-child' as UID)
    const window = createWindow('window-1' as UID, [note, tab])

    Tree.tabIndentIncrease([tab.uid])

    expect(window.children.map((item) => item.uid)).toEqual([
      note.uid,
      tab.uid,
    ])
    expect(tab.parentUid).toBe(note.uid)
    expect(tab.indentLevel).toBe(2)
    expect(note.isParent).toBe(true)
    expectTreeInvariants()
  })

  it('keeps setting a preceding tab sibling as parent when increasing tab indent', () => {
    const parentTab = createTab('tab-parent' as UID)
    const childTab = createTab('tab-child' as UID)
    createWindow('window-1' as UID, [parentTab, childTab])

    Tree.tabIndentIncrease([childTab.uid])

    expect(childTab.parentUid).toBe(parentTab.uid)
    expect(childTab.indentLevel).toBe(2)
    expect(parentTab.isParent).toBe(true)
    expectTreeInvariants()
  })

  it('does not decrease a nested window root tab to the window indent level', () => {
    const parentNote = createNote('note-parent' as UID, {
      indentLevel: 0,
      isParent: true,
      windowUid: undefined,
    })
    const firstTab = createTab('tab-first' as UID, { indentLevel: 2 })
    const secondTab = createTab('tab-second' as UID, { indentLevel: 2 })
    const window = createWindow('window-1' as UID, [firstTab, secondTab], {
      indentLevel: 1,
      parentUid: parentNote.uid,
    })
    Tree.Items.splice(0, 0, parentNote)
    Tree.notesByUid.set(parentNote.uid, parentNote)
    Tree.existingUidsSet.add(parentNote.uid)

    Tree.tabIndentDecrease([secondTab.uid])

    expect(secondTab.parentUid).toBeUndefined()
    expect(secondTab.indentLevel).toBe(2)
    expect(window.indentLevel).toBe(1)
    expectTreeInvariants()
  })

  it('keeps a pinned root tab as parent when decreasing indent on one tab child while a note child remains', () => {
    const parentTab = createTab('tab-parent' as UID, {
      isParent: true,
      pinned: true,
    })
    const noteChild = createNote('note-child' as UID, {
      parentUid: parentTab.uid,
      indentLevel: 2,
    })
    const tabChild = createTab('tab-child' as UID, {
      parentUid: parentTab.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [
      parentTab,
      noteChild,
      tabChild,
    ])

    Tree.tabIndentDecrease([tabChild.uid])

    expect(window.children.map((item) => item.uid)).toEqual([
      parentTab.uid,
      noteChild.uid,
      tabChild.uid,
    ])
    expect(parentTab.isParent).toBe(true)
    expect(noteChild.parentUid).toBe(parentTab.uid)
    expect(noteChild.indentLevel).toBe(2)
    expect(tabChild.parentUid).toBeUndefined()
    expect(tabChild.indentLevel).toBe(1)
    expectTreeInvariants()
  })

  it('clears a note parent when decreasing indent reparents its remaining tab children', () => {
    const parentNote = createNote('note-parent' as UID, {
      isParent: true,
    })
    const movedTab = createTab('tab-moved' as UID, {
      parentUid: parentNote.uid,
      indentLevel: 2,
    })
    const lowerTab = createTab('tab-lower' as UID, {
      parentUid: parentNote.uid,
      indentLevel: 2,
    })
    const tailNote = createNote('note-tail' as UID)
    const window = createWindow('window-1' as UID, [
      parentNote,
      movedTab,
      lowerTab,
      tailNote,
    ])

    Tree.tabIndentDecrease([movedTab.uid])

    expect(window.children.map((item) => item.uid)).toEqual([
      parentNote.uid,
      movedTab.uid,
      lowerTab.uid,
      tailNote.uid,
    ])
    expect(parentNote.isParent).toBe(false)
    expect(movedTab.parentUid).toBeUndefined()
    expect(movedTab.indentLevel).toBe(1)
    expect(movedTab.isParent).toBe(true)
    expect(lowerTab.parentUid).toBe(movedTab.uid)
    expect(lowerTab.indentLevel).toBe(2)
    expectTreeInvariants()
  })
})
