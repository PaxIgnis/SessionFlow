import { describe, expect, it, vi } from 'vitest'
import { Tree } from '@/services/background-tree'
import { SessionTree } from '@/services/foreground-tree'
import { State, TreeItemType, WindowChild } from '@/types/session-tree'
import {
  createNote,
  createSeparator,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { resetForegroundTree } from '../../helpers/foreground-tree-fixtures'
import { expectForegroundIndexes } from '../../helpers/foreground-invariants'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

vi.mock('@/services/runtime-port-service', () => ({
  emitTreeDelta: vi.fn(),
}))

describe('tree scale and stack safety', () => {
  it('recomputes, collapses, and mutates a 1,000-level hierarchy without overflowing the stack', () => {
    resetTree()
    const notes = Array.from({ length: 1_000 }, (_, index) => {
      const note = createNote(`deep-note-${index}` as UID, {
        parentUid: index === 0 ? undefined : (`deep-note-${index - 1}` as UID),
        indentLevel: index,
        isParent: true,
      })
      Tree.notesByUid.set(note.uid, note)
      Tree.existingUidsSet.add(note.uid)
      return note
    })
    const leafWindow = createWindow('deep-window' as UID, [], {
      parentUid: notes.at(-1)?.uid,
      indentLevel: notes.length,
    })
    Tree.Items = [...notes, leafWindow]

    expect(() => Tree.recomputeSessionTree(false)).not.toThrow()
    expect(leafWindow.indentLevel).toBe(1_000)
    expect(leafWindow.isVisible).toBe(true)

    expect(() => Tree.toggleCollapseNote(notes[0].uid)).not.toThrow()
    expect(leafWindow.isVisible).toBe(false)
    expect(() => Tree.toggleCollapseNote(notes[0].uid)).not.toThrow()
    expect(leafWindow.isVisible).toBe(true)

    Tree.removeNote(notes[998].uid)
    expect(leafWindow.parentUid).toBe(notes[999].uid)
    expectTreeInvariants()
  }, 15_000)

  it('supports a mixed 10,000-item tree through recompute, mutation, and foreground replacement', async () => {
    resetTree()
    resetForegroundTree()
    buildMixedTree(100, 99)

    expect(totalBackgroundItems()).toBe(10_000)
    Tree.recomputeSessionTree(false)
    expectTreeInvariants()

    const middleWindow = Tree.Items.filter(Tree.isWindow)[50]
    const middleNote = middleWindow.children.find(Tree.isNote)
    if (!middleNote) throw new Error('mixed scale fixture needs a note')
    await Tree.moveTreeItems(
      [middleNote.uid],
      middleWindow.children.length,
      undefined,
      middleWindow.uid,
      false,
      true,
    )
    const removableTab = middleWindow.children.find(Tree.isTab)
    if (!removableTab) throw new Error('mixed scale fixture needs a tab')
    Tree.removeTab(removableTab.uid, false)
    expectTreeInvariants()

    SessionTree.replaceSessionTree(structuredClone(Tree.Items))
    expectForegroundIndexes()
  }, 30_000)

  it('rebuilds and replaces a 25,000-item stress tree', () => {
    resetTree()
    resetForegroundTree()
    buildTabTree(250, 99)

    expect(totalBackgroundItems()).toBe(25_000)
    expect(() => Tree.recomputeSessionTree(false)).not.toThrow()
    SessionTree.replaceSessionTree(structuredClone(Tree.Items))

    expect(SessionTree.windowsByUid.size).toBe(250)
    expect(SessionTree.tabsByUid.size).toBe(24_750)
    expectForegroundIndexes()
  }, 30_000)
})

function buildMixedTree(windowCount: number, childrenPerWindow: number): void {
  for (let windowIndex = 0; windowIndex < windowCount; windowIndex++) {
    const children: WindowChild[] = []
    for (let childIndex = 0; childIndex < childrenPerWindow; childIndex++) {
      const uid = `scale-${windowIndex}-${childIndex}` as UID
      if (childIndex % 5 === 0) {
        children.push(createNote(uid, { collapsed: childIndex % 10 === 0 }))
      } else if (childIndex % 5 === 1) {
        children.push(createSeparator(uid))
      } else {
        children.push(
          createTab(uid, {
            state: childIndex % 7 === 0 ? State.DISCARDED : State.SAVED,
            pinned: childIndex < 3,
            tabGroup:
              childIndex % 10 === 0
                ? {
                    uid: `scale-group-${windowIndex}-${childIndex}` as UID,
                    id: -1,
                    color: 'blue',
                    collapsed: false,
                  }
                : undefined,
          }),
        )
      }
    }
    createWindow(`scale-window-${windowIndex}` as UID, children, {
      isParent: true,
    })
  }
}

function buildTabTree(windowCount: number, childrenPerWindow: number): void {
  for (let windowIndex = 0; windowIndex < windowCount; windowIndex++) {
    const children = Array.from({ length: childrenPerWindow }, (_, index) =>
      createTab(`stress-tab-${windowIndex}-${index}` as UID),
    )
    createWindow(`stress-window-${windowIndex}` as UID, children, {
      isParent: true,
    })
  }
}

function totalBackgroundItems(): number {
  return Tree.Items.reduce(
    (total, item) =>
      total +
      1 +
      (item.type === TreeItemType.WINDOW ? item.children.length : 0),
    0,
  )
}
