import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY } from '@/defaults/constants'
import { Tree } from '@/services/background-tree'
import {
  Note,
  State,
  TopLevelTreeItem,
  TreeItemType,
  Window,
} from '@/types/session-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import { resetTree } from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

describe('storage load note-heavy trees', () => {
  beforeEach(() => {
    installFakeBrowser()
    resetTree()
  })

  it('loads top-level notes with child windows and rebuilds indexes after startup recompute', async () => {
    const note = makeStoredNote('note-root' as UID, {
      indentLevel: 0,
      isParent: true,
      windowUid: 'stale-window' as UID,
    })
    const childWindow = makeStoredWindow({
      uid: 'window-child' as UID,
      parentUid: note.uid,
      indentLevel: 1,
      children: [
        makeStoredTab({
          uid: 'tab-child' as UID,
          windowUid: 'stale-window' as UID,
          indentLevel: 2,
        }),
      ],
    })
    mockStoredTree([note, childWindow])

    await Tree.loadSessionTreeFromStorage()
    Tree.recomputeSessionTree(false)

    expect(Tree.Items.map((item) => item.uid)).toEqual([
      note.uid,
      childWindow.uid,
    ])
    expect(Tree.notesByUid.get(note.uid)?.windowUid).toBeUndefined()
    expect(Tree.windowsByUid.get(childWindow.uid)?.parentUid).toBe(note.uid)
    expect(Tree.tabsByUid.get('tab-child' as UID)?.windowUid).toBe(
      childWindow.uid,
    )
    expectTreeInvariants()
  })

  it('normalizes selected and live fields for notes and descendant tabs inside saved windows', async () => {
    const window = makeStoredWindow({
      uid: 'window-1' as UID,
      selected: true,
      active: true,
      activeTabId: 10,
      state: State.OPEN,
      children: [
        makeStoredNote('note-parent' as UID, {
          selected: true,
          isParent: true,
          windowUid: 'stale-window' as UID,
        }),
        makeStoredTab({
          uid: 'tab-child' as UID,
          active: true,
          id: 10,
          selected: true,
          state: State.OPEN,
          parentUid: 'note-parent' as UID,
          windowUid: 'stale-window' as UID,
          indentLevel: 2,
        }),
      ],
    })
    mockStoredTree([window])

    await Tree.loadSessionTreeFromStorage()
    Tree.recomputeSessionTree(false)

    const loadedWindow = Tree.windowsByUid.get(window.uid)!
    const loadedNote = Tree.notesByUid.get('note-parent' as UID)!
    const loadedTab = Tree.tabsByUid.get('tab-child' as UID)!
    expect(loadedWindow.selected).toBe(false)
    expect(loadedWindow.active).toBe(false)
    expect(loadedWindow.activeTabId).toBeUndefined()
    expect(loadedNote.selected).toBe(false)
    expect(loadedNote.windowUid).toBe(loadedWindow.uid)
    expect(loadedTab.selected).toBe(false)
    expect(loadedTab.active).toBe(false)
    expect(loadedTab.id).toBe(0)
    expect(loadedTab.state).toBe(State.SAVED)
    expect(loadedTab.windowUid).toBe(loadedWindow.uid)
    expectTreeInvariants()
  })
})

function mockStoredTree(treeItems: TopLevelTreeItem[]): void {
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    [STORAGE_KEY]: structuredClone(treeItems),
  })
}

function makeStoredWindow(overrides: Partial<Window>): Window {
  return {
    type: TreeItemType.WINDOW,
    uid: 'window-1' as UID,
    active: false,
    activeTabId: undefined,
    id: 1,
    selected: false,
    state: State.SAVED,
    children: [],
    indentLevel: 0,
    ...overrides,
  }
}

function makeStoredTab(
  overrides: Partial<Window['children'][number]>,
): Window['children'][number] {
  return {
    type: TreeItemType.TAB,
    uid: 'tab-1' as UID,
    active: false,
    id: 1,
    selected: false,
    state: State.SAVED,
    title: 'Tab',
    url: 'https://example.test',
    windowUid: 'window-1' as UID,
    indentLevel: 1,
    pinned: false,
    ...overrides,
  } as Window['children'][number]
}

function makeStoredNote(
  uid: UID,
  overrides: Partial<Note> = {},
): Note {
  return {
    type: TreeItemType.NOTE,
    uid,
    text: uid,
    selected: false,
    windowUid: undefined,
    collapsed: false,
    indentLevel: 1,
    ...overrides,
  }
}
