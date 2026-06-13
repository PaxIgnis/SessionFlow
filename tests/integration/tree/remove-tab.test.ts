import { beforeEach, describe, expect, it } from 'vitest'
import { Tree } from '@/services/background-tree'
import {
  createNote,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

describe('removeTab', () => {
  beforeEach(() => {
    resetTree()
  })

  it('reparents child notes when removing their parent tab', () => {
    const parentTab = createTab('tab-parent' as UID)
    const childNote = createNote('note-child' as UID, {
      parentUid: parentTab.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [parentTab, childNote])

    Tree.removeTab(parentTab.uid, false)

    expect(window.children.map((item) => item.uid)).toEqual([childNote.uid])
    expect(childNote.parentUid).toBeUndefined()
    expect(childNote.indentLevel).toBe(1)
    expect(Tree.tabsByUid.has(parentTab.uid)).toBe(false)
    expect(Tree.notesByUid.get(childNote.uid)).toBe(childNote)
    expectTreeInvariants()
  })

  it('promotes mixed child tabs and notes to the removed tab parent', () => {
    const grandparent = createTab('tab-grandparent' as UID, {
      isParent: true,
    })
    const parent = createTab('tab-parent' as UID, {
      parentUid: grandparent.uid,
      indentLevel: 2,
      isParent: true,
    })
    const childNote = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 3,
    })
    const childTab = createTab('tab-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 3,
    })
    const window = createWindow('window-1' as UID, [
      grandparent,
      parent,
      childNote,
      childTab,
    ])

    Tree.removeTab(parent.uid, false)

    expect(window.children.map((item) => item.uid)).toEqual([
      grandparent.uid,
      childNote.uid,
      childTab.uid,
    ])
    expect(childNote.parentUid).toBe(grandparent.uid)
    expect(childTab.parentUid).toBe(grandparent.uid)
    expect(childNote.indentLevel).toBe(2)
    expect(childTab.indentLevel).toBe(2)
    expect(grandparent.isParent).toBe(true)
    expectTreeInvariants()
  })

  it('keeps the window when removing a tab promotes its child note', () => {
    const parent = createTab('tab-parent' as UID, { isParent: true })
    const childNote = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [parent, childNote])

    Tree.removeTab(parent.uid, false)

    expect(Tree.Items.some((item) => item.uid === window.uid)).toBe(true)
    expect(Tree.windowsByUid.has(window.uid)).toBe(true)
    expect(Tree.tabsByUid.has(parent.uid)).toBe(false)
    expect(Tree.notesByUid.get(childNote.uid)).toBe(childNote)
    expect(childNote.parentUid).toBeUndefined()
    expect(childNote.indentLevel).toBe(1)
    expectTreeInvariants()
  })
})
