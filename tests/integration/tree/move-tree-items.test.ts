import { beforeEach, describe, expect, it } from 'vitest'
import { Tree } from '@/services/background-tree'
import {
  createNote,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

describe('moveTreeItems', () => {
  beforeEach(() => {
    resetTree()
  })

  it('removes the source window when its only note is moved to another window', () => {
    const movedNote = createNote('note-moved' as UID)
    const sourceWindow = createWindow('window-source' as UID, [movedNote])
    const targetTab = createTab('tab-target' as UID)
    const targetWindow = createWindow('window-target' as UID, [targetTab])

    Tree.moveTreeItems([movedNote.uid], 1, undefined, targetWindow.uid, false)

    expect(Tree.windowsByUid.has(sourceWindow.uid)).toBe(false)
    expect(Tree.Items.map((item) => item.uid)).toEqual([targetWindow.uid])
    expect(targetWindow.children.map((item) => item.uid)).toEqual([
      targetTab.uid,
      movedNote.uid,
    ])
    expect(movedNote.windowUid).toBe(targetWindow.uid)
    expect(movedNote.parentUid).toBeUndefined()
    expect(movedNote.indentLevel).toBe(1)
    expectTreeInvariants()
  })

  it('hides a note moved under a collapsed note', () => {
    const parentNote = createNote('note-parent' as UID, {
      collapsed: true,
      isParent: true,
    })
    const movedNote = createNote('note-child' as UID, { isVisible: true })
    const window = createWindow('window-1' as UID, [parentNote, movedNote])

    Tree.moveTreeItems([movedNote.uid], 1, parentNote.uid, window.uid, false)

    expect(movedNote.parentUid).toBe(parentNote.uid)
    expect(movedNote.isVisible).toBe(false)
    expect(movedNote.indentLevel).toBe(2)
    expectTreeInvariants()
  })

  it('moves top-level notes into a window root without corrupting target index', () => {
    const noteA = createNote('note-a' as UID, { indentLevel: 0 })
    const noteB = createNote('note-b' as UID, { indentLevel: 0 })
    const noteC = createNote('note-c' as UID, { indentLevel: 0 })
    Tree.Items.push(noteA, noteB, noteC)
    Tree.notesByUid.set(noteA.uid, noteA)
    Tree.notesByUid.set(noteB.uid, noteB)
    Tree.notesByUid.set(noteC.uid, noteC)
    Tree.existingUidsSet.add(noteA.uid)
    Tree.existingUidsSet.add(noteB.uid)
    Tree.existingUidsSet.add(noteC.uid)
    const tab = createTab('tab-target' as UID)
    const window = createWindow('window-1' as UID, [tab])

    Tree.moveTreeItems(
      [noteA.uid, noteB.uid, noteC.uid],
      1,
      undefined,
      window.uid,
      false,
    )

    expect(Tree.Items.map((item) => item.uid)).toEqual([window.uid])
    expect(window.children.map((item) => item.uid)).toEqual([
      tab.uid,
      noteA.uid,
      noteB.uid,
      noteC.uid,
    ])
    for (const note of [noteA, noteB, noteC]) {
      expect(note.windowUid).toBe(window.uid)
      expect(note.parentUid).toBeUndefined()
      expect(note.indentLevel).toBe(1)
    }
    expectTreeInvariants()
  })

  it('moves below a subtree in the same window without splitting descendants', () => {
    const parent = createNote('note-parent' as UID, { isParent: true })
    const child = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const moving = createNote('note-moving' as UID)
    const tail = createTab('tab-tail' as UID)
    const window = createWindow('window-1' as UID, [parent, child, moving, tail])

    Tree.moveTreeItems([moving.uid], 3, undefined, window.uid, false)

    expect(window.children.map((item) => item.uid)).toEqual([
      parent.uid,
      child.uid,
      moving.uid,
      tail.uid,
    ])
    expect(moving.parentUid).toBeUndefined()
    expect(moving.indentLevel).toBe(1)
    expectTreeInvariants()
  })

  it('moves a note and its descendants as a single block', () => {
    const parent = createNote('note-parent' as UID, { isParent: true })
    const child = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const target = createNote('note-target' as UID)
    const window = createWindow('window-1' as UID, [parent, child, target])

    Tree.moveTreeItems([parent.uid], 3, target.uid, window.uid, false)

    expect(window.children.map((item) => item.uid)).toEqual([
      target.uid,
      parent.uid,
      child.uid,
    ])
    expect(parent.parentUid).toBe(target.uid)
    expect(parent.indentLevel).toBe(2)
    expect(child.parentUid).toBe(parent.uid)
    expect(child.indentLevel).toBe(3)
    expect(target.isParent).toBe(true)
    expectTreeInvariants()
  })

  it('moves an expanded note without descendants when child inclusion is disabled', () => {
    const targetTab = createTab('tab-target' as UID)
    const note = createNote('note-parent' as UID, { isParent: true })
    const childTab = createTab('tab-child' as UID, {
      parentUid: note.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [
      targetTab,
      note,
      childTab,
    ])

    ;(Tree.moveTreeItems as (
      itemUIDs: UID[],
      targetIndex: number,
      parentUid?: UID,
      targetWindowUid?: UID,
      copy?: boolean,
      includeDescendants?: boolean,
    ) => void)([note.uid], 1, targetTab.uid, window.uid, false, false)

    expect(window.children.map((item) => item.uid)).toEqual([
      targetTab.uid,
      note.uid,
      childTab.uid,
    ])
    expect(note.parentUid).toBe(targetTab.uid)
    expect(note.indentLevel).toBe(2)
    expect(note.isParent).toBe(false)
    expect(childTab.parentUid).toBeUndefined()
    expect(childTab.indentLevel).toBe(1)
    expectTreeInvariants()
  })

  it('does not move a note into a window when included descendants contain a window', () => {
    const note = createNote('note-parent' as UID, {
      indentLevel: 0,
      isParent: true,
      windowUid: undefined,
    })
    const childWindow = createWindow('window-child' as UID, [], {
      indentLevel: 1,
      parentUid: note.uid,
    })
    Tree.Items.splice(0, 0, note)
    Tree.notesByUid.set(note.uid, note)
    Tree.existingUidsSet.add(note.uid)
    const targetWindow = createWindow('window-target' as UID)

    ;(Tree.moveTreeItems as (
      itemUIDs: UID[],
      targetIndex: number,
      parentUid?: UID,
      targetWindowUid?: UID,
      copy?: boolean,
      includeDescendants?: boolean,
    ) => void)([note.uid], 0, undefined, targetWindow.uid, false, true)

    expect(Tree.Items.map((item) => item.uid)).toEqual([
      note.uid,
      childWindow.uid,
      targetWindow.uid,
    ])
    expect(targetWindow.children).toEqual([])
    expect(note.parentUid).toBeUndefined()
    expect(note.windowUid).toBeUndefined()
    expect(note.isParent).toBe(true)
    expect(childWindow.parentUid).toBe(note.uid)
    expect(childWindow.indentLevel).toBe(1)
    expectTreeInvariants()
  })

  it('does not move a note as a sibling of its child window under itself', () => {
    const note = createNote('note-parent' as UID, {
      indentLevel: 0,
      isParent: true,
      windowUid: undefined,
    })
    const childWindow = createWindow('window-child' as UID, [], {
      indentLevel: 1,
      parentUid: note.uid,
    })
    Tree.Items.splice(0, 0, note)
    Tree.notesByUid.set(note.uid, note)
    Tree.existingUidsSet.add(note.uid)

    Tree.moveTreeItems([note.uid], 1, note.uid, undefined, false, true)

    expect(Tree.Items.map((item) => item.uid)).toEqual([
      note.uid,
      childWindow.uid,
    ])
    expect(note.parentUid).toBeUndefined()
    expect(note.indentLevel).toBe(0)
    expect(note.isParent).toBe(true)
    expect(childWindow.parentUid).toBe(note.uid)
    expect(childWindow.indentLevel).toBe(1)
    expectTreeInvariants()
  })

  it('moves a top-level note with its child window when descendants are included', () => {
    const note = createNote('note-parent' as UID, {
      indentLevel: 0,
      isParent: true,
      windowUid: undefined,
    })
    const childWindow = createWindow('window-child' as UID, [], {
      indentLevel: 1,
      parentUid: note.uid,
    })
    Tree.Items.splice(0, 0, note)
    Tree.notesByUid.set(note.uid, note)
    Tree.existingUidsSet.add(note.uid)
    const targetWindow = createWindow('window-target' as UID)

    Tree.moveTreeItems([note.uid], 3, undefined, undefined, false, true)

    expect(Tree.Items.map((item) => item.uid)).toEqual([
      targetWindow.uid,
      note.uid,
      childWindow.uid,
    ])
    expect(note.parentUid).toBeUndefined()
    expect(note.indentLevel).toBe(0)
    expect(note.isParent).toBe(true)
    expect(childWindow.parentUid).toBe(note.uid)
    expect(childWindow.indentLevel).toBe(1)
    expectTreeInvariants()
  })

  it.each([
    { label: 'always', includeDescendants: true },
    { label: 'collapsed', includeDescendants: true },
    { label: 'never', includeDescendants: false },
  ])(
    'moves a collapsed root note above another root window with child inclusion setting: $label',
    ({ includeDescendants }) => {
      const targetWindow = createWindow('window-target' as UID)
      const note = createNote('note-parent' as UID, {
        collapsed: true,
        indentLevel: 0,
        isParent: true,
        windowUid: undefined,
      })
      const childWindow = createWindow('window-child' as UID, [], {
        indentLevel: 1,
        parentUid: note.uid,
      })
      Tree.Items.splice(1, 0, note)
      Tree.notesByUid.set(note.uid, note)
      Tree.existingUidsSet.add(note.uid)

      Tree.moveTreeItems(
        [note.uid],
        0,
        undefined,
        undefined,
        false,
        includeDescendants,
      )

      if (includeDescendants) {
        expect(Tree.Items.map((item) => item.uid)).toEqual([
          note.uid,
          childWindow.uid,
          targetWindow.uid,
        ])
        expect(note.isParent).toBe(true)
        expect(note.collapsed).toBe(true)
        expect(childWindow.parentUid).toBe(note.uid)
        expect(childWindow.indentLevel).toBe(1)
      } else {
        expect(Tree.Items.map((item) => item.uid)).toEqual([
          note.uid,
          targetWindow.uid,
          childWindow.uid,
        ])
        expect(note.isParent).toBe(false)
        expect(note.collapsed).toBe(false)
        expect(childWindow.parentUid).toBeUndefined()
        expect(childWindow.indentLevel).toBe(0)
      }
      expect(note.parentUid).toBeUndefined()
      expect(note.windowUid).toBeUndefined()
      expect(note.indentLevel).toBe(0)
      expectTreeInvariants()
    },
  )

  it('moves only a note into a window when window descendants are not included', () => {
    const note = createNote('note-parent' as UID, {
      indentLevel: 0,
      isParent: true,
      windowUid: undefined,
    })
    const childWindow = createWindow('window-child' as UID, [], {
      indentLevel: 1,
      parentUid: note.uid,
    })
    Tree.Items.splice(0, 0, note)
    Tree.notesByUid.set(note.uid, note)
    Tree.existingUidsSet.add(note.uid)
    const targetWindow = createWindow('window-target' as UID)

    ;(Tree.moveTreeItems as (
      itemUIDs: UID[],
      targetIndex: number,
      parentUid?: UID,
      targetWindowUid?: UID,
      copy?: boolean,
      includeDescendants?: boolean,
    ) => void)([note.uid], 0, undefined, targetWindow.uid, false, false)

    expect(Tree.Items.map((item) => item.uid)).toEqual([
      childWindow.uid,
      targetWindow.uid,
    ])
    expect(targetWindow.children.map((item) => item.uid)).toEqual([note.uid])
    expect(note.parentUid).toBeUndefined()
    expect(note.windowUid).toBe(targetWindow.uid)
    expect(note.indentLevel).toBe(1)
    expect(note.isParent).toBe(false)
    expect(childWindow.parentUid).toBeUndefined()
    expect(childWindow.indentLevel).toBe(0)
    expectTreeInvariants()
  })

  it('ignores selected descendants when their ancestor is also moved', () => {
    const parent = createNote('note-parent' as UID, { isParent: true })
    const child = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const target = createTab('tab-target' as UID)
    const window = createWindow('window-1' as UID, [parent, child, target])

    Tree.moveTreeItems([parent.uid, child.uid], 3, target.uid, window.uid, false)

    expect(window.children.map((item) => item.uid)).toEqual([
      target.uid,
      parent.uid,
      child.uid,
    ])
    expect(parent.parentUid).toBe(target.uid)
    expect(child.parentUid).toBe(parent.uid)
    expectTreeInvariants()
  })

  it('does not move a note into its own descendant', () => {
    const parent = createNote('note-parent' as UID, { isParent: true })
    const child = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [parent, child])

    Tree.moveTreeItems([parent.uid], 2, child.uid, window.uid, false)

    expect(window.children.map((item) => item.uid)).toEqual([
      parent.uid,
      child.uid,
    ])
    expect(parent.parentUid).toBeUndefined()
    expect(child.parentUid).toBe(parent.uid)
    expectTreeInvariants()
  })

  it('does not move tabs to the top-level tree', () => {
    const tab = createTab('tab-1' as UID)
    const window = createWindow('window-1' as UID, [tab])

    Tree.moveTreeItems([tab.uid], 0, undefined, undefined, false)

    expect(Tree.Items.map((item) => item.uid)).toEqual([window.uid])
    expect(window.children.map((item) => item.uid)).toEqual([tab.uid])
    expect(tab.parentUid).toBeUndefined()
    expectTreeInvariants()
  })

  it('moves a note out of a window without moving its tab child to the top-level tree', () => {
    const note = createNote('note-1' as UID, { isParent: true })
    const childTab = createTab('tab-child' as UID, {
      parentUid: note.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [note, childTab])

    Tree.moveTreeItems([note.uid], 0, undefined, undefined, false)

    expect(Tree.Items.map((item) => item.uid)).toEqual([note.uid, window.uid])
    expect(window.children.map((item) => item.uid)).toEqual([childTab.uid])
    expect(note.windowUid).toBeUndefined()
    expect(note.parentUid).toBeUndefined()
    expect(note.indentLevel).toBe(0)
    expect(note.isParent).toBe(false)
    expect(childTab.windowUid).toBe(window.uid)
    expect(childTab.parentUid).toBeUndefined()
    expect(childTab.indentLevel).toBe(1)
    expect(Tree.windowsByUid.has(window.uid)).toBe(true)
    expectTreeInvariants()
  })

  it('moves a root window above a child window as a note sibling', () => {
    const sourceWindow = createWindow('window-source' as UID)
    const parentNote = createNote('note-parent' as UID, {
      indentLevel: 0,
      isParent: true,
      windowUid: undefined,
    })
    const childWindow = createWindow('window-child' as UID, [], {
      indentLevel: 1,
      parentUid: parentNote.uid,
    })
    Tree.Items.splice(1, 0, parentNote)
    Tree.notesByUid.set(parentNote.uid, parentNote)
    Tree.existingUidsSet.add(parentNote.uid)

    Tree.moveTreeItems(
      [sourceWindow.uid],
      2,
      parentNote.uid,
      undefined,
      false,
    )

    expect(Tree.Items.map((item) => item.uid)).toEqual([
      parentNote.uid,
      sourceWindow.uid,
      childWindow.uid,
    ])
    expect(sourceWindow.parentUid).toBe(parentNote.uid)
    expect(sourceWindow.indentLevel).toBe(1)
    expect(parentNote.isParent).toBe(true)
    expectTreeInvariants()
  })
})
