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

describe('state actions', () => {
  beforeEach(() => {
    resetTree()
  })

  it('saves a window and all descendant tabs without changing notes', () => {
    const tab = createTab('tab-open' as UID, {
      active: true,
      id: 10,
      state: State.OPEN,
    })
    const note = createNote('note-1' as UID, { isParent: true })
    const childTab = createTab('tab-discarded' as UID, {
      active: true,
      id: 11,
      state: State.DISCARDED,
      parentUid: note.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [tab, note, childTab], {
      active: true,
      id: 20,
      state: State.OPEN,
    })

    Tree.saveWindow(window.uid)

    expect(window.state).toBe(State.SAVED)
    expect(window.id).toBe(-1)
    expect(window.active).toBe(false)
    expect(tab.state).toBe(State.SAVED)
    expect(tab.id).toBe(-1)
    expect(tab.active).toBe(false)
    expect(childTab.state).toBe(State.SAVED)
    expect(childTab.id).toBe(-1)
    expect(childTab.active).toBe(false)
    expect(note.windowUid).toBe(window.uid)
    expect(note.parentUid).toBeUndefined()
    expectTreeInvariants()
  })

  it('closes a saved tab and saves an open window when only notes remain', () => {
    const tab = createTab('tab-saved' as UID, { id: -1, state: State.SAVED })
    const note = createNote('note-remaining' as UID)
    const window = createWindow('window-1' as UID, [tab, note], {
      id: 20,
      state: State.OPEN,
    })

    Tree.closeTab({ tabId: -1, tabUid: tab.uid })

    expect(window.children.map((item) => item.uid)).toEqual([note.uid])
    expect(Tree.tabsByUid.has(tab.uid)).toBe(false)
    expect(window.state).toBe(State.SAVED)
    expect(window.id).toBe(-1)
    expect(note.windowUid).toBe(window.uid)
    expectTreeInvariants()
  })

  it('updates tab and window state helpers', () => {
    const tab = createTab('tab-1' as UID, { state: State.OPEN })
    const window = createWindow('window-1' as UID, [tab], {
      active: true,
      activeTabId: tab.id,
      id: 20,
      state: State.OPEN,
    })

    Tree.setTabSaved(tab.uid)
    Tree.updateWindowState(window.uid, State.SAVED)

    expect(tab.state).toBe(State.SAVED)
    expect(tab.id).toBe(-1)
    expect(tab.active).toBe(false)
    expect(tab.savedTime).toEqual(expect.any(Number))
    expect(window.state).toBe(State.SAVED)
    expect(window.active).toBe(false)
    expect(window.activeTabId).toBeUndefined()
    expect(window.savedTime).toEqual(expect.any(Number))
    expectTreeInvariants()
  })

  it('pins and unpins saved tabs in the tree', () => {
    const tab = createTab('tab-1' as UID, { pinned: false })
    createWindow('window-1' as UID, [tab])

    Tree.pinTabInTree(tab.uid, false)
    expect(tab.pinned).toBe(true)

    Tree.unpinTabInTree(tab.uid, false)
    expect(tab.pinned).toBe(false)
    expectTreeInvariants()
  })
})
