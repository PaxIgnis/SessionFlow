import { beforeEach, describe, expect, it } from 'vitest'
import { Tree } from '@/services/background-tree'
import {
  createNote,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

describe('collapse visibility', () => {
  beforeEach(() => {
    resetTree()
  })

  it('hides and shows mixed tab descendants when toggling a tab', () => {
    const parent = createTab('tab-parent' as UID, { isParent: true })
    const childNote = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const childTab = createTab('tab-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    createWindow('window-1' as UID, [parent, childNote, childTab])
    Tree.recomputeSessionTree(false)

    Tree.toggleCollapseTab(parent.uid, false)

    expect(parent.collapsed).toBe(true)
    expect(childNote.isVisible).toBe(false)
    expect(childTab.isVisible).toBe(false)
    expectTreeInvariants()

    Tree.toggleCollapseTab(parent.uid, false)

    expect(parent.collapsed).toBe(false)
    expect(childNote.isVisible).toBe(true)
    expect(childTab.isVisible).toBe(true)
    expectTreeInvariants()
  })

  it('hides and shows mixed descendants when toggling a note', () => {
    const parent = createNote('note-parent' as UID, { isParent: true })
    const childNote = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const childTab = createTab('tab-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    createWindow('window-1' as UID, [parent, childNote, childTab])
    Tree.recomputeSessionTree(false)

    Tree.toggleCollapseNote(parent.uid)

    expect(parent.collapsed).toBe(true)
    expect(childNote.isVisible).toBe(false)
    expect(childTab.isVisible).toBe(false)
    expectTreeInvariants()

    Tree.toggleCollapseNote(parent.uid)

    expect(parent.collapsed).toBe(false)
    expect(childNote.isVisible).toBe(true)
    expect(childTab.isVisible).toBe(true)
    expectTreeInvariants()
  })

  it('does not show descendants when expanding a child whose ancestor remains collapsed', () => {
    const ancestor = createNote('note-ancestor' as UID, {
      collapsed: true,
      isParent: true,
    })
    const parent = createTab('tab-parent' as UID, {
      parentUid: ancestor.uid,
      indentLevel: 2,
      collapsed: true,
      isParent: true,
      isVisible: false,
    })
    const child = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 3,
      isVisible: false,
    })
    createWindow('window-1' as UID, [ancestor, parent, child])

    Tree.toggleCollapseTab(parent.uid, false)

    expect(parent.collapsed).toBe(false)
    expect(child.isVisible).toBe(false)
    expectTreeInvariants()
  })

  it('hides and shows window children when toggling a window', () => {
    const tab = createTab('tab-1' as UID)
    const note = createNote('note-1' as UID)
    const window = createWindow('window-1' as UID, [tab, note])
    Tree.recomputeSessionTree(false)

    Tree.toggleCollapseWindow(window.uid)

    expect(window.collapsed).toBe(true)
    expect(tab.isVisible).toBe(false)
    expect(note.isVisible).toBe(false)
    expectTreeInvariants()

    Tree.toggleCollapseWindow(window.uid)

    expect(window.collapsed).toBe(false)
    expect(tab.isVisible).toBe(true)
    expect(note.isVisible).toBe(true)
    expectTreeInvariants()
  })
})
