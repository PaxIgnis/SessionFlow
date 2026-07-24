import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Tree } from '@/services/background-tree'
import { SessionTreeDelta } from '@/types/runtime-port-service'
import { State } from '@/types/session-tree'
import {
  createNote,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'
import { installFakeBrowser } from '../../helpers/fake-browser'

const emittedDeltas = vi.hoisted(() => [] as SessionTreeDelta[])

vi.mock('@/services/runtime-port-service', () => ({
  emitTreeDelta: (delta: SessionTreeDelta) => {
    emittedDeltas.push(structuredClone(delta))
  },
}))

describe('moveTreeItems input normalization', () => {
  beforeEach(() => {
    emittedDeltas.length = 0
    resetTree()
  })

  it('deduplicates repeated UIDs and processes every valid UID in a mixed request', async () => {
    const first = createNote('note-first' as UID)
    const second = createNote('note-second' as UID)
    const tail = createTab('tab-tail' as UID)
    const window = createWindow('window-1' as UID, [first, second, tail])

    await Tree.moveTreeItems(
      [
        'missing-before' as UID,
        first.uid,
        second.uid,
        first.uid,
        'missing-after' as UID,
      ],
      window.children.length,
      undefined,
      window.uid,
      false,
      false,
    )

    expect(window.children.map((item) => item.uid)).toEqual([
      tail.uid,
      first.uid,
      second.uid,
    ])
    expect(
      window.children.filter((item) => item.uid === first.uid),
    ).toHaveLength(1)
    expect(
      window.children.filter((item) => item.uid === second.uid),
    ).toHaveLength(1)
    expectTreeInvariants()
  })

  it('does nothing when no requested UID exists', async () => {
    const fakeBrowser = installFakeBrowser()
    const note = createNote('note-1' as UID)
    const window = createWindow('window-1' as UID, [note])
    const before = structuredClone(Tree.Items)

    await Tree.moveTreeItems(
      ['missing-1' as UID, 'missing-2' as UID, 'missing-1' as UID],
      0,
      undefined,
      window.uid,
    )

    expect(Tree.Items).toEqual(before)
    expect(fakeBrowser.tabs.move).not.toHaveBeenCalled()
    expect(fakeBrowser.windows.create).not.toHaveBeenCalled()
    expect(emittedDeltas).toEqual([])
  })

  it('does not call the browser or emit a delta for an effective same-index move', async () => {
    const fakeBrowser = installFakeBrowser()
    const first = createNote('note-first' as UID)
    const second = createTab('tab-second' as UID)
    const window = createWindow('window-1' as UID, [first, second])
    Tree.recomputeSessionTree(false)
    emittedDeltas.length = 0
    const before = structuredClone(Tree.Items)

    await Tree.moveTreeItems([first.uid], 0, undefined, window.uid, false, true)

    expect(Tree.Items).toEqual(before)
    expect(fakeBrowser.tabs.move).not.toHaveBeenCalled()
    expect(fakeBrowser.windows.create).not.toHaveBeenCalled()
    expect(emittedDeltas).toEqual([])
  })

  it('does not treat a same-index drop outside a native group as a no-op', async () => {
    const fakeBrowser = installFakeBrowser()
    const group = {
      uid: 'group-1' as UID,
      id: 7,
      color: 'blue' as const,
      collapsed: false,
    }
    const initial = createTab('tab-initial' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const moved = createTab('tab-moved' as UID, {
      id: 11,
      state: State.OPEN,
      tabGroup: structuredClone(group),
    })
    const remaining = createTab('tab-remaining' as UID, {
      id: 12,
      state: State.OPEN,
      tabGroup: structuredClone(group),
    })
    const window = createWindow(
      'window-1' as UID,
      [initial, moved, remaining],
      {
        id: 100,
        state: State.OPEN,
      },
    )

    await Tree.moveTreeItems([moved.uid], 1, undefined, window.uid, false, true)

    expect(fakeBrowser.tabs.ungroup).toHaveBeenCalledWith([moved.id])
    expect(moved.tabGroup).toBeUndefined()
    expect(remaining.tabGroup).toEqual(group)
    expectTreeInvariants()
  })

  it('preserves a saved window active-tab identity while reordering its tabs', async () => {
    const first = createTab('tab-first' as UID, { state: State.SAVED })
    const second = createTab('tab-second' as UID, { state: State.SAVED })
    const window = createWindow('window-1' as UID, [first, second], {
      savedActiveTabUid: second.uid,
    })

    await Tree.moveTreeItems(
      [second.uid],
      0,
      undefined,
      window.uid,
      false,
      true,
    )

    expect(window.children.map((item) => item.uid)).toEqual([
      second.uid,
      first.uid,
    ])
    expect(window.savedActiveTabUid).toBe(second.uid)
    expectTreeInvariants()
  })

  it('preserves an open window active-tab identity while moving its active tab', async () => {
    const fakeBrowser = installFakeBrowser()
    const active = createTab('tab-active' as UID, {
      id: 10,
      state: State.OPEN,
      active: true,
    })
    const other = createTab('tab-other' as UID, {
      id: 11,
      state: State.OPEN,
    })
    const window = createWindow('window-1' as UID, [active, other], {
      id: 100,
      state: State.OPEN,
      active: true,
      activeTabId: active.id,
    })
    fakeBrowser.tabs.move.mockResolvedValueOnce({
      id: active.id,
    } as browser.tabs.Tab)

    await Tree.moveTreeItems(
      [active.uid],
      window.children.length,
      undefined,
      window.uid,
      false,
      true,
    )

    expect(window.active).toBe(true)
    expect(window.activeTabId).toBe(active.id)
    expect(Tree.tabsByUid.get(active.uid)?.active).toBe(true)
    expectTreeInvariants()
  })
})

describe('deep top-level note and window moves', () => {
  beforeEach(() => {
    emittedDeltas.length = 0
    resetTree()
  })

  it('moves a three-level note hierarchy with its nested window and sibling order intact', async () => {
    const root = createNote('note-root' as UID, {
      indentLevel: 0,
      isParent: true,
    })
    const child = createNote('note-child' as UID, {
      parentUid: root.uid,
      indentLevel: 1,
      isParent: true,
    })
    const grandchild = createNote('note-grandchild' as UID, {
      parentUid: child.uid,
      indentLevel: 2,
      isParent: true,
    })
    const nestedWindow = createWindow('window-nested' as UID, [], {
      parentUid: grandchild.uid,
      indentLevel: 3,
    })
    const sibling = createWindow('window-sibling' as UID)
    Tree.Items.splice(0, 0, root, child, grandchild)
    for (const note of [root, child, grandchild]) {
      Tree.notesByUid.set(note.uid, note)
      Tree.existingUidsSet.add(note.uid)
    }
    Tree.recomputeSessionTree(false)
    emittedDeltas.length = 0

    await Tree.moveTreeItems(
      [root.uid],
      Tree.Items.length,
      undefined,
      undefined,
      false,
      true,
    )

    expect(Tree.Items.map((item) => item.uid)).toEqual([
      sibling.uid,
      root.uid,
      child.uid,
      grandchild.uid,
      nestedWindow.uid,
    ])
    expect(child.parentUid).toBe(root.uid)
    expect(grandchild.parentUid).toBe(child.uid)
    expect(nestedWindow.parentUid).toBe(grandchild.uid)
    expectTreeInvariants()
  })
})
