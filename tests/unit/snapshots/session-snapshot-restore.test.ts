import { beforeEach, describe, expect, it } from 'vitest'
import { Tree } from '@/services/background-tree'
import { captureSessionSnapshot } from '@/services/session-snapshot-codec'
import { projectSnapshotForRestore } from '@/services/session-snapshot-restore'
import { State, TreeItemType } from '@/types/session-tree'
import {
  createNote,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'

describe('session snapshot restore projection', () => {
  beforeEach(() => resetTree())

  it('restores a complete snapshot as saved clones with new UIDs', async () => {
    const tab = createTab('tab-1' as UID, {
      active: true,
      id: 10,
      state: State.OPEN,
    })
    const window = createWindow('window-1' as UID, [tab], {
      active: true,
      activeTabId: tab.id,
      id: 20,
      state: State.OPEN,
    })
    const payload = (
      await captureSessionSnapshot(Tree.Items, {
        includePrivateWindows: true,
      })
    ).payload
    resetTree()

    const result = projectSnapshotForRestore({
      payload,
      mode: 'all',
      selectedUids: new Set(),
      existingUids: new Set([window.uid, tab.uid]),
    })

    expect(result.items).toHaveLength(1)
    const restoredWindow = result.items[0]
    expect(restoredWindow.type).toBe(TreeItemType.WINDOW)
    if (restoredWindow.type !== TreeItemType.WINDOW) return
    expect(restoredWindow.uid).not.toBe(window.uid)
    expect(restoredWindow).toMatchObject({
      active: false,
      activeTabId: undefined,
      id: -1,
      selected: false,
      state: State.SAVED,
    })
    expect(restoredWindow.children[0]).toMatchObject({
      active: false,
      id: -1,
      selected: false,
      state: State.SAVED,
      windowUid: restoredWindow.uid,
    })
  })

  it('does not restore a selected window when its children are not selected', async () => {
    const first = createTab('tab-1' as UID)
    const second = createTab('tab-2' as UID)
    const window = createWindow('window-1' as UID, [first, second])
    const payload = (
      await captureSessionSnapshot(Tree.Items, {
        includePrivateWindows: true,
      })
    ).payload

    const result = projectSession(payload, [window.uid])

    expect(result.items).toEqual([])
  })

  it('preserves a fully selected nested window under its selected parent', async () => {
    const parent = createNote('note-1' as UID, {
      indentLevel: 0,
      isParent: true,
    })
    Tree.Items.push(parent)
    const first = createTab('tab-1' as UID, { indentLevel: 2 })
    const second = createTab('tab-2' as UID, { indentLevel: 2 })
    const window = createWindow('window-1' as UID, [first, second], {
      indentLevel: 1,
      parentUid: parent.uid,
    })
    const payload = (
      await captureSessionSnapshot(Tree.Items, {
        includePrivateWindows: true,
      })
    ).payload

    const result = projectSession(payload, [parent.uid, first.uid, second.uid])
    const restoredParent = result.items.find(
      (item) => item.type === TreeItemType.NOTE,
    )
    const restoredWindow = result.items.find(
      (item) => item.type === TreeItemType.WINDOW,
    )

    expect(restoredParent).toBeDefined()
    expect(restoredWindow).toMatchObject({
      parentUid: restoredParent?.uid,
      indentLevel: (restoredParent?.indentLevel ?? 0) + 1,
      children: [{ title: first.title }, { title: second.title }],
    })
  })

  it('reconnects selected descendants to their nearest selected ancestor', async () => {
    const a = createTab('tab-a' as UID, { indentLevel: 1 })
    const b = createTab('tab-b' as UID, {
      indentLevel: 2,
      parentUid: a.uid,
    })
    const c = createTab('tab-c' as UID, {
      indentLevel: 3,
      parentUid: b.uid,
    })
    createWindow('window-1' as UID, [a, b, c])
    const payload = (
      await captureSessionSnapshot(Tree.Items, {
        includePrivateWindows: true,
      })
    ).payload

    const result = projectSession(payload, [a.uid, c.uid])
    const window = result.items[0]
    if (window.type !== TreeItemType.WINDOW) throw new Error('Expected window')
    const [restoredA, restoredC] = window.children

    expect(
      window.children.map((item) =>
        item.type === TreeItemType.TAB ? item.title : undefined,
      ),
    ).toEqual([a.title, c.title])
    expect(restoredA.indentLevel).toBe(1)
    expect(restoredC).toMatchObject({
      parentUid: restoredA.uid,
      indentLevel: 2,
    })
  })

  it('makes a selected child root in a minimal source-window wrapper', async () => {
    const a = createTab('tab-a' as UID, { indentLevel: 1 })
    const c = createTab('tab-c' as UID, {
      indentLevel: 2,
      parentUid: a.uid,
    })
    const sourceWindow = createWindow('window-1' as UID, [a, c], {
      title: 'Source window',
    })
    const payload = (
      await captureSessionSnapshot(Tree.Items, {
        includePrivateWindows: true,
      })
    ).payload

    const result = projectSession(payload, [c.uid])
    const window = result.items[0]
    if (window.type !== TreeItemType.WINDOW) throw new Error('Expected window')

    expect(window.title).toBe(sourceWindow.title)
    expect(window.children).toHaveLength(1)
    expect(window.children[0]).toMatchObject({
      title: c.title,
      indentLevel: 1,
      parentUid: undefined,
    })
  })
})

function projectSession(
  payload: Awaited<ReturnType<typeof captureSessionSnapshot>>['payload'],
  selectedUids: UID[],
) {
  return projectSnapshotForRestore({
    payload,
    mode: 'selected',
    selectedUids: new Set(selectedUids),
    existingUids: new Set(),
  })
}
