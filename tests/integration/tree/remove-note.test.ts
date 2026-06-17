import { beforeEach, describe, expect, it } from 'vitest'
import { Tree } from '@/services/background-tree'
import { State } from '@/types/session-tree'
import {
  createNote,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

describe('note mutations', () => {
  beforeEach(() => {
    resetTree()
  })

  it('creates top-level notes', () => {
    const noteUid = Tree.createNote(undefined, undefined, 'Top note')
    const note = Tree.notesByUid.get(noteUid)

    expect(Tree.Items.map((item) => item.uid)).toEqual([noteUid])
    expect(note?.text).toBe('Top note')
    expect(note?.parentUid).toBeUndefined()
    expect(note?.windowUid).toBeUndefined()
    expect(note?.indentLevel).toBe(0)
    expect(note?.isVisible).toBe(true)
    expectTreeInvariants()
  })

  it('creates notes as first children of tab and note parents', () => {
    const tab = createTab('tab-parent' as UID)
    const noteParent = createNote('note-parent' as UID)
    const window = createWindow('window-1' as UID, [tab, noteParent])

    const tabChildUid = Tree.createNote(tab.uid, undefined, 'Tab child')
    const noteChildUid = Tree.createNote(
      noteParent.uid,
      undefined,
      'Note child',
    )
    const tabChild = Tree.notesByUid.get(tabChildUid)
    const noteChild = Tree.notesByUid.get(noteChildUid)

    expect(window.children.map((item) => item.uid)).toEqual([
      tab.uid,
      tabChildUid,
      noteParent.uid,
      noteChildUid,
    ])
    expect(tabChild?.parentUid).toBe(tab.uid)
    expect(tabChild?.windowUid).toBe(window.uid)
    expect(tabChild?.indentLevel).toBe(2)
    expect(noteChild?.parentUid).toBe(noteParent.uid)
    expect(noteChild?.windowUid).toBe(window.uid)
    expect(noteChild?.indentLevel).toBe(2)
    expect(tab.isParent).toBe(true)
    expect(noteParent.isParent).toBe(true)
    expectTreeInvariants()
  })

  it('creates notes hidden under a collapsed parent', () => {
    const parent = createNote('note-parent' as UID, {
      collapsed: true,
      isParent: true,
    })
    const window = createWindow('window-1' as UID, [parent])

    const childUid = Tree.createNote(parent.uid, undefined, 'Hidden child')
    const child = Tree.notesByUid.get(childUid)

    expect(child?.parentUid).toBe(parent.uid)
    expect(child?.windowUid).toBe(window.uid)
    expect(child?.isVisible).toBe(false)
    expectTreeInvariants()
  })

  it('removes the window when removing its only note child', () => {
    const note = createNote('note-only' as UID)
    const window = createWindow('window-1' as UID, [note])

    Tree.removeNote(note.uid)

    expect(Tree.windowsByUid.has(window.uid)).toBe(false)
    expect(Tree.Items.map((item) => item.uid)).not.toContain(window.uid)
    expect(Tree.notesByUid.has(note.uid)).toBe(false)
    expectTreeInvariants()
  })

  it('keeps an open window when removing its only note promotes an open tab child', () => {
    const note = createNote('note-parent' as UID, { isParent: true })
    const childTab = createTab('tab-child' as UID, {
      active: true,
      id: 10,
      parentUid: note.uid,
      state: State.OPEN,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [note, childTab], {
      active: true,
      activeTabId: childTab.id,
      id: 20,
      state: State.OPEN,
    })

    Tree.removeNote(note.uid)

    expect(Tree.windowsByUid.has(window.uid)).toBe(true)
    expect(Tree.Items.map((item) => item.uid)).toEqual([window.uid])
    expect(window.children.map((item) => item.uid)).toEqual([childTab.uid])
    expect(Tree.notesByUid.has(note.uid)).toBe(false)
    expect(Tree.tabsByUid.get(childTab.uid)).toBe(childTab)
    expect(childTab.windowUid).toBe(window.uid)
    expect(childTab.parentUid).toBeUndefined()
    expect(childTab.indentLevel).toBe(1)
    expect(childTab.state).toBe(State.OPEN)
    expect(window.state).toBe(State.OPEN)
    expect(window.activeTabId).toBe(childTab.id)
    expectTreeInvariants()
  })

  it('promotes note children when removing a parent note', () => {
    const parent = createNote('note-parent' as UID, { isParent: true })
    const childTab = createTab('tab-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const childNote = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const sibling = createTab('tab-sibling' as UID)
    const window = createWindow('window-1' as UID, [
      parent,
      childTab,
      childNote,
      sibling,
    ])

    Tree.removeNote(parent.uid)

    expect(window.children.map((item) => item.uid)).toEqual([
      childTab.uid,
      childNote.uid,
      sibling.uid,
    ])
    expect(Tree.notesByUid.has(parent.uid)).toBe(false)
    expect(Tree.tabsByUid.get(childTab.uid)).toBe(childTab)
    expect(Tree.notesByUid.get(childNote.uid)).toBe(childNote)
    expect(childTab.parentUid).toBeUndefined()
    expect(childNote.parentUid).toBeUndefined()
    expect(childTab.indentLevel).toBe(1)
    expect(childNote.indentLevel).toBe(1)
    expectTreeInvariants()
  })
})
