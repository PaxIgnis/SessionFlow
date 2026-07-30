import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Tree } from '@/services/background-tree'
import { SessionTreeDelta } from '@/types/runtime-port-service'
import { State } from '@/types/session-tree'
import {
  createNote,
  createSeparator,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'

const emittedDeltas = vi.hoisted(() => [] as SessionTreeDelta[])

vi.mock('@/services/runtime-port-service', () => ({
  emitTreeDelta: (delta: SessionTreeDelta) => {
    emittedDeltas.push(structuredClone(delta))
  },
}))

describe('minimal sufficient tree deltas', () => {
  beforeEach(() => {
    emittedDeltas.length = 0
    resetTree()
  })

  it('emits one focused delta for a note text update', () => {
    const note = createNote('note-1' as UID)
    createWindow('window-1' as UID, [note])

    Tree.updateNoteText(note.uid, 'Updated')

    expect(emittedDeltas).toEqual([
      expect.objectContaining({ op: 'noteUpdated' }),
    ])
  })

  it('emits tabCreated only after the new tab has its computed tree fields', () => {
    const window = createWindow('window-1' as UID)

    Tree.addTab(
      true,
      window.uid,
      -1,
      false,
      State.OPEN,
      'New Tab',
      'about:newtab',
      false,
      0,
    )

    expect(emittedDeltas.map((delta) => delta.op)).toEqual(['tabCreated'])
    expect(emittedDeltas[0]).toMatchObject({
      op: 'tabCreated',
      tab: {
        indentLevel: 1,
        isVisible: true,
      },
    })
  })

  it('emits one replacement for a structural note creation', () => {
    const window = createWindow('window-1' as UID)

    Tree.createNote(window.uid)

    expect(emittedDeltas.map((delta) => delta.op)).toEqual(['treeReplaced'])
  })

  it('emits one replacement for collapsing a note hierarchy', () => {
    const parent = createNote('note-parent' as UID, { isParent: true })
    const child = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    createWindow('window-1' as UID, [parent, child])
    Tree.recomputeSessionTree(false)
    emittedDeltas.length = 0

    Tree.toggleCollapseNote(parent.uid)

    expect(emittedDeltas.map((delta) => delta.op)).toEqual(['treeReplaced'])

    emittedDeltas.length = 0
    Tree.toggleCollapseNote(parent.uid)
    expect(emittedDeltas.map((delta) => delta.op)).toEqual(['treeReplaced'])
  })

  it('emits one window snapshot when toggling a deeply nested tab', () => {
    const parent = createTab('tab-parent' as UID, { isParent: true })
    const child = createTab('tab-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
      isParent: true,
    })
    const grandchild = createNote('note-grandchild' as UID, {
      parentUid: child.uid,
      indentLevel: 3,
    })
    const window = createWindow('window-1' as UID, [
      parent,
      child,
      grandchild,
    ])
    Tree.recomputeSessionTree(false)

    Tree.toggleCollapseTab(parent.uid)

    expect(emittedDeltas).toEqual([
      {
        op: 'windowUpdated',
        window: expect.objectContaining({
          uid: window.uid,
          children: [
            expect.objectContaining({ uid: parent.uid, collapsed: true }),
            expect.objectContaining({ uid: child.uid, isVisible: false }),
            expect.objectContaining({
              uid: grandchild.uid,
              isVisible: false,
            }),
          ],
        }),
      },
    ])

    emittedDeltas.length = 0
    Tree.toggleCollapseTab(parent.uid)

    expect(emittedDeltas).toEqual([
      {
        op: 'windowUpdated',
        window: expect.objectContaining({
          uid: window.uid,
          children: [
            expect.objectContaining({ uid: parent.uid, collapsed: false }),
            expect.objectContaining({ uid: child.uid, isVisible: true }),
            expect.objectContaining({
              uid: grandchild.uid,
              isVisible: true,
            }),
          ],
        }),
      },
    ])
  })

  it('emits one replacement when expanding a top-level note hierarchy', () => {
    const parent = createNote('note-parent' as UID, {
      collapsed: true,
      indentLevel: 0,
      isParent: true,
    })
    const child = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 1,
      isVisible: false,
    })
    Tree.Items.push(parent, child)
    Tree.notesByUid.set(parent.uid, parent)
    Tree.notesByUid.set(child.uid, child)
    Tree.existingUidsSet.add(parent.uid)
    Tree.existingUidsSet.add(child.uid)
    const visibilitySpy = vi.spyOn(Tree, 'setItemChildrenVisibility')

    Tree.toggleCollapseNote(parent.uid)

    expect(child.isVisible).toBe(true)
    expect(visibilitySpy).toHaveBeenCalledWith(
      parent.uid,
      Tree.Items,
      true,
      false,
    )
    expect(emittedDeltas.map((delta) => delta.op)).toEqual(['treeReplaced'])
  })

  it('emits one replacement for a structural note removal', () => {
    const note = createNote('note-1' as UID)
    const sibling = createNote('note-sibling' as UID)
    createWindow('window-1' as UID, [note, sibling])

    Tree.removeNote(note.uid)

    expect(emittedDeltas.map((delta) => delta.op)).toEqual(['treeReplaced'])
  })

  it('emits one replacement for structural separator creation and removal', () => {
    const sibling = createNote('note-sibling' as UID)
    const window = createWindow('window-1' as UID, [sibling])

    const separatorUid = Tree.createSeparator(window.uid)
    expect(emittedDeltas.map((delta) => delta.op)).toEqual(['treeReplaced'])

    emittedDeltas.length = 0
    Tree.removeSeparator(separatorUid)
    expect(emittedDeltas.map((delta) => delta.op)).toEqual(['treeReplaced'])
  })

  it('emits no delta for missing note and separator mutations', () => {
    Tree.updateNoteText('missing-note' as UID, 'Ignored')
    Tree.removeNote('missing-note' as UID)
    Tree.removeSeparator('missing-separator' as UID)

    expect(emittedDeltas).toEqual([])
  })

  it('keeps a focused separator update sufficient', () => {
    const separator = createSeparator('separator-1' as UID)
    createWindow('window-1' as UID, [separator])

    Tree.updateSeparator(separator.uid, { isVisible: false })

    expect(emittedDeltas).toEqual([
      expect.objectContaining({ op: 'separatorUpdated' }),
    ])
  })

  it('emits one replacement when removing a nested window changes its note parent', () => {
    const parent = createNote('note-parent' as UID, {
      indentLevel: 0,
      isParent: true,
    })
    const nestedWindow = createWindow('window-nested' as UID, [], {
      parentUid: parent.uid,
      indentLevel: 1,
    })
    const sibling = createNote('note-sibling' as UID, { indentLevel: 0 })
    Tree.Items.splice(0, 0, parent)
    Tree.Items.push(sibling)
    Tree.notesByUid.set(parent.uid, parent)
    Tree.notesByUid.set(sibling.uid, sibling)
    Tree.existingUidsSet.add(parent.uid)
    Tree.existingUidsSet.add(sibling.uid)
    Tree.recomputeSessionTree(false)
    emittedDeltas.length = 0

    Tree.removeWindow(nestedWindow.uid)

    expect(parent.isParent).toBe(false)
    expect(emittedDeltas.map((delta) => delta.op)).toEqual(['treeReplaced'])
  })
})
