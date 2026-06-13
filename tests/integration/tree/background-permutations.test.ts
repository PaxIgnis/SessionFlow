import { beforeEach, describe, expect, it } from 'vitest'
import { Tree } from '@/services/background-tree'
import { TreeItemType } from '@/types/session-tree'
import {
  createNote,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

function addTopLevelNote(uid: UID) {
  const note = createNote(uid, { indentLevel: 0, windowUid: undefined })
  Tree.Items.push(note)
  Tree.notesByUid.set(note.uid, note)
  Tree.existingUidsSet.add(note.uid)
  return note
}

describe('background tree permutations', () => {
  beforeEach(() => {
    resetTree()
  })

  it.each([
    { label: 'top level', parent: 'top-level', index: undefined },
    { label: 'top level start', parent: 'top-level', index: 0 },
    { label: 'window root end', parent: 'window', index: undefined },
    { label: 'window root start', parent: 'window', index: 0 },
    { label: 'tab child end', parent: 'tab', index: undefined },
    { label: 'tab child start', parent: 'tab', index: 1 },
    { label: 'note child end', parent: 'note', index: undefined },
    { label: 'note child start', parent: 'note', index: 1 },
  ])('creates a note at $label', ({ parent, index }) => {
    const tab = createTab('tab-parent' as UID)
    const noteParent = createNote('note-parent' as UID)
    const window = createWindow('window-1' as UID, [tab, noteParent])
    const topLevelNote = addTopLevelNote('top-note-parent' as UID)
    const parentUid =
      parent === 'top-level'
        ? undefined
        : parent === 'window'
          ? window.uid
          : parent === 'tab'
            ? tab.uid
            : parent === 'note'
              ? noteParent.uid
              : topLevelNote.uid

    const noteUid = Tree.createNote(parentUid, index, `Created ${parent}`)
    const note = Tree.notesByUid.get(noteUid)

    expect(note).toBeDefined()
    expect(note?.text).toBe(`Created ${parent}`)
    if (parent === 'top-level') {
      expect(Tree.Items[index === 0 ? 0 : Tree.Items.length - 1].uid).toBe(
        noteUid,
      )
      expect(note?.parentUid).toBeUndefined()
      expect(note?.windowUid).toBeUndefined()
      expect(note?.indentLevel).toBe(0)
    } else if (parent === 'window') {
      expect(note?.parentUid).toBeUndefined()
      expect(note?.windowUid).toBe(window.uid)
      expect(note?.indentLevel).toBe(1)
    } else if (parent === 'tab') {
      expect(note?.parentUid).toBe(tab.uid)
      expect(note?.windowUid).toBe(window.uid)
      expect(note?.indentLevel).toBe(2)
      expect(tab.isParent).toBe(true)
    } else if (parent === 'note') {
      expect(note?.parentUid).toBe(noteParent.uid)
      expect(note?.windowUid).toBe(window.uid)
      expect(note?.indentLevel).toBe(2)
      expect(noteParent.isParent).toBe(true)
    }
    expectTreeInvariants()
  })

  it.each([
    { label: 'from tab parent with no siblings', parentType: 'tab', sibling: false },
    { label: 'from tab parent with note sibling', parentType: 'tab', sibling: true },
    { label: 'from note parent with no siblings', parentType: 'note', sibling: false },
    { label: 'from note parent with note sibling', parentType: 'note', sibling: true },
  ])('removes a tab child $label', ({ parentType, sibling }) => {
    const parent =
      parentType === 'tab'
        ? createTab('parent' as UID, { isParent: true })
        : createNote('parent' as UID, { isParent: true })
    const childTab = createTab('child-tab' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const siblingNote = createNote('sibling-note' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const children = sibling ? [parent, childTab, siblingNote] : [parent, childTab]
    const window = createWindow('window-1' as UID, children)

    Tree.removeTab(childTab.uid, false)

    expect(window.children.map((item) => item.uid)).toEqual(
      sibling ? [parent.uid, siblingNote.uid] : [parent.uid],
    )
    expect(Tree.tabsByUid.has(childTab.uid)).toBe(false)
    expect(parent.isParent).toBe(sibling)
    expectTreeInvariants()
  })

  it.each([
    { label: 'root start', targetIndex: 0, parentType: 'root' },
    { label: 'root middle', targetIndex: 1, parentType: 'root' },
    { label: 'root end', targetIndex: 3, parentType: 'root' },
    { label: 'tab parent', targetIndex: 2, parentType: 'tab' },
    { label: 'note parent', targetIndex: 2, parentType: 'note' },
  ])('moves a saved tab to $label in the same window', async ({ targetIndex, parentType }) => {
    const tabParent = createTab('tab-parent' as UID)
    const noteParent = createNote('note-parent' as UID)
    const moved = createTab('tab-moved' as UID)
    const window = createWindow('window-1' as UID, [
      tabParent,
      noteParent,
      moved,
    ])
    const parentUid =
      parentType === 'tab'
        ? tabParent.uid
        : parentType === 'note'
          ? noteParent.uid
          : undefined

    await Tree.moveTabs([moved.uid], window.uid, targetIndex, parentUid, false)

    const movedTab = Tree.tabsByUid.get(moved.uid)
    expect(movedTab?.parentUid).toBe(parentUid)
    expect(movedTab?.indentLevel).toBe(parentUid ? 2 : 1)
    if (parentType === 'tab') expect(tabParent.isParent).toBe(true)
    if (parentType === 'note') expect(noteParent.isParent).toBe(true)
    expectTreeInvariants()
  })

  it.each([
    { label: 'root start', targetIndex: 0, parentType: 'root' },
    { label: 'root end', targetIndex: 1, parentType: 'root' },
    { label: 'tab parent', targetIndex: 1, parentType: 'tab' },
    { label: 'note parent', targetIndex: 1, parentType: 'note' },
  ])('moves a saved tab across windows to $label', async ({ targetIndex, parentType }) => {
    const moved = createTab('tab-moved' as UID)
    const sourceWindow = createWindow('window-source' as UID, [moved])
    const tabParent = createTab('tab-parent' as UID)
    const noteParent = createNote('note-parent' as UID)
    const targetWindow = createWindow('window-target' as UID, [
      tabParent,
      noteParent,
    ])
    const parentUid =
      parentType === 'tab'
        ? tabParent.uid
        : parentType === 'note'
          ? noteParent.uid
          : undefined

    await Tree.moveTabs(
      [moved.uid],
      targetWindow.uid,
      targetIndex,
      parentUid,
      false,
    )

    const movedTab = Tree.tabsByUid.get(moved.uid)
    expect(Tree.windowsByUid.has(sourceWindow.uid)).toBe(false)
    expect(movedTab?.windowUid).toBe(targetWindow.uid)
    expect(movedTab?.parentUid).toBe(parentUid)
    expect(movedTab?.indentLevel).toBe(parentUid ? 2 : 1)
    expectTreeInvariants()
  })

  it.each([
    { label: 'top-level to window root', source: 'top', parent: 'window' },
    { label: 'top-level to tab parent', source: 'top', parent: 'tab' },
    { label: 'top-level to note parent', source: 'top', parent: 'note' },
    { label: 'window root to top-level', source: 'window', parent: 'top' },
    { label: 'window root to tab parent', source: 'window', parent: 'tab' },
    { label: 'window root to note parent', source: 'window', parent: 'note' },
  ])('moves a note item $label', ({ source, parent }) => {
    const moved =
      source === 'top'
        ? addTopLevelNote('note-moved' as UID)
        : createNote('note-moved' as UID)
    const tabParent = createTab('tab-parent' as UID)
    const noteParent = createNote('note-parent' as UID)
    const windowChildren =
      source === 'top' ? [tabParent, noteParent] : [moved, tabParent, noteParent]
    const window = createWindow('window-1' as UID, windowChildren)
    const parentUid =
      parent === 'top'
        ? undefined
        : parent === 'window'
          ? undefined
          : parent === 'tab'
            ? tabParent.uid
            : noteParent.uid
    const targetWindowUid = parent === 'top' ? undefined : window.uid

    Tree.moveTreeItems([moved.uid], 0, parentUid, targetWindowUid, false)

    if (parent === 'top') {
      expect(Tree.Items[0].uid).toBe(moved.uid)
      expect(moved.windowUid).toBeUndefined()
      expect(moved.parentUid).toBeUndefined()
      expect(moved.indentLevel).toBe(0)
    } else {
      expect(moved.windowUid).toBe(window.uid)
      expect(moved.parentUid).toBe(parentUid)
      expect(moved.indentLevel).toBe(parentUid ? 2 : 1)
    }
    if (parent === 'tab') expect(tabParent.isParent).toBe(true)
    if (parent === 'note') expect(noteParent.isParent).toBe(true)
    expectTreeInvariants()
  })

  it.each([
    { label: 'window under top-level note', parentType: 'top-note' },
    { label: 'top-level note under top-level note', parentType: 'top-note-note' },
    { label: 'window back to top level', parentType: 'top' },
  ])('moves top-level items: $label', ({ parentType }) => {
    const parentNote = addTopLevelNote('note-parent' as UID)
    const window = createWindow('window-1' as UID, [createTab('tab-1' as UID)])
    const movedNote = addTopLevelNote('note-moved' as UID)

    if (parentType === 'top-note') {
      Tree.moveTreeItems([window.uid], 1, parentNote.uid, undefined, false)
      expect(window.parentUid).toBe(parentNote.uid)
      expect(window.indentLevel).toBe(1)
      expect(window.children[0].windowUid).toBe(window.uid)
      expect(parentNote.isParent).toBe(true)
    } else if (parentType === 'top-note-note') {
      Tree.moveTreeItems([movedNote.uid], 1, parentNote.uid, undefined, false)
      expect(movedNote.parentUid).toBe(parentNote.uid)
      expect(movedNote.windowUid).toBeUndefined()
      expect(movedNote.indentLevel).toBe(1)
      expect(parentNote.isParent).toBe(true)
    } else {
      Tree.moveTreeItems([window.uid], 0, parentNote.uid, undefined, false)
      Tree.moveTreeItems([window.uid], 0, undefined, undefined, false)
      expect(window.parentUid).toBeUndefined()
      expect(window.indentLevel).toBe(0)
      expect(parentNote.isParent).toBe(false)
    }
    expectTreeInvariants()
  })

  it('rejects invalid note and window moves without changing the tree', () => {
    const topNote = addTopLevelNote('top-note' as UID)
    const window = createWindow('window-1' as UID, [createTab('tab-1' as UID)])
    const childNote = createNote('child-note' as UID, {
      parentUid: topNote.uid,
      indentLevel: 1,
    })
    Tree.Items.push(childNote)
    Tree.notesByUid.set(childNote.uid, childNote)
    Tree.existingUidsSet.add(childNote.uid)
    topNote.isParent = true
    const before = Tree.Items.map((item) => item.uid)

    Tree.moveTreeItems([window.children[0].uid], 0, undefined, undefined, false)
    Tree.moveTreeItems([topNote.uid], 0, childNote.uid, undefined, false)

    expect(Tree.Items.map((item) => item.uid)).toEqual(before)
    expectTreeInvariants()
  })

  it('keeps pinned tabs before unpinned tabs but allows unpinned tabs before notes', async () => {
    const note = createNote('note-1' as UID)
    const pinned = createTab('tab-pinned' as UID, { pinned: true })
    const moved = createTab('tab-moved' as UID)
    const tail = createTab('tab-tail' as UID)
    const window = createWindow('window-1' as UID, [note, pinned, tail, moved])

    await Tree.moveTabs([moved.uid], window.uid, 0, undefined, false)

    expect(window.children.map((item) => item.uid)).toEqual([
      note.uid,
      pinned.uid,
      moved.uid,
      tail.uid,
    ])
    expect(Tree.tabsByUid.get(moved.uid)?.parentUid).toBeUndefined()
    expectTreeInvariants()
  })

  it('does not allow a pinned tab to move after unpinned tabs', async () => {
    const pinned = createTab('tab-pinned' as UID, { pinned: true })
    const unpinnedA = createTab('tab-unpinned-a' as UID)
    const unpinnedB = createTab('tab-unpinned-b' as UID)
    const window = createWindow('window-1' as UID, [
      pinned,
      unpinnedA,
      unpinnedB,
    ])

    await Tree.moveTabs([pinned.uid], window.uid, 3, undefined, false)

    expect(window.children.map((item) => item.uid)).toEqual([
      pinned.uid,
      unpinnedA.uid,
      unpinnedB.uid,
    ])
    expectTreeInvariants()
  })

  it('moves mixed selected tabs and notes to the same note parent', async () => {
    const movedTab = createTab('tab-moved' as UID)
    const movedNote = createNote('note-moved' as UID)
    const parent = createNote('note-parent' as UID)
    const window = createWindow('window-1' as UID, [
      movedTab,
      movedNote,
      parent,
    ])

    await Tree.moveTabs([movedTab.uid], window.uid, 3, parent.uid, false)
    Tree.moveTreeItems([movedNote.uid], 4, parent.uid, window.uid, false)

    expect(window.children.map((item) => item.uid)).toEqual([
      parent.uid,
      movedTab.uid,
      movedNote.uid,
    ])
    expect(Tree.tabsByUid.get(movedTab.uid)?.parentUid).toBe(parent.uid)
    expect(movedNote.parentUid).toBe(parent.uid)
    expect(parent.isParent).toBe(true)
    expectTreeInvariants()
  })

  it('keeps subtree order when moving below collapsed mixed descendants', () => {
    const parent = createNote('note-parent' as UID, {
      collapsed: true,
      isParent: true,
    })
    const childTab = createTab('tab-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
      isVisible: false,
    })
    const childNote = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
      isVisible: false,
    })
    const moved = createNote('note-moved' as UID)
    const window = createWindow('window-1' as UID, [
      parent,
      childTab,
      childNote,
      moved,
    ])

    Tree.moveTreeItems([moved.uid], 3, undefined, window.uid, false)

    expect(window.children.map((item) => item.uid)).toEqual([
      parent.uid,
      childTab.uid,
      childNote.uid,
      moved.uid,
    ])
    expect(moved.parentUid).toBeUndefined()
    expectTreeInvariants()
  })

  it('does not leave stale indexes after promoting nested mixed descendants', () => {
    const parent = createNote('note-parent' as UID, { isParent: true })
    const childTab = createTab('tab-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const grandchildNote = createNote('note-grandchild' as UID, {
      parentUid: childTab.uid,
      indentLevel: 3,
    })
    const window = createWindow('window-1' as UID, [
      parent,
      childTab,
      grandchildNote,
    ])

    Tree.removeNote(parent.uid)

    expect(window.children.map((item) => item.uid)).toEqual([
      childTab.uid,
      grandchildNote.uid,
    ])
    expect(Tree.notesByUid.has(parent.uid)).toBe(false)
    expect(Tree.tabsByUid.get(childTab.uid)).toBe(childTab)
    expect(Tree.notesByUid.get(grandchildNote.uid)).toBe(grandchildNote)
    expect(Tree.windowsByUid.get(window.uid)).toBe(window)
    expect(childTab.parentUid).toBeUndefined()
    expect(childTab.indentLevel).toBe(1)
    expect(grandchildNote.parentUid).toBe(childTab.uid)
    expect(grandchildNote.indentLevel).toBe(2)
    expectTreeInvariants()
  })

  it('keeps all child item window uids when moving a window under and out of a top-level note', () => {
    const parentNote = addTopLevelNote('note-parent' as UID)
    const childTab = createTab('tab-child' as UID)
    const childNote = createNote('note-child' as UID)
    const window = createWindow('window-1' as UID, [childTab, childNote])

    Tree.moveTreeItems([window.uid], 1, parentNote.uid, undefined, false)
    Tree.moveTreeItems([window.uid], 0, undefined, undefined, false)

    expect(window.parentUid).toBeUndefined()
    expect(childTab.windowUid).toBe(window.uid)
    expect(childNote.windowUid).toBe(window.uid)
    expect(parentNote.isParent).toBe(false)
    expect(Tree.Items[0].type).toBe(TreeItemType.WINDOW)
    expectTreeInvariants()
  })

  it.each([
    { relation: 'same window', sourceParentType: 'root', destParentType: 'root' },
    { relation: 'same window', sourceParentType: 'root', destParentType: 'tab' },
    { relation: 'same window', sourceParentType: 'root', destParentType: 'note' },
    { relation: 'same window', sourceParentType: 'tab', destParentType: 'root' },
    { relation: 'same window', sourceParentType: 'tab', destParentType: 'tab' },
    { relation: 'same window', sourceParentType: 'tab', destParentType: 'note' },
    { relation: 'same window', sourceParentType: 'note', destParentType: 'root' },
    { relation: 'same window', sourceParentType: 'note', destParentType: 'tab' },
    { relation: 'same window', sourceParentType: 'note', destParentType: 'note' },
    { relation: 'different window', sourceParentType: 'root', destParentType: 'root' },
    { relation: 'different window', sourceParentType: 'root', destParentType: 'tab' },
    { relation: 'different window', sourceParentType: 'root', destParentType: 'note' },
    { relation: 'different window', sourceParentType: 'tab', destParentType: 'root' },
    { relation: 'different window', sourceParentType: 'tab', destParentType: 'tab' },
    { relation: 'different window', sourceParentType: 'tab', destParentType: 'note' },
    { relation: 'different window', sourceParentType: 'note', destParentType: 'root' },
    { relation: 'different window', sourceParentType: 'note', destParentType: 'tab' },
    { relation: 'different window', sourceParentType: 'note', destParentType: 'note' },
  ])(
    'moves a saved tab from $sourceParentType to $destParentType in $relation',
    async ({ relation, sourceParentType, destParentType }) => {
      const moved = createTab('tab-moved' as UID)
      const sourceParent =
        sourceParentType === 'tab'
          ? createTab('source-tab-parent' as UID, { isParent: true })
          : sourceParentType === 'note'
            ? createNote('source-note-parent' as UID, { isParent: true })
            : undefined
      if (sourceParent) {
        moved.parentUid = sourceParent.uid
        moved.indentLevel = 2
      }
      const sourceWindow = createWindow(
        'window-source' as UID,
        sourceParent ? [sourceParent, moved] : [moved],
      )
      const sameWindow = relation === 'same window'
      const destTabParent = createTab('dest-tab-parent' as UID)
      const destNoteParent = createNote('dest-note-parent' as UID)
      const targetWindow = sameWindow
        ? sourceWindow
        : createWindow('window-target' as UID, [destTabParent, destNoteParent])
      if (sameWindow) {
        targetWindow.children.push(destTabParent, destNoteParent)
        destTabParent.windowUid = targetWindow.uid
        destNoteParent.windowUid = targetWindow.uid
        Tree.tabsByUid.set(destTabParent.uid, destTabParent)
        Tree.notesByUid.set(destNoteParent.uid, destNoteParent)
        Tree.existingUidsSet.add(destTabParent.uid)
        Tree.existingUidsSet.add(destNoteParent.uid)
      }
      const destParentUid =
        destParentType === 'tab'
          ? destTabParent.uid
          : destParentType === 'note'
            ? destNoteParent.uid
            : undefined

      await Tree.moveTabs(
        [moved.uid],
        targetWindow.uid,
        targetWindow.children.length,
        destParentUid,
        false,
      )

      const movedTab = Tree.tabsByUid.get(moved.uid)
      expect(movedTab?.windowUid).toBe(targetWindow.uid)
      expect(movedTab?.parentUid).toBe(destParentUid)
      expect(movedTab?.indentLevel).toBe(destParentUid ? 2 : 1)
      if (!sameWindow && sourceParentType === 'root') {
        expect(Tree.windowsByUid.has(sourceWindow.uid)).toBe(false)
      }
      if (sourceParent && sourceParent.uid !== destParentUid) {
        expect(sourceParent.isParent).toBe(false)
      }
      if (destParentType === 'tab') expect(destTabParent.isParent).toBe(true)
      if (destParentType === 'note') expect(destNoteParent.isParent).toBe(true)
      expectTreeInvariants()
    },
  )

  it.each([
    { relation: 'same window', sourceParentType: 'root', destParentType: 'root' },
    { relation: 'same window', sourceParentType: 'root', destParentType: 'tab' },
    { relation: 'same window', sourceParentType: 'root', destParentType: 'note' },
    { relation: 'same window', sourceParentType: 'tab', destParentType: 'root' },
    { relation: 'same window', sourceParentType: 'tab', destParentType: 'tab' },
    { relation: 'same window', sourceParentType: 'tab', destParentType: 'note' },
    { relation: 'same window', sourceParentType: 'note', destParentType: 'root' },
    { relation: 'same window', sourceParentType: 'note', destParentType: 'tab' },
    { relation: 'same window', sourceParentType: 'note', destParentType: 'note' },
    { relation: 'different window', sourceParentType: 'root', destParentType: 'root' },
    { relation: 'different window', sourceParentType: 'root', destParentType: 'tab' },
    { relation: 'different window', sourceParentType: 'root', destParentType: 'note' },
    { relation: 'different window', sourceParentType: 'tab', destParentType: 'root' },
    { relation: 'different window', sourceParentType: 'tab', destParentType: 'tab' },
    { relation: 'different window', sourceParentType: 'tab', destParentType: 'note' },
    { relation: 'different window', sourceParentType: 'note', destParentType: 'root' },
    { relation: 'different window', sourceParentType: 'note', destParentType: 'tab' },
    { relation: 'different window', sourceParentType: 'note', destParentType: 'note' },
  ])(
    'moves a note from $sourceParentType to $destParentType in $relation',
    ({ relation, sourceParentType, destParentType }) => {
      const moved = createNote('note-moved' as UID)
      const sourceParent =
        sourceParentType === 'tab'
          ? createTab('source-tab-parent' as UID, { isParent: true })
          : sourceParentType === 'note'
            ? createNote('source-note-parent' as UID, { isParent: true })
            : undefined
      if (sourceParent) {
        moved.parentUid = sourceParent.uid
        moved.indentLevel = 2
      }
      const sourceWindow = createWindow(
        'window-source' as UID,
        sourceParent ? [sourceParent, moved] : [moved],
      )
      const sameWindow = relation === 'same window'
      const destTabParent = createTab('dest-tab-parent' as UID)
      const destNoteParent = createNote('dest-note-parent' as UID)
      const targetWindow = sameWindow
        ? sourceWindow
        : createWindow('window-target' as UID, [destTabParent, destNoteParent])
      if (sameWindow) {
        targetWindow.children.push(destTabParent, destNoteParent)
        destTabParent.windowUid = targetWindow.uid
        destNoteParent.windowUid = targetWindow.uid
        Tree.tabsByUid.set(destTabParent.uid, destTabParent)
        Tree.notesByUid.set(destNoteParent.uid, destNoteParent)
        Tree.existingUidsSet.add(destTabParent.uid)
        Tree.existingUidsSet.add(destNoteParent.uid)
      }
      const destParentUid =
        destParentType === 'tab'
          ? destTabParent.uid
          : destParentType === 'note'
            ? destNoteParent.uid
            : undefined

      Tree.moveTreeItems(
        [moved.uid],
        targetWindow.children.length,
        destParentUid,
        targetWindow.uid,
        false,
      )

      expect(moved.windowUid).toBe(targetWindow.uid)
      expect(moved.parentUid).toBe(destParentUid)
      expect(moved.indentLevel).toBe(destParentUid ? 2 : 1)
      if (!sameWindow && sourceParentType === 'root') {
        expect(Tree.windowsByUid.has(sourceWindow.uid)).toBe(false)
      }
      if (sourceParent && sourceParent.uid !== destParentUid) {
        expect(sourceParent.isParent).toBe(false)
      }
      if (destParentType === 'tab') expect(destTabParent.isParent).toBe(true)
      if (destParentType === 'note') expect(destNoteParent.isParent).toBe(true)
      expectTreeInvariants()
    },
  )
})
