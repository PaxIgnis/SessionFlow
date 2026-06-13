import { beforeEach, describe, expect, it } from 'vitest'
import { Tree } from '@/services/background-tree'
import {
  createNote,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

describe('moveTab', () => {
  beforeEach(() => {
    resetTree()
  })

  it('moves a tab under a note parent', async () => {
    const note = createNote('note-parent' as UID)
    const tab = createTab('tab-child' as UID)
    const window = createWindow('window-1' as UID, [note, tab])

    await Tree.moveTab(tab.uid, window.uid, 1, note.uid, false, false)

    const movedTab = Tree.tabsByUid.get(tab.uid)
    expect(window.children.map((item) => item.uid)).toEqual([
      note.uid,
      tab.uid,
    ])
    expect(movedTab?.parentUid).toBe(note.uid)
    expect(movedTab?.indentLevel).toBe(2)
    expect(note.isParent).toBe(true)
    expectTreeInvariants()
  })

  it('hides a tab moved under a collapsed note', async () => {
    const note = createNote('note-parent' as UID, {
      collapsed: true,
      isParent: true,
    })
    const tab = createTab('tab-child' as UID, { isVisible: true })
    const window = createWindow('window-1' as UID, [note, tab])

    await Tree.moveTab(tab.uid, window.uid, 1, note.uid, false, false)

    const movedTab = Tree.tabsByUid.get(tab.uid)
    expect(movedTab?.parentUid).toBe(note.uid)
    expect(movedTab?.isVisible).toBe(false)
    expectTreeInvariants()
  })

  it('does not move a tab when the parent uid is missing', async () => {
    const tab = createTab('tab-child' as UID)
    const window = createWindow('window-1' as UID, [tab])

    await Tree.moveTab(
      tab.uid,
      window.uid,
      0,
      'missing-parent' as UID,
      false,
      false,
    )

    expect(window.children.map((item) => item.uid)).toEqual([tab.uid])
    expect(tab.parentUid).toBeUndefined()
    expect(tab.indentLevel).toBe(1)
    expectTreeInvariants()
  })

  it('does not move a tab under a parent from another window', async () => {
    const tab = createTab('tab-child' as UID)
    const sourceWindow = createWindow('window-source' as UID, [tab])
    const otherNote = createNote('note-other' as UID)
    const targetWindow = createWindow('window-target' as UID, [otherNote])

    await Tree.moveTab(
      tab.uid,
      sourceWindow.uid,
      0,
      otherNote.uid,
      false,
      false,
    )

    expect(sourceWindow.children.map((item) => item.uid)).toEqual([tab.uid])
    expect(targetWindow.children.map((item) => item.uid)).toEqual([
      otherNote.uid,
    ])
    expect(tab.windowUid).toBe(sourceWindow.uid)
    expect(tab.parentUid).toBeUndefined()
    expectTreeInvariants()
  })
})

describe('moveTabs', () => {
  beforeEach(() => {
    resetTree()
  })

  it('moves multiple tabs in tree order and clamps invalid target indexes to the end', async () => {
    const tabA = createTab('tab-a' as UID)
    const note = createNote('note-1' as UID)
    const tabB = createTab('tab-b' as UID)
    const tabC = createTab('tab-c' as UID)
    const window = createWindow('window-1' as UID, [tabA, note, tabB, tabC])

    await Tree.moveTabs([tabC.uid, tabA.uid], window.uid, -1, undefined, false)

    expect(window.children.map((item) => item.uid)).toEqual([
      note.uid,
      tabB.uid,
      tabA.uid,
      tabC.uid,
    ])
    expect(tabA.parentUid).toBeUndefined()
    expect(tabC.parentUid).toBeUndefined()
    expectTreeInvariants()
  })

  it('maintains hierarchy when moving a parent tab and child tab together', async () => {
    const parent = createTab('tab-parent' as UID, { isParent: true })
    const child = createTab('tab-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const targetNote = createNote('note-target' as UID)
    const window = createWindow('window-1' as UID, [parent, child, targetNote])

    await Tree.moveTabs(
      [parent.uid, child.uid],
      window.uid,
      3,
      targetNote.uid,
      false,
    )

    expect(window.children.map((item) => item.uid)).toEqual([
      targetNote.uid,
      parent.uid,
      child.uid,
    ])
    const movedParent = Tree.tabsByUid.get(parent.uid)
    const movedChild = Tree.tabsByUid.get(child.uid)
    expect(movedParent?.parentUid).toBe(targetNote.uid)
    expect(movedParent?.indentLevel).toBe(2)
    expect(movedChild?.parentUid).toBe(parent.uid)
    expect(movedChild?.indentLevel).toBe(3)
    expect(targetNote.isParent).toBe(true)
    expectTreeInvariants()
  })

  it('keeps unpinned tabs after pinned tabs when moving near the start', async () => {
    const pinned = createTab('tab-pinned' as UID, { pinned: true })
    const firstUnpinned = createTab('tab-first-unpinned' as UID)
    const moved = createTab('tab-moved' as UID)
    const window = createWindow('window-1' as UID, [
      pinned,
      firstUnpinned,
      moved,
    ])

    await Tree.moveTabs([moved.uid], window.uid, 0, undefined, false)

    expect(window.children.map((item) => item.uid)).toEqual([
      pinned.uid,
      moved.uid,
      firstUnpinned.uid,
    ])
    expect(moved.parentUid).toBeUndefined()
    expectTreeInvariants()
  })

  it('moves a saved tab from a note child to a sibling above the note', async () => {
    const tab = createTab('tab-1' as UID)
    const window = createWindow('window-1' as UID, [tab])
    const noteUid = Tree.createNote(window.uid, undefined, 'Window note')
    const note = Tree.notesByUid.get(noteUid)
    expect(note).toBeDefined()
    if (!note) return

    await Tree.moveTabs([tab.uid], window.uid, 1, note.uid, false)
    await Tree.moveTabs([tab.uid], window.uid, 0, undefined, false)

    const movedTab = Tree.tabsByUid.get(tab.uid)
    expect(window.children.map((item) => item.uid)).toEqual([
      tab.uid,
      note.uid,
    ])
    expect(movedTab?.parentUid).toBeUndefined()
    expect(movedTab?.indentLevel).toBe(1)
    expect(note.isParent).toBe(false)
    expectTreeInvariants()
  })

  it('uses the UI drop indexes when moving a saved tab into a note and then above it', async () => {
    const tab = createTab('tab-1' as UID)
    const window = createWindow('window-1' as UID, [tab])
    const noteUid = Tree.createNote(window.uid, undefined, 'Window note')
    const note = Tree.notesByUid.get(noteUid)
    expect(note).toBeDefined()
    if (!note) return

    await Tree.moveTabs([tab.uid], window.uid, 2, note.uid, false)
    expect(window.children.map((item) => item.uid)).toEqual([
      note.uid,
      tab.uid,
    ])

    await Tree.moveTabs([tab.uid], window.uid, 0, undefined, false)

    const movedTab = Tree.tabsByUid.get(tab.uid)
    expect(window.children.map((item) => item.uid)).toEqual([
      tab.uid,
      note.uid,
    ])
    expect(movedTab?.parentUid).toBeUndefined()
    expect(movedTab?.indentLevel).toBe(1)
    expect(note.isParent).toBe(false)
    expectTreeInvariants()
  })

  it('moves a tab above a root note when the UI passes the window uid as parent', async () => {
    const note = createNote('note-1' as UID)
    const tab = createTab('tab-1' as UID)
    const window = createWindow('window-1' as UID, [note, tab])

    await Tree.moveTabs([tab.uid], window.uid, 0, window.uid, false)

    const movedTab = Tree.tabsByUid.get(tab.uid)
    expect(window.children.map((item) => item.uid)).toEqual([
      tab.uid,
      note.uid,
    ])
    expect(movedTab?.parentUid).toBeUndefined()
    expect(movedTab?.indentLevel).toBe(1)
    expectTreeInvariants()
  })
})
