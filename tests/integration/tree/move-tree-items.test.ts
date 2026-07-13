import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import {
  createNote,
  createSeparator,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'
import { installFakeBrowser } from '../../helpers/fake-browser'
import { State, Tab, Window } from '@/types/session-tree'

describe('moveTreeItems', () => {
  beforeEach(() => {
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
    Settings.values.allowDropOntoDescendantItems = true
  })

  it('copies a live tab subtree as saved items without changing browser or source state', async () => {
    const fakeBrowser = installFakeBrowser()
    const sourceGroup = {
      uid: 'group-source' as UID,
      id: 70,
      title: 'Source group',
      color: 'blue' as const,
      collapsed: false,
    }
    const sourceTab = createTab('tab-source' as UID, {
      id: 10,
      state: State.OPEN,
      active: true,
      isParent: true,
      tabGroup: sourceGroup,
    })
    const sourceNote = createNote('note-source-child' as UID, {
      parentUid: sourceTab.uid,
      indentLevel: 2,
    })
    const sourceChildTab = createTab('tab-source-child' as UID, {
      id: 11,
      state: State.DISCARDED,
      parentUid: sourceTab.uid,
      indentLevel: 2,
      tabGroup: sourceGroup,
    })
    const sourceWindow = createWindow(
      'window-source' as UID,
      [sourceTab, sourceNote, sourceChildTab],
      { id: 100, state: State.OPEN },
    )
    const targetNote = createNote('note-target' as UID)
    const targetWindow = createWindow('window-target' as UID, [targetNote], {
      id: 200,
      state: State.OPEN,
    })

    await Tree.moveTreeItems(
      [sourceTab.uid],
      1,
      targetNote.uid,
      targetWindow.uid,
      true,
      true,
    )

    expect(sourceWindow.children).toEqual([
      sourceTab,
      sourceNote,
      sourceChildTab,
    ])
    expect(sourceTab.state).toBe(State.OPEN)
    expect(sourceChildTab.state).toBe(State.DISCARDED)
    const copiedTab = targetWindow.children[1] as Tab
    const copiedNote = targetWindow.children[2]
    const copiedChildTab = targetWindow.children[3] as Tab
    expect(copiedTab.uid).not.toBe(sourceTab.uid)
    expect(copiedTab).toMatchObject({
      id: -1,
      state: State.SAVED,
      active: false,
      parentUid: targetNote.uid,
      windowUid: targetWindow.uid,
      indentLevel: 2,
    })
    expect(copiedNote.parentUid).toBe(copiedTab.uid)
    expect(copiedChildTab).toMatchObject({
      id: -1,
      state: State.SAVED,
      active: false,
      parentUid: copiedTab.uid,
      windowUid: targetWindow.uid,
      indentLevel: 3,
    })
    expect(copiedTab.tabGroup?.uid).not.toBe(sourceGroup.uid)
    expect(copiedChildTab.tabGroup).toEqual(copiedTab.tabGroup)
    expect(copiedTab.tabGroup?.id).toBe(-1)
    expect(fakeBrowser.tabs.move).not.toHaveBeenCalled()
    expect(fakeBrowser.tabs.duplicate).not.toHaveBeenCalled()
    expect(fakeBrowser.windows.create).not.toHaveBeenCalled()
    expectTreeInvariants()
  })

  it('copies only the root and clears parent metadata when descendants are excluded', async () => {
    const parent = createNote('note-parent' as UID, {
      collapsed: true,
      isParent: true,
    })
    const child = createTab('tab-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [parent, child])

    await Tree.moveTreeItems(
      [parent.uid],
      window.children.length,
      undefined,
      window.uid,
      true,
      false,
    )

    expect(window.children).toHaveLength(3)
    expect(window.children[0]).toBe(parent)
    expect(window.children[1]).toBe(child)
    const copy = window.children[2]
    expect(copy.uid).not.toBe(parent.uid)
    expect(copy.isParent).toBe(false)
    expect(copy.collapsed).toBe(false)
    expect(copy.parentUid).toBeUndefined()
    expect(parent.isParent).toBe(true)
    expect(parent.collapsed).toBe(true)
    expect(child.parentUid).toBe(parent.uid)
    expectTreeInvariants()
  })

  it('copies explicitly selected parent and child tabs without unselected descendants', async () => {
    const ancestor = createTab('tab-ancestor' as UID, { isParent: true })
    const parent = createTab('tab-parent' as UID, {
      id: 20,
      state: State.OPEN,
      parentUid: ancestor.uid,
      indentLevel: 2,
      isParent: true,
    })
    const child = createTab('tab-child' as UID, {
      id: 30,
      state: State.OPEN,
      parentUid: parent.uid,
      indentLevel: 3,
      isParent: true,
    })
    const unselectedGrandchild = createTab('tab-grandchild' as UID, {
      parentUid: child.uid,
      indentLevel: 4,
    })
    const target = createTab('tab-target' as UID)
    const window = createWindow('window-1' as UID, [
      ancestor,
      parent,
      child,
      unselectedGrandchild,
      target,
    ])

    await Tree.moveTreeItems(
      [parent.uid, child.uid],
      window.children.length,
      target.uid,
      window.uid,
      true,
      false,
    )

    expect(window.children).toHaveLength(7)
    expect(window.children.slice(0, 5)).toEqual([
      ancestor,
      parent,
      child,
      unselectedGrandchild,
      target,
    ])
    const copiedParent = window.children[5] as Tab
    const copiedChild = window.children[6] as Tab
    expect(copiedParent).toMatchObject({
      state: State.SAVED,
      parentUid: target.uid,
      indentLevel: 2,
      isParent: true,
    })
    expect(copiedParent.uid).not.toBe(parent.uid)
    expect(copiedChild).toMatchObject({
      state: State.SAVED,
      parentUid: copiedParent.uid,
      indentLevel: 3,
      isParent: false,
      collapsed: false,
    })
    expect(copiedChild.uid).not.toBe(child.uid)
    expect(unselectedGrandchild.parentUid).toBe(child.uid)
    expect(child.isParent).toBe(true)
    expectTreeInvariants()
  })

  it('uses the destination group when copying a tab between grouped tabs', async () => {
    const sourceGroup = {
      uid: 'group-source' as UID,
      id: 10,
      title: 'Source',
      color: 'red' as const,
      collapsed: false,
    }
    const destinationGroup = {
      uid: 'group-destination' as UID,
      id: 20,
      title: 'Destination',
      color: 'green' as const,
      collapsed: false,
    }
    const sourceTab = createTab('tab-source' as UID, {
      tabGroup: sourceGroup,
    })
    createWindow('window-source' as UID, [sourceTab])
    const above = createTab('tab-above' as UID, {
      tabGroup: destinationGroup,
    })
    const below = createTab('tab-below' as UID, {
      tabGroup: destinationGroup,
    })
    const targetWindow = createWindow('window-target' as UID, [above, below])

    await Tree.moveTreeItems(
      [sourceTab.uid],
      1,
      undefined,
      targetWindow.uid,
      true,
      false,
    )

    const copy = targetWindow.children[1] as Tab
    expect(copy.uid).not.toBe(sourceTab.uid)
    expect(copy.tabGroup).toEqual({ ...destinationGroup, id: -1 })
    expect(sourceTab.tabGroup).toEqual(sourceGroup)
    expectTreeInvariants()
  })

  it('copies an open window and all tabs as a saved window', async () => {
    const group = {
      uid: 'group-source' as UID,
      id: 30,
      title: 'Window group',
      color: 'purple' as const,
      collapsed: true,
    }
    const tab = createTab('tab-source' as UID, {
      id: 41,
      state: State.OPEN,
      active: true,
      tabGroup: group,
    })
    const sourceWindow = createWindow('window-source' as UID, [tab], {
      id: 40,
      state: State.OPEN,
      active: true,
      activeTabId: tab.id,
    })

    await Tree.moveTreeItems(
      [sourceWindow.uid],
      Tree.Items.length,
      undefined,
      undefined,
      true,
      true,
    )

    expect(Tree.Items).toHaveLength(2)
    expect(Tree.Items[0]).toBe(sourceWindow)
    const copy = Tree.Items[1] as Window
    const copiedTab = copy.children[0] as Tab
    expect(copy.uid).not.toBe(sourceWindow.uid)
    expect(copy).toMatchObject({
      id: -1,
      state: State.SAVED,
      active: false,
      activeTabId: undefined,
    })
    expect(copiedTab).toMatchObject({
      id: -1,
      state: State.SAVED,
      active: false,
      windowUid: copy.uid,
    })
    expect(copiedTab.tabGroup?.uid).not.toBe(group.uid)
    expect(copiedTab.tabGroup?.id).toBe(-1)
    expect(sourceWindow.state).toBe(State.OPEN)
    expect(tab.state).toBe(State.OPEN)
    expectTreeInvariants()
  })

  it('rejects copying a tab to the top-level tree', async () => {
    const tab = createTab('tab-source' as UID)
    const window = createWindow('window-source' as UID, [tab])

    await Tree.moveTreeItems(
      [tab.uid],
      Tree.Items.length,
      undefined,
      undefined,
      true,
      false,
    )

    expect(Tree.Items).toEqual([window])
    expect(window.children).toEqual([tab])
    expect(Tree.tabsByUid.size).toBe(1)
    expectTreeInvariants()
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
    const window = createWindow('window-1' as UID, [
      parent,
      child,
      moving,
      tail,
    ])

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

  it('uses browser-backed movement for an included open tab descendant under a moved note', async () => {
    const fakeBrowser = installFakeBrowser()
    const target = createTab('tab-target' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const note = createNote('note-parent' as UID, { isParent: true })
    const childTab = createTab('tab-child' as UID, {
      id: 20,
      state: State.OPEN,
      parentUid: note.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [target, note, childTab], {
      id: 100,
      state: State.OPEN,
    })
    fakeBrowser.tabs.move.mockResolvedValueOnce({ id: 20 } as browser.tabs.Tab)

    await Tree.moveTreeItems([note.uid], 0, undefined, window.uid, false, true)

    expect(fakeBrowser.tabs.move).toHaveBeenCalled()
    expect(window.children.map((item) => item.uid)).toEqual([
      note.uid,
      childTab.uid,
      target.uid,
    ])
    expect(note.parentUid).toBeUndefined()
    expect(childTab.parentUid).toBe(note.uid)
    expect(note.indentLevel).toBe(1)
    expect(childTab.indentLevel).toBe(2)
    expectTreeInvariants()
  })

  it('does not detach descendants while rejecting an invalid browser-backed move', async () => {
    const fakeBrowser = installFakeBrowser()
    const parentTab = createTab('tab-parent' as UID, {
      collapsed: true,
      isParent: true,
      state: State.OPEN,
    })
    const childNote = createNote('note-child' as UID, {
      parentUid: parentTab.uid,
      indentLevel: 2,
      isVisible: false,
    })
    const separator = createSeparator('separator-target' as UID)
    const window = createWindow('window-1' as UID, [
      parentTab,
      childNote,
      separator,
    ])

    await Tree.moveTreeItems(
      [parentTab.uid],
      2,
      separator.uid,
      window.uid,
      false,
      false,
    )

    expect(fakeBrowser.tabs.move).not.toHaveBeenCalled()
    expect(window.children.map((item) => item.uid)).toEqual([
      parentTab.uid,
      childNote.uid,
      separator.uid,
    ])
    expect(parentTab.isParent).toBe(true)
    expect(parentTab.collapsed).toBe(true)
    expect(childNote.parentUid).toBe(parentTab.uid)
    expect(childNote.indentLevel).toBe(2)
    expectTreeInvariants()
  })

  it('moves an expanded note without descendants when child inclusion is disabled', () => {
    const targetTab = createTab('tab-target' as UID)
    const note = createNote('note-parent' as UID, { isParent: true })
    const childTab = createTab('tab-child' as UID, {
      parentUid: note.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [targetTab, note, childTab])

    ;(
      Tree.moveTreeItems as (
        itemUIDs: UID[],
        targetIndex: number,
        parentUid?: UID,
        targetWindowUid?: UID,
        copy?: boolean,
        includeDescendants?: boolean,
      ) => void
    )([note.uid], 1, targetTab.uid, window.uid, false, false)

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

  it('moves explicitly selected indented parent and child without their unselected descendant', async () => {
    const ancestor = createTab('tab-ancestor' as UID, { isParent: true })
    const parent = createTab('tab-parent' as UID, {
      parentUid: ancestor.uid,
      indentLevel: 2,
      isParent: true,
    })
    const child = createTab('tab-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 3,
      isParent: true,
    })
    const unselectedGrandchild = createTab('tab-grandchild' as UID, {
      parentUid: child.uid,
      indentLevel: 4,
    })
    const target = createTab('tab-target' as UID)
    const window = createWindow('window-1' as UID, [
      ancestor,
      parent,
      child,
      unselectedGrandchild,
      target,
    ])

    await Tree.moveTreeItems(
      [parent.uid, child.uid],
      window.children.length,
      target.uid,
      window.uid,
      false,
      false,
    )

    expect(window.children).toEqual([
      ancestor,
      unselectedGrandchild,
      target,
      parent,
      child,
    ])
    expect(parent.parentUid).toBe(target.uid)
    expect(parent.indentLevel).toBe(2)
    expect(parent.isParent).toBe(true)
    expect(child.parentUid).toBe(parent.uid)
    expect(child.indentLevel).toBe(3)
    expect(child.isParent).toBe(false)
    expect(unselectedGrandchild.parentUid).toBe(ancestor.uid)
    expect(unselectedGrandchild.indentLevel).toBe(2)
    expectTreeInvariants()
  })

  it('moves both explicitly selected open parent and child tabs through Firefox', async () => {
    const fakeBrowser = installFakeBrowser()
    const ancestor = createTab('tab-ancestor' as UID, {
      id: 10,
      state: State.OPEN,
      isParent: true,
    })
    const parent = createTab('tab-parent' as UID, {
      id: 20,
      state: State.OPEN,
      parentUid: ancestor.uid,
      indentLevel: 2,
      isParent: true,
    })
    const child = createTab('tab-child' as UID, {
      id: 30,
      state: State.OPEN,
      parentUid: parent.uid,
      indentLevel: 3,
    })
    const target = createTab('tab-target' as UID, {
      id: 40,
      state: State.OPEN,
    })
    const window = createWindow(
      'window-1' as UID,
      [ancestor, parent, child, target],
      { id: 100, state: State.OPEN },
    )
    fakeBrowser.tabs.move
      .mockResolvedValueOnce({ id: parent.id } as browser.tabs.Tab)
      .mockResolvedValueOnce({ id: child.id } as browser.tabs.Tab)

    await Tree.moveTreeItems(
      [parent.uid, child.uid],
      window.children.length,
      target.uid,
      window.uid,
      false,
      false,
    )

    expect(fakeBrowser.tabs.move).toHaveBeenCalledTimes(2)
    expect(window.children.map((item) => item.uid)).toEqual([
      ancestor.uid,
      target.uid,
      parent.uid,
      child.uid,
    ])
    const movedParent = Tree.tabsByUid.get(parent.uid)
    const movedChild = Tree.tabsByUid.get(child.uid)
    expect(movedParent?.parentUid).toBe(target.uid)
    expect(movedParent?.indentLevel).toBe(2)
    expect(movedParent?.isParent).toBe(true)
    expect(movedChild?.parentUid).toBe(parent.uid)
    expect(movedChild?.indentLevel).toBe(3)
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

    ;(
      Tree.moveTreeItems as (
        itemUIDs: UID[],
        targetIndex: number,
        parentUid?: UID,
        targetWindowUid?: UID,
        copy?: boolean,
        includeDescendants?: boolean,
      ) => void
    )([note.uid], 0, undefined, targetWindow.uid, false, true)

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

    ;(
      Tree.moveTreeItems as (
        itemUIDs: UID[],
        targetIndex: number,
        parentUid?: UID,
        targetWindowUid?: UID,
        copy?: boolean,
        includeDescendants?: boolean,
      ) => void
    )([note.uid], 0, undefined, targetWindow.uid, false, false)

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

    Tree.moveTreeItems(
      [parent.uid, child.uid],
      3,
      target.uid,
      window.uid,
      false,
    )

    expect(window.children.map((item) => item.uid)).toEqual([
      target.uid,
      parent.uid,
      child.uid,
    ])
    expect(parent.parentUid).toBe(target.uid)
    expect(child.parentUid).toBe(parent.uid)
    expectTreeInvariants()
  })

  it.each([
    {
      label: 'direct descendant',
      targetIndex: 2,
      parentUid: 'note-child' as UID,
      expectedOrder: ['note-child', 'note-parent', 'tab-tail'],
      expectedParents: {
        'note-parent': 'note-child' as UID,
        'note-child': undefined,
      },
      expectedIndents: {
        'note-parent': 2,
        'note-child': 1,
      },
    },
    {
      label: 'nested descendant',
      targetIndex: 3,
      parentUid: 'note-grandchild' as UID,
      expectedOrder: [
        'note-child',
        'note-grandchild',
        'note-parent',
        'tab-tail',
      ],
      expectedParents: {
        'note-parent': 'note-grandchild' as UID,
        'note-child': undefined,
        'note-grandchild': 'note-child' as UID,
      },
      expectedIndents: {
        'note-parent': 3,
        'note-child': 1,
        'note-grandchild': 2,
      },
    },
  ])(
    'moves a note onto its $label and updates hierarchy',
    ({
      targetIndex,
      parentUid,
      expectedOrder,
      expectedParents,
      expectedIndents,
    }) => {
      const parent = createNote('note-parent' as UID, { isParent: true })
      const child = createNote('note-child' as UID, {
        parentUid: parent.uid,
        indentLevel: 2,
        isParent: true,
      })
      const grandchild = createNote('note-grandchild' as UID, {
        parentUid: child.uid,
        indentLevel: 3,
      })
      const tail = createTab('tab-tail' as UID)
      const windowChildren =
        parentUid === child.uid
          ? [parent, child, tail]
          : [parent, child, grandchild, tail]
      const window = createWindow('window-1' as UID, windowChildren)

      Tree.moveTreeItems(
        [parent.uid],
        targetIndex,
        parentUid,
        window.uid,
        false,
      )

      expect(window.children.map((item) => item.uid)).toEqual(expectedOrder)
      for (const [uid, expectedParentUid] of Object.entries(expectedParents)) {
        expect(Tree.getItemByUid(uid as UID)?.parentUid).toBe(expectedParentUid)
      }
      for (const [uid, expectedIndent] of Object.entries(expectedIndents)) {
        expect(Tree.getItemByUid(uid as UID)?.indentLevel).toBe(expectedIndent)
      }
      expect(Tree.getItemByUid(parent.uid)?.isParent).toBe(false)
      expect(Tree.getItemByUid(parentUid)?.isParent).toBe(true)
      expectTreeInvariants()
    },
  )

  it.each([
    { label: 'including descendants', includeDescendants: true },
    { label: 'without descendants', includeDescendants: false },
  ])(
    'does not move a note onto its descendant when descendant drops are disabled $label',
    ({ includeDescendants }) => {
      Settings.values.allowDropOntoDescendantItems = false
      const parent = createNote('note-parent' as UID, { isParent: true })
      const child = createNote('note-child' as UID, {
        parentUid: parent.uid,
        indentLevel: 2,
      })
      const tail = createTab('tab-tail' as UID)
      const window = createWindow('window-1' as UID, [parent, child, tail])

      Tree.moveTreeItems(
        [parent.uid],
        2,
        child.uid,
        window.uid,
        false,
        includeDescendants,
      )

      expect(window.children.map((item) => item.uid)).toEqual([
        parent.uid,
        child.uid,
        tail.uid,
      ])
      expect(parent.parentUid).toBeUndefined()
      expect(parent.indentLevel).toBe(1)
      expect(parent.isParent).toBe(true)
      expect(child.parentUid).toBe(parent.uid)
      expect(child.indentLevel).toBe(2)
      expectTreeInvariants()
    },
  )

  it('moves an expanded note mid onto its descendant when descendants are not included', () => {
    const parent = createNote('note-parent' as UID, { isParent: true })
    const child = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const tail = createTab('tab-tail' as UID)
    const window = createWindow('window-1' as UID, [parent, child, tail])

    Tree.moveTreeItems([parent.uid], 2, child.uid, window.uid, false, false)

    expect(window.children.map((item) => item.uid)).toEqual([
      child.uid,
      parent.uid,
      tail.uid,
    ])
    expect(child.parentUid).toBeUndefined()
    expect(parent.parentUid).toBe(child.uid)
    expect(parent.indentLevel).toBe(2)
    expect(child.indentLevel).toBe(1)
    expectTreeInvariants()
  })

  it.each([
    {
      label: 'above direct child',
      targetIndex: 1,
      parentUid: 'note-source' as UID,
      expectedOrder: [
        'note-source',
        'note-child',
        'note-grandchild',
        'tab-tail',
      ],
      expectedParents: {
        'note-source': undefined,
        'note-child': 'note-source' as UID,
        'note-grandchild': 'note-child' as UID,
        'tab-tail': undefined,
      },
      expectedIndents: {
        'note-source': 1,
        'note-child': 2,
        'note-grandchild': 3,
        'tab-tail': 1,
      },
    },
    {
      label: 'mid direct child',
      targetIndex: 2,
      parentUid: 'note-child' as UID,
      expectedOrder: [
        'note-child',
        'note-source',
        'note-grandchild',
        'tab-tail',
      ],
      expectedParents: {
        'note-source': 'note-child' as UID,
        'note-child': undefined,
        'note-grandchild': 'note-child' as UID,
        'tab-tail': undefined,
      },
      expectedIndents: {
        'note-source': 2,
        'note-child': 1,
        'note-grandchild': 2,
        'tab-tail': 1,
      },
    },
    {
      label: 'below direct child',
      targetIndex: 3,
      parentUid: 'note-source' as UID,
      expectedOrder: [
        'note-source',
        'note-child',
        'note-grandchild',
        'tab-tail',
      ],
      expectedParents: {
        'note-source': undefined,
        'note-child': 'note-source' as UID,
        'note-grandchild': 'note-child' as UID,
        'tab-tail': undefined,
      },
      expectedIndents: {
        'note-source': 1,
        'note-child': 2,
        'note-grandchild': 3,
        'tab-tail': 1,
      },
    },
    {
      label: 'above nested child',
      targetIndex: 2,
      parentUid: 'note-child' as UID,
      expectedOrder: [
        'note-child',
        'note-source',
        'note-grandchild',
        'tab-tail',
      ],
      expectedParents: {
        'note-source': 'note-child' as UID,
        'note-child': undefined,
        'note-grandchild': 'note-child' as UID,
        'tab-tail': undefined,
      },
      expectedIndents: {
        'note-source': 2,
        'note-child': 1,
        'note-grandchild': 2,
        'tab-tail': 1,
      },
    },
    {
      label: 'mid nested child',
      targetIndex: 3,
      parentUid: 'note-grandchild' as UID,
      expectedOrder: [
        'note-child',
        'note-grandchild',
        'note-source',
        'tab-tail',
      ],
      expectedParents: {
        'note-source': 'note-grandchild' as UID,
        'note-child': undefined,
        'note-grandchild': 'note-child' as UID,
        'tab-tail': undefined,
      },
      expectedIndents: {
        'note-source': 3,
        'note-child': 1,
        'note-grandchild': 2,
        'tab-tail': 1,
      },
    },
    {
      label: 'below nested child',
      targetIndex: 3,
      parentUid: 'note-child' as UID,
      expectedOrder: [
        'note-child',
        'note-grandchild',
        'note-source',
        'tab-tail',
      ],
      expectedParents: {
        'note-source': 'note-child' as UID,
        'note-child': undefined,
        'note-grandchild': 'note-child' as UID,
        'tab-tail': undefined,
      },
      expectedIndents: {
        'note-source': 2,
        'note-child': 1,
        'note-grandchild': 2,
        'tab-tail': 1,
      },
    },
  ])(
    'moves a note onto its descendant without rejection when dropping $label',
    ({
      targetIndex,
      parentUid,
      expectedOrder,
      expectedParents,
      expectedIndents,
    }) => {
      const source = createNote('note-source' as UID, { isParent: true })
      const child = createNote('note-child' as UID, {
        parentUid: source.uid,
        indentLevel: 2,
        isParent: true,
      })
      const grandchild = createNote('note-grandchild' as UID, {
        parentUid: child.uid,
        indentLevel: 3,
      })
      const tail = createTab('tab-tail' as UID)
      const window = createWindow('window-1' as UID, [
        source,
        child,
        grandchild,
        tail,
      ])

      Tree.moveTreeItems(
        [source.uid],
        targetIndex,
        parentUid,
        window.uid,
        false,
      )

      expect(window.children.map((item) => item.uid)).toEqual(expectedOrder)
      for (const [uid, expectedParentUid] of Object.entries(expectedParents)) {
        expect(Tree.getItemByUid(uid as UID)?.parentUid).toBe(expectedParentUid)
      }
      for (const [uid, expectedIndent] of Object.entries(expectedIndents)) {
        expect(Tree.getItemByUid(uid as UID)?.indentLevel).toBe(expectedIndent)
      }
      expectTreeInvariants()
    },
  )

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

    Tree.moveTreeItems([sourceWindow.uid], 2, parentNote.uid, undefined, false)

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
