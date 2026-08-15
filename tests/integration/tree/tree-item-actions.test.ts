import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import { State, Tab, TreeItemType, Window } from '@/types/session-tree'
import {
  createNote,
  createSeparator,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { installFakeBrowser } from '../../helpers/fake-browser'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

const emitTreeDelta = vi.hoisted(() => vi.fn())

vi.mock('@/services/runtime-port-service', () => ({ emitTreeDelta }))

describe('generic tree item structural actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    emitTreeDelta.mockReset()
    installFakeBrowser()
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })

  it('deletes only a selected parent and promotes its unselected child', async () => {
    const parent = createNote('parent' as UID, { isParent: true })
    const child = createTab('child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [parent, child])

    await Tree.deleteTreeItems([parent.uid])

    expect(window.children).toEqual([child])
    expect(child.parentUid).toBeUndefined()
    expect(child.indentLevel).toBe(1)
    expect(Tree.notesByUid.has(parent.uid)).toBe(false)
    expectTreeInvariants()
  })

  it('deletes an explicitly resolved parent subtree deepest first', async () => {
    const parent = createNote('parent' as UID, { isParent: true })
    const child = createTab('child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const tail = createSeparator('tail' as UID)
    const window = createWindow('window-1' as UID, [parent, child, tail])

    await Tree.deleteTreeItems([parent.uid, child.uid])

    expect(window.children).toEqual([tail])
    expect(Tree.notesByUid.has(parent.uid)).toBe(false)
    expect(Tree.tabsByUid.has(child.uid)).toBe(false)
    expectTreeInvariants()
  })

  it('closes live tabs and directly removes saved mixed items', async () => {
    const live = createTab('live' as UID, { id: 10, state: State.OPEN })
    const saved = createTab('saved' as UID, { id: -1, state: State.SAVED })
    const note = createNote('note' as UID)
    const tail = createSeparator('tail' as UID)
    const window = createWindow('window-1' as UID, [live, saved, note, tail], {
      id: 20,
      state: State.OPEN,
    })

    await Tree.deleteTreeItems([live.uid, saved.uid, note.uid])

    expect(browser.tabs.remove).toHaveBeenCalledWith(10)
    expect(window.children).toEqual([tail])
    expect(Tree.tabsByUid.has(live.uid)).toBe(false)
    expect(Tree.tabsByUid.has(saved.uid)).toBe(false)
    expect(Tree.notesByUid.has(note.uid)).toBe(false)
    expectTreeInvariants()
  })

  it('does not delete a selected window child separately', async () => {
    const tab = createTab('tab' as UID, { id: 10, state: State.OPEN })
    const window = createWindow('window-1' as UID, [tab], {
      id: 20,
      state: State.OPEN,
    })

    await Tree.deleteTreeItems([window.uid, tab.uid])

    expect(browser.windows.remove).toHaveBeenCalledWith(20)
    expect(browser.tabs.remove).not.toHaveBeenCalled()
    expect(Tree.windowsByUid.has(window.uid)).toBe(false)
    expect(Tree.tabsByUid.has(tab.uid)).toBe(false)
    expectTreeInvariants()
  })

  it('recomputes and publishes only once for a large mixed deletion batch', async () => {
    const children = Array.from({ length: 300 }, (_, index) => {
      const uid = `batch-item-${index}` as UID
      if (index % 3 === 0) return createNote(uid)
      if (index % 3 === 1) return createSeparator(uid)
      return createTab(uid, { id: -1, state: State.SAVED })
    })
    const tail = createNote('batch-tail' as UID)
    const window = createWindow('window-batch' as UID, [...children, tail])
    const recompute = vi.spyOn(Tree, 'recomputeSessionTree')
    emitTreeDelta.mockClear()

    await Tree.deleteTreeItems(children.map((item) => item.uid))

    expect(window.children).toEqual([tail])
    expect(recompute).toHaveBeenCalledTimes(1)
    expect(emitTreeDelta).toHaveBeenCalledTimes(1)
    expect(emitTreeDelta).toHaveBeenCalledWith({
      op: 'treeReplaced',
      treeItems: structuredClone(Tree.Items),
    })
    expectTreeInvariants()
  })

  it('continues deleting after one browser removal fails and reports the aggregate failure', async () => {
    const failed = createTab('tab-failed' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const deleted = createTab('tab-deleted' as UID, {
      id: 11,
      state: State.OPEN,
    })
    const tail = createNote('tail' as UID)
    const window = createWindow('window-1' as UID, [failed, deleted, tail], {
      id: 20,
      state: State.OPEN,
    })
    const error = new Error('Firefox refused to remove the first tab')
    vi.mocked(browser.tabs.remove)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const recompute = vi.spyOn(Tree, 'recomputeSessionTree')
    emitTreeDelta.mockClear()

    await expect(
      Tree.deleteTreeItems([failed.uid, deleted.uid]),
    ).rejects.toThrow('Failed to delete 1 of 2 tree items')

    expect(browser.tabs.remove).toHaveBeenNthCalledWith(1, 10)
    expect(browser.tabs.remove).toHaveBeenNthCalledWith(2, 11)
    expect(window.children).toEqual([failed, tail])
    expect(Tree.tabsByUid.has(failed.uid)).toBe(true)
    expect(Tree.tabsByUid.has(deleted.uid)).toBe(false)
    expect(consoleError).toHaveBeenCalledWith(
      `Failed to delete tree item ${failed.uid}:`,
      error,
    )
    expect(recompute).toHaveBeenCalledTimes(1)
    expect(emitTreeDelta).toHaveBeenCalledTimes(1)
    expect(emitTreeDelta).toHaveBeenCalledWith({
      op: 'treeReplaced',
      treeItems: structuredClone(Tree.Items),
    })
    expectTreeInvariants()
  })

  it('duplicates only a selected parent note after its original subtree', async () => {
    const note = createNote('note-parent' as UID, { isParent: true })
    const child = createNote('note-child' as UID, {
      parentUid: note.uid,
      indentLevel: 2,
    })
    const separator = createSeparator('separator-child' as UID, {
      parentUid: note.uid,
      indentLevel: 2,
    })
    const tail = createTab('tab-tail' as UID)
    const window = createWindow('window-1' as UID, [
      note,
      child,
      separator,
      tail,
    ])

    await Tree.duplicateTreeItems([note.uid])

    expect(window.children).toHaveLength(5)
    expect(window.children[0]).toBe(note)
    expect(window.children[1]).toBe(child)
    expect(window.children[2]).toBe(separator)
    const duplicate = window.children[3]
    expect(window.children[4]).toBe(tail)

    expect(duplicate.type).toBe(TreeItemType.NOTE)
    expect(duplicate.uid).not.toBe(note.uid)
    expect(duplicate.parentUid).toBeUndefined()
    expect(duplicate.indentLevel).toBe(1)
    expect(duplicate.isParent).toBe(false)
    expect(duplicate.collapsed).toBe(false)
    expect(child.parentUid).toBe(note.uid)
    expect(separator.parentUid).toBe(note.uid)
    expectTreeInvariants()
  })

  it('defaults to duplicating only selected rows even when subtree duplication is configured', async () => {
    Settings.values.duplicateTreeItemDescendants = 'complete-subtree'
    const parent = createNote('note-parent-default' as UID, {
      isParent: true,
      collapsed: true,
    })
    const child = createTab('tab-child-default' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const tail = createSeparator('separator-tail-default' as UID)
    const window = createWindow('window-default' as UID, [parent, child, tail])

    await Tree.duplicateTreeItems([parent.uid])

    expect(window.children).toHaveLength(4)
    expect(window.children[0]).toBe(parent)
    expect(window.children[1]).toBe(child)
    expect(window.children[2]).toMatchObject({
      type: TreeItemType.NOTE,
      isParent: false,
      collapsed: false,
    })
    expect(window.children[3]).toBe(tail)
    expectTreeInvariants()
  })

  it.each(['selected-only', 'complete-subtree'] as const)(
    'duplicates every window child when descendant scope is %s',
    async (descendantScope) => {
      Settings.values.duplicateTreeItemDescendants = descendantScope
      const note = createNote('note-parent' as UID, { isParent: true })
      const tab = createTab('tab-child' as UID, {
        parentUid: note.uid,
        indentLevel: 2,
        state: State.OPEN,
        id: 123,
      })
      const window = createWindow('window-1' as UID, [note, tab], {
        state: State.OPEN,
        id: 42,
      })

      await Tree.duplicateTreeItems([window.uid])

      expect(Tree.Items).toHaveLength(2)
      const duplicate = Tree.Items[1] as Window
      expect(duplicate.type).toBe(TreeItemType.WINDOW)
      expect(duplicate.uid).not.toBe(window.uid)
      expect(duplicate.state).toBe(State.SAVED)
      expect(duplicate.id).toBe(-1)
      expect(duplicate.children).toHaveLength(2)
      const duplicateNote = duplicate.children[0]
      const duplicateTab = duplicate.children[1] as Tab
      expect(duplicateNote.uid).not.toBe(note.uid)
      expect(duplicateTab.uid).not.toBe(tab.uid)
      expect(duplicateTab.parentUid).toBe(duplicateNote.uid)
      expect(duplicateTab.windowUid).toBe(duplicate.uid)
      expect(duplicateTab.state).toBe(State.SAVED)
      expect(duplicateTab.id).toBe(-1)
      expectTreeInvariants()
    },
  )

  it.each(['selected-only', 'complete-subtree'] as const)(
    'does not duplicate a child separately when its window is selected in %s mode',
    async (descendantScope) => {
      Settings.values.duplicateTreeItemDescendants = descendantScope
      const tab = createTab('tab-child' as UID)
      const note = createNote('note-child' as UID)
      const window = createWindow('window-1' as UID, [tab, note])

      await Tree.duplicateTreeItems([window.uid, tab.uid])

      expect(Tree.Items).toHaveLength(2)
      expect(window.children).toEqual([tab, note])
      expect((Tree.Items[1] as Window).children).toHaveLength(2)
      expectTreeInvariants()
    },
  )

  it('duplicates only a selected saved parent tab as a saved leaf', async () => {
    const tab = createTab('tab-parent' as UID, {
      isParent: true,
      state: State.SAVED,
      id: -1,
    })
    const childNote = createNote('note-child' as UID, {
      parentUid: tab.uid,
      indentLevel: 2,
    })
    const childSeparator = createSeparator('separator-child' as UID, {
      parentUid: tab.uid,
      indentLevel: 2,
    })
    const tail = createTab('tab-tail' as UID)
    const window = createWindow('window-1' as UID, [
      tab,
      childNote,
      childSeparator,
      tail,
    ])

    await Tree.duplicateTreeItems([tab.uid])

    expect(window.children).toHaveLength(5)
    expect(window.children[0]).toBe(tab)
    expect(window.children[1]).toBe(childNote)
    expect(window.children[2]).toBe(childSeparator)
    const duplicate = window.children[3] as Tab
    expect(window.children[4]).toBe(tail)

    expect(duplicate.type).toBe(TreeItemType.TAB)
    expect(duplicate.uid).not.toBe(tab.uid)
    expect(duplicate.parentUid).toBeUndefined()
    expect(duplicate.indentLevel).toBe(1)
    expect(duplicate.state).toBe(State.SAVED)
    expect(duplicate.id).toBe(-1)
    expect(duplicate.isParent).toBe(false)
    expect(duplicate.collapsed).toBe(false)
    expect(childNote.parentUid).toBe(tab.uid)
    expect(childSeparator.parentUid).toBe(tab.uid)
    expectTreeInvariants()
  })

  it('duplicates a complete saved tab subtree when requested', async () => {
    const tab = createTab('tab-parent' as UID, {
      isParent: true,
      collapsed: true,
    })
    const child = createNote('note-child' as UID, {
      parentUid: tab.uid,
      indentLevel: 2,
    })
    const tail = createTab('tab-tail' as UID)
    const window = createWindow('window-1' as UID, [tab, child, tail])

    await Tree.duplicateTreeItems([tab.uid], true)

    expect(window.children).toHaveLength(5)
    const duplicate = window.children[2] as Tab
    const duplicateChild = window.children[3]
    expect(duplicate.uid).not.toBe(tab.uid)
    expect(duplicate.isParent).toBe(true)
    expect(duplicate.collapsed).toBe(true)
    expect(duplicateChild.uid).not.toBe(child.uid)
    expect(duplicateChild.parentUid).toBe(duplicate.uid)
    expect(window.children[4]).toBe(tail)
    expectTreeInvariants()
  })

  it('duplicates explicitly selected parent and child items once each', async () => {
    const parent = createTab('tab-parent' as UID, { isParent: true })
    const child = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const tail = createTab('tab-tail' as UID)
    const window = createWindow('window-1' as UID, [parent, child, tail])

    await Tree.duplicateTreeItems([parent.uid, child.uid])

    const duplicatedItems = window.children.filter(
      (item) => item !== parent && item !== child && item !== tail,
    )
    expect(duplicatedItems).toHaveLength(2)
    expect(
      duplicatedItems.filter((item) => item.type === TreeItemType.TAB),
    ).toHaveLength(1)
    expect(
      duplicatedItems.filter((item) => item.type === TreeItemType.NOTE),
    ).toHaveLength(1)
    expect(
      (duplicatedItems.find((item) => item.type === TreeItemType.TAB) as Tab)
        .isParent,
    ).toBe(true)
    const duplicateParent = duplicatedItems.find(
      (item): item is Tab => item.type === TreeItemType.TAB,
    )!
    const duplicateChild = duplicatedItems.find(
      (item) => item.type === TreeItemType.NOTE,
    )!
    expect(duplicateChild.parentUid).toBe(duplicateParent.uid)
    expectTreeInvariants()
  })

  it('keeps context-menu resolved descendants in parent-first order', async () => {
    const parent = createTab('tab-parent' as UID, {
      isParent: true,
      collapsed: true,
    })
    const child = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
      isParent: true,
      collapsed: true,
    })
    const grandchild = createSeparator('separator-grandchild' as UID, {
      parentUid: child.uid,
      indentLevel: 3,
    })
    const tail = createTab('tab-tail' as UID)
    const window = createWindow('window-1' as UID, [
      parent,
      child,
      grandchild,
      tail,
    ])

    await Tree.duplicateTreeItems(
      [parent.uid, child.uid, grandchild.uid],
      false,
    )

    expect(window.children).toHaveLength(7)
    const clonedParent = window.children[3] as Tab
    const clonedChild = window.children[4]
    const clonedGrandchild = window.children[5]
    expect(clonedParent.type).toBe(TreeItemType.TAB)
    expect(clonedChild.type).toBe(TreeItemType.NOTE)
    expect(clonedGrandchild.type).toBe(TreeItemType.SEPARATOR)
    expect(clonedChild.parentUid).toBe(clonedParent.uid)
    expect(clonedGrandchild.parentUid).toBe(clonedChild.uid)
    expect(window.children[6]).toBe(tail)
    expectTreeInvariants()
  })

  it('duplicates a selected complete subtree only once when its descendant is also selected', async () => {
    const parent = createTab('tab-parent' as UID, { isParent: true })
    const child = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const tail = createTab('tab-tail' as UID)
    const window = createWindow('window-1' as UID, [parent, child, tail])

    await Tree.duplicateTreeItems([parent.uid, child.uid], true)

    expect(window.children).toHaveLength(5)
    const clonedParent = window.children[2] as Tab
    const clonedChild = window.children[3]
    expect(clonedParent.uid).not.toBe(parent.uid)
    expect(clonedChild.uid).not.toBe(child.uid)
    expect(clonedChild.parentUid).toBe(clonedParent.uid)
    expect(window.children.filter((item) => item !== child)).toHaveLength(4)
    expectTreeInvariants()
  })

  it('duplicates a saved grouped tab with a fresh saved group identity', async () => {
    const tabGroup = {
      uid: 'group-1' as UID,
      id: -1,
      title: 'Work',
      color: 'blue' as const,
      collapsed: true,
    }
    const tab = createTab('tab-1' as UID, {
      id: -1,
      state: State.SAVED,
      tabGroup,
    })
    const window = createWindow('window-1' as UID, [tab])

    await Tree.duplicateTreeItems([tab.uid])

    const clone = window.children[1] as Tab
    expect(clone.uid).not.toBe(tab.uid)
    expect(clone.tabGroup).toEqual({
      ...tabGroup,
      uid: expect.any(String),
      id: -1,
    })
    expect(clone.tabGroup?.uid).not.toBe(tabGroup.uid)
    expect(browser.tabs.group).not.toHaveBeenCalled()
    expectTreeInvariants()
  })

  it('duplicates each window group with one distinct fresh stable UID', async () => {
    const groupA = {
      uid: 'group-a' as UID,
      id: 10,
      title: 'Research',
      color: 'blue' as const,
      collapsed: false,
    }
    const groupB = {
      uid: 'group-b' as UID,
      id: 11,
      title: 'Personal',
      color: 'green' as const,
      collapsed: true,
    }
    const window = createWindow('window-1' as UID, [
      createTab('tab-a-1' as UID, { tabGroup: { ...groupA } }),
      createTab('tab-a-2' as UID, { tabGroup: { ...groupA } }),
      createTab('tab-b-1' as UID, { tabGroup: { ...groupB } }),
      createTab('tab-b-2' as UID, { tabGroup: { ...groupB } }),
    ])

    await Tree.duplicateTreeItems([window.uid])

    const clone = Tree.Items[1] as Window
    const clonedTabs = clone.children as Tab[]
    const clonedGroupAUid = clonedTabs[0].tabGroup?.uid
    const clonedGroupBUid = clonedTabs[2].tabGroup?.uid
    expect(clonedTabs[1].tabGroup?.uid).toBe(clonedGroupAUid)
    expect(clonedTabs[3].tabGroup?.uid).toBe(clonedGroupBUid)
    expect(clonedGroupAUid).not.toBe(groupA.uid)
    expect(clonedGroupBUid).not.toBe(groupB.uid)
    expect(clonedGroupAUid).not.toBe(clonedGroupBUid)
    expect(clonedTabs.map((tab) => tab.tabGroup?.id)).toEqual([-1, -1, -1, -1])
    expectTreeInvariants()
  })

  it('preserves private, container, and grouped metadata with independent clone identities (PD-CP-05)', async () => {
    const container = {
      cookieStoreId: 'firefox-container-private-work',
      name: 'Private Work',
      color: 'purple',
      colorCode: '#8000d7',
      icon: 'briefcase',
    }
    const group = {
      uid: 'group-private' as UID,
      id: 7,
      title: 'Private Group',
      color: 'purple' as const,
      collapsed: false,
    }
    const tab = createTab('tab-private' as UID, {
      container,
      tabGroup: group,
    })
    const window = createWindow('window-private' as UID, [tab], {
      incognito: true,
    })

    await Tree.duplicateTreeItems([window.uid])

    const clonedWindow = Tree.Items[1] as Window
    const clonedTab = clonedWindow.children[0] as Tab
    expect(clonedWindow.incognito).toBe(true)
    expect(clonedWindow.uid).not.toBe(window.uid)
    expect(clonedTab.uid).not.toBe(tab.uid)
    expect(clonedTab.windowUid).toBe(clonedWindow.uid)
    expect(clonedTab.container).toEqual(container)
    expect(clonedTab.container).not.toBe(container)
    expect(clonedTab.tabGroup).toEqual({
      ...group,
      uid: expect.any(String),
      id: -1,
    })
    expect(clonedTab.tabGroup?.uid).not.toBe(group.uid)
    expectTreeInvariants()
  })

  it('duplicates a mixed cross-window selection without mutating sources (PD-CP-02)', async () => {
    const firstTab = createTab('tab-first' as UID)
    const firstNote = createNote('note-first' as UID)
    const firstSeparator = createSeparator('separator-first' as UID)
    const firstWindow = createWindow('window-first' as UID, [
      firstTab,
      firstNote,
      firstSeparator,
    ])
    const secondTab = createTab('tab-second' as UID)
    const secondWindow = createWindow('window-second' as UID, [secondTab])
    Tree.recomputeSessionTree(false)
    const sourceSnapshot = structuredClone(Tree.Items)

    await Tree.duplicateTreeItems([firstWindow.uid, secondTab.uid])

    const clonedWindow = Tree.Items.find(
      (item): item is Window =>
        item.type === TreeItemType.WINDOW &&
        item.uid !== firstWindow.uid &&
        item.uid !== secondWindow.uid,
    )
    expect(clonedWindow?.children.map((item) => item.type)).toEqual([
      TreeItemType.TAB,
      TreeItemType.NOTE,
      TreeItemType.SEPARATOR,
    ])
    expect(secondWindow.children).toHaveLength(2)
    expect(secondWindow.children[0]).toBe(secondTab)
    expect(secondWindow.children[1].type).toBe(TreeItemType.TAB)
    expect(secondWindow.children[1].uid).not.toBe(secondTab.uid)
    expect(Tree.Items[0]).toEqual(sourceSnapshot[0])
    expect(secondWindow.children[0]).toEqual(
      (sourceSnapshot[1] as Window).children[0],
    )
    expectTreeInvariants()
  })

  it('keeps disjoint selected tabs from the same group in one cloned group', async () => {
    const tabGroup = {
      uid: 'group-1' as UID,
      id: 10,
      title: 'Work',
      color: 'blue' as const,
      collapsed: false,
    }
    const first = createTab('tab-first' as UID, { tabGroup })
    const note = createNote('note-between' as UID)
    const second = createTab('tab-second' as UID, { tabGroup })
    const window = createWindow('window-1' as UID, [first, note, second])

    await Tree.duplicateTreeItems([first.uid, second.uid])

    const clones = window.children.filter(
      (item): item is Tab =>
        item.type === TreeItemType.TAB && item !== first && item !== second,
    )
    expect(clones).toHaveLength(2)
    expect(clones[0].tabGroup?.uid).toBe(clones[1].tabGroup?.uid)
    expect(clones[0].tabGroup?.uid).not.toBe(tabGroup.uid)
    expectTreeInvariants()
  })

  it('duplicates an open tab as a saved tree item by default', async () => {
    const tab = createTab('tab-open' as UID, {
      state: State.OPEN,
      id: 123,
    })
    const window = createWindow('window-1' as UID, [tab])

    await Tree.duplicateTreeItems([tab.uid])

    expect(browser.tabs.duplicate).not.toHaveBeenCalled()
    expect(window.children).toHaveLength(2)
    expect(window.children[0]).toBe(tab)
    expect(window.children[1]).toMatchObject({
      type: TreeItemType.TAB,
      state: State.SAVED,
      id: -1,
      active: false,
    })
    expectTreeInvariants()
  })

  it('matches saved, open, and discarded tab states when configured', async () => {
    Settings.values.duplicatedItemState = 'match-original'
    const parent = createNote('note-parent' as UID, { isParent: true })
    const container = {
      cookieStoreId: 'firefox-container-work',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
    }
    const openTab = createTab('tab-open' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
      state: State.OPEN,
      active: true,
      pinned: true,
      container,
      tabGroup: {
        uid: 'group-1' as UID,
        id: 10,
        title: 'Work',
        color: 'blue',
        collapsed: false,
      },
    })
    const discardedTab = createTab('tab-discarded' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
      state: State.DISCARDED,
    })
    const savedTab = createTab('tab-saved' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
      state: State.SAVED,
    })
    const window = createWindow('window-1' as UID, [
      parent,
      openTab,
      discardedTab,
      savedTab,
    ])
    const openTabSpy = vi
      .spyOn(Tree, 'openTab')
      .mockImplementation(async ({ tabUid, discarded, active }) => {
        const tab = Tree.tabsByUid.get(tabUid)!
        tab.state = discarded ? State.DISCARDED : State.OPEN
        if (active) {
          const window = Tree.windowsByUid.get(tab.windowUid)
          window?.children.forEach((child) => {
            if (child.type === TreeItemType.TAB) child.active = false
          })
        }
        tab.active = active
      })

    await Tree.duplicateTreeItems([parent.uid], true)

    const duplicateParent = window.children[4]
    const duplicateOpen = window.children[5] as Tab
    const duplicateDiscarded = window.children[6] as Tab
    const duplicateSaved = window.children[7] as Tab
    expect(duplicateOpen.parentUid).toBe(duplicateParent.uid)
    expect(duplicateOpen.state).toBe(State.OPEN)
    expect(duplicateDiscarded.state).toBe(State.DISCARDED)
    expect(duplicateSaved.state).toBe(State.SAVED)
    expect(openTabSpy).toHaveBeenCalledTimes(2)
    expect(openTabSpy).toHaveBeenNthCalledWith(1, {
      tabUid: duplicateOpen.uid,
      windowUid: window.uid,
      url: duplicateOpen.url,
      discarded: false,
      active: true,
    })
    expect(openTabSpy).toHaveBeenNthCalledWith(2, {
      tabUid: duplicateDiscarded.uid,
      windowUid: window.uid,
      url: duplicateDiscarded.url,
      discarded: true,
      active: false,
    })
    expect(duplicateOpen.container).toEqual(container)
    expect(duplicateOpen.pinned).toBe(true)
    expect(duplicateOpen.tabGroup).toMatchObject({
      id: -1,
      title: 'Work',
      color: 'blue',
    })
    expect(duplicateOpen.tabGroup?.uid).not.toBe(openTab.tabGroup?.uid)
    expectTreeInvariants()
  })

  it('opens a duplicated window active tab before discarded siblings', async () => {
    Settings.values.duplicatedItemState = 'match-original'
    const discardedTab = createTab('tab-discarded' as UID, {
      state: State.DISCARDED,
    })
    const activeTab = createTab('tab-active' as UID, {
      state: State.OPEN,
      active: true,
    })
    const savedTab = createTab('tab-saved' as UID, { state: State.SAVED })
    const window = createWindow(
      'window-1' as UID,
      [discardedTab, activeTab, savedTab],
      {
        state: State.OPEN,
        savedActiveTabUid: activeTab.uid,
      },
    )
    const openTabSpy = vi
      .spyOn(Tree, 'openTab')
      .mockImplementation(async ({ tabUid, discarded }) => {
        Tree.tabsByUid.get(tabUid)!.state = discarded
          ? State.DISCARDED
          : State.OPEN
      })

    await Tree.duplicateTreeItems([window.uid])

    const duplicateWindow = Tree.Items[1] as Window
    const duplicateDiscarded = duplicateWindow.children[0] as Tab
    const duplicateActive = duplicateWindow.children[1] as Tab
    expect(duplicateWindow.children).toHaveLength(3)
    expect(duplicateWindow.savedActiveTabUid).toBe(duplicateActive.uid)
    expect(openTabSpy).toHaveBeenCalledTimes(2)
    expect(openTabSpy.mock.calls[0][0]).toMatchObject({
      tabUid: duplicateActive.uid,
      discarded: false,
      active: true,
    })
    expect(openTabSpy.mock.calls[1][0]).toMatchObject({
      tabUid: duplicateDiscarded.uid,
      discarded: true,
      active: false,
    })
  })

  it('continues matching remaining states before reporting an open failure', async () => {
    Settings.values.duplicatedItemState = 'match-original'
    const parent = createNote('note-parent' as UID, { isParent: true })
    const first = createTab('tab-first' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
      state: State.OPEN,
    })
    const second = createTab('tab-second' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
      state: State.DISCARDED,
    })
    createWindow('window-1' as UID, [parent, first, second])
    const error = new Error('could not create tab')
    const openTabSpy = vi
      .spyOn(Tree, 'openTab')
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined)

    await expect(Tree.duplicateTreeItems([parent.uid], true)).rejects.toBe(
      error,
    )

    expect(openTabSpy).toHaveBeenCalledTimes(2)
  })

  it('keeps every failed clone saved and leaves all sources unchanged after multiple failures (PD-CP-06)', async () => {
    Settings.values.duplicatedItemState = 'match-original'
    const first = createTab('tab-first' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const second = createTab('tab-second' as UID, {
      id: 11,
      state: State.OPEN,
    })
    const window = createWindow('window-1' as UID, [first, second], {
      id: 20,
      state: State.OPEN,
    })
    const firstError = new Error('first clone failed')
    const openTabSpy = vi
      .spyOn(Tree, 'openTab')
      .mockRejectedValueOnce(firstError)
      .mockRejectedValueOnce(new Error('second clone failed'))

    await expect(Tree.duplicateTreeItems([first.uid, second.uid])).rejects.toBe(
      firstError,
    )

    expect(openTabSpy).toHaveBeenCalledTimes(2)
    expect(
      window.children.filter((item) => item === first || item === second),
    ).toEqual([first, second])
    expect(first).toMatchObject({ id: 10, state: State.OPEN })
    expect(second).toMatchObject({ id: 11, state: State.OPEN })
    expect(
      window.children.filter((item) => item !== first && item !== second),
    ).toEqual([
      expect.objectContaining({ id: -1, state: State.SAVED }),
      expect.objectContaining({ id: -1, state: State.SAVED }),
    ])
    expectTreeInvariants()
  })

  it('leaves dependent discarded window clones saved when window creation fails', async () => {
    Settings.values.duplicatedItemState = 'match-original'
    const activeTab = createTab('tab-active' as UID, {
      state: State.OPEN,
      active: true,
    })
    const discardedTab = createTab('tab-discarded' as UID, {
      state: State.DISCARDED,
    })
    const window = createWindow('window-1' as UID, [activeTab, discardedTab], {
      state: State.OPEN,
    })
    const error = new Error('could not create window')
    const openTabSpy = vi.spyOn(Tree, 'openTab').mockRejectedValue(error)

    await expect(Tree.duplicateTreeItems([window.uid])).rejects.toBe(error)

    const duplicateWindow = Tree.Items[1] as Window
    expect(openTabSpy).toHaveBeenCalledTimes(1)
    expect((duplicateWindow.children[0] as Tab).state).toBe(State.SAVED)
    expect((duplicateWindow.children[1] as Tab).state).toBe(State.SAVED)
  })

  it('tries a later open tab when the first duplicated window tab fails', async () => {
    Settings.values.duplicatedItemState = 'match-original'
    const activeTab = createTab('tab-active' as UID, {
      state: State.OPEN,
      active: true,
    })
    const openTab = createTab('tab-open' as UID, { state: State.OPEN })
    const discardedTab = createTab('tab-discarded' as UID, {
      state: State.DISCARDED,
    })
    const window = createWindow(
      'window-1' as UID,
      [activeTab, openTab, discardedTab],
      { state: State.OPEN },
    )
    const error = new Error('active tab could not create window')
    const openTabSpy = vi
      .spyOn(Tree, 'openTab')
      .mockRejectedValueOnce(error)
      .mockImplementation(async ({ tabUid, discarded }) => {
        Tree.tabsByUid.get(tabUid)!.state = discarded
          ? State.DISCARDED
          : State.OPEN
      })

    await expect(Tree.duplicateTreeItems([window.uid])).rejects.toBe(error)

    const duplicateWindow = Tree.Items[1] as Window
    expect(openTabSpy).toHaveBeenCalledTimes(3)
    expect(openTabSpy.mock.calls.map(([message]) => message.tabUid)).toEqual(
      duplicateWindow.children.map((tab) => tab.uid),
    )
    expect((duplicateWindow.children[0] as Tab).state).toBe(State.SAVED)
    expect((duplicateWindow.children[1] as Tab).state).toBe(State.OPEN)
    expect((duplicateWindow.children[2] as Tab).state).toBe(State.DISCARDED)
  })

  it('rolls a partially opened clone back to saved after a post-open failure', async () => {
    Settings.values.duplicatedItemState = 'match-original'
    const source = createTab('tab-source' as UID, { state: State.OPEN })
    const window = createWindow('window-1' as UID, [source], {
      state: State.OPEN,
    })
    const error = new Error('could not restore tab group')
    vi.spyOn(Tree, 'openTab').mockImplementationOnce(async ({ tabUid }) => {
      const clone = Tree.tabsByUid.get(tabUid)!
      clone.state = State.OPEN
      clone.id = 999
      throw error
    })

    await expect(Tree.duplicateTreeItems([source.uid])).rejects.toBe(error)

    const clone = window.children[1] as Tab
    expect(clone).toMatchObject({ state: State.SAVED, id: -1, active: false })
    expect(browser.tabs.remove).toHaveBeenCalledWith(999)
  })

  it('reports a no-op open and leaves its clone saved', async () => {
    Settings.values.duplicatedItemState = 'match-original'
    const source = createTab('tab-source' as UID, { state: State.OPEN })
    const window = createWindow('window-1' as UID, [source], {
      state: State.OPEN,
    })
    vi.spyOn(Tree, 'openTab').mockResolvedValue(undefined)

    await expect(Tree.duplicateTreeItems([source.uid])).rejects.toThrow(
      'did not match its original state',
    )

    expect(window.children[1]).toMatchObject({ state: State.SAVED, id: -1 })
  })

  it('preserves container metadata in the direct saved-tab duplicate branch', () => {
    const container = {
      cookieStoreId: 'firefox-container-work',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
    }
    const tab = createTab('tab-saved' as UID, {
      state: State.SAVED,
      id: -1,
      container,
    })
    const window = createWindow('window-1' as UID, [tab])

    Tree.duplicateTab({ tabId: tab.id, tabUid: tab.uid })

    expect(window.children).toHaveLength(2)
    const duplicate = window.children[1] as Tab
    expect(duplicate.container).toEqual(container)
    expect(duplicate.container).not.toBe(container)
  })

  it('increases and decreases a note indent using adjacent structural siblings', () => {
    const parent = createTab('tab-parent' as UID)
    const note = createNote('note-child' as UID)
    const window = createWindow('window-1' as UID, [parent, note])

    Tree.treeItemIndentIncrease([note.uid])

    expect(window.children.map((item) => item.uid)).toEqual([
      parent.uid,
      note.uid,
    ])
    expect(note.parentUid).toBe(parent.uid)
    expect(note.indentLevel).toBe(2)
    expect(parent.isParent).toBe(true)

    Tree.treeItemIndentDecrease([note.uid])

    expect(note.parentUid).toBeUndefined()
    expect(note.indentLevel).toBe(1)
    expect(parent.isParent).toBe(false)
    expectTreeInvariants()
  })

  it('increases and decreases a top-level window indent under a note', () => {
    const parent = createNote('note-parent' as UID, {
      indentLevel: 0,
      windowUid: undefined,
    })
    const tab = createTab('tab-child' as UID)
    const window = createWindow('window-1' as UID, [tab])
    Tree.Items.splice(0, 0, parent)
    Tree.notesByUid.set(parent.uid, parent)
    Tree.existingUidsSet.add(parent.uid)

    Tree.treeItemIndentIncrease([window.uid])

    expect(Tree.Items.map((item) => item.uid)).toEqual([parent.uid, window.uid])
    expect(window.parentUid).toBe(parent.uid)
    expect(window.indentLevel).toBe(1)
    expect(tab.windowUid).toBe(window.uid)
    expect(parent.isParent).toBe(true)

    Tree.treeItemIndentDecrease([window.uid])

    expect(window.parentUid).toBeUndefined()
    expect(window.indentLevel).toBe(0)
    expect(parent.isParent).toBe(false)
    expectTreeInvariants()
  })

  it('decreases a tab indent by moving its full subtree after the old parent subtree', () => {
    const parentTab = createTab('tab-parent' as UID, { isParent: true })
    const movedTab = createTab('tab-moved' as UID, {
      parentUid: parentTab.uid,
      indentLevel: 2,
      isParent: true,
    })
    const movedChild = createTab('tab-moved-child' as UID, {
      parentUid: movedTab.uid,
      indentLevel: 3,
    })
    const remainingTab = createTab('tab-remaining' as UID, {
      parentUid: parentTab.uid,
      indentLevel: 2,
    })
    const remainingNote = createNote('note-remaining' as UID, {
      parentUid: parentTab.uid,
      indentLevel: 2,
    })
    const remainingSeparator = createSeparator('separator-remaining' as UID, {
      parentUid: parentTab.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [
      parentTab,
      movedTab,
      movedChild,
      remainingTab,
      remainingNote,
      remainingSeparator,
    ])

    Tree.treeItemIndentDecrease([movedTab.uid])

    expect(window.children.map((item) => item.uid)).toEqual([
      parentTab.uid,
      remainingTab.uid,
      remainingNote.uid,
      remainingSeparator.uid,
      movedTab.uid,
      movedChild.uid,
    ])
    expect(parentTab.isParent).toBe(true)
    expect(remainingTab.parentUid).toBe(parentTab.uid)
    expect(remainingNote.parentUid).toBe(parentTab.uid)
    expect(remainingSeparator.parentUid).toBe(parentTab.uid)
    expect(movedTab.parentUid).toBeUndefined()
    expect(movedTab.indentLevel).toBe(1)
    expect(movedTab.isParent).toBe(true)
    expect(movedChild.parentUid).toBe(movedTab.uid)
    expect(movedChild.indentLevel).toBe(2)
    expectTreeInvariants()
  })

  it('decreases a nested tab indent to become a sibling of its parent under a note', () => {
    const noteParent = createNote('note-parent' as UID, { isParent: true })
    const parentTab = createTab('tab-parent' as UID, {
      parentUid: noteParent.uid,
      indentLevel: 2,
      isParent: true,
    })
    const movedTab = createTab('tab-moved' as UID, {
      parentUid: parentTab.uid,
      indentLevel: 3,
      isParent: true,
    })
    const movedChild = createSeparator('separator-moved-child' as UID, {
      parentUid: movedTab.uid,
      indentLevel: 4,
    })
    const remainingTab = createTab('tab-remaining' as UID, {
      parentUid: parentTab.uid,
      indentLevel: 3,
    })
    const window = createWindow('window-1' as UID, [
      noteParent,
      parentTab,
      movedTab,
      movedChild,
      remainingTab,
    ])

    Tree.treeItemIndentDecrease([movedTab.uid])

    expect(window.children.map((item) => item.uid)).toEqual([
      noteParent.uid,
      parentTab.uid,
      remainingTab.uid,
      movedTab.uid,
      movedChild.uid,
    ])
    expect(noteParent.isParent).toBe(true)
    expect(parentTab.isParent).toBe(true)
    expect(remainingTab.parentUid).toBe(parentTab.uid)
    expect(remainingTab.indentLevel).toBe(3)
    expect(movedTab.parentUid).toBe(noteParent.uid)
    expect(movedTab.indentLevel).toBe(2)
    expect(movedChild.parentUid).toBe(movedTab.uid)
    expect(movedChild.indentLevel).toBe(3)
    expectTreeInvariants()
  })

  it.each([
    {
      setting: 'always',
      collapsed: false,
      expectedChildParent: 'selected',
    },
    {
      setting: 'collapsed',
      collapsed: true,
      expectedChildParent: 'selected',
    },
    {
      setting: 'collapsed',
      collapsed: false,
      expectedChildParent: 'old-parent',
    },
    {
      setting: 'never',
      collapsed: true,
      expectedChildParent: 'old-parent',
    },
  ] as const)(
    'uses $setting setting with collapsed=$collapsed when increasing indent',
    ({ setting, collapsed, expectedChildParent }) => {
      Settings.values.includeChildrenOfSelectedItemsWhenIndenting = setting
      const oldParent = createTab('tab-old-parent' as UID, { isParent: true })
      const newParent = createTab('tab-new-parent' as UID, {
        parentUid: oldParent.uid,
        indentLevel: 2,
      })
      const movedTab = createTab('tab-moved' as UID, {
        parentUid: oldParent.uid,
        indentLevel: 2,
        isParent: true,
        collapsed,
      })
      const childNote = createNote('note-child' as UID, {
        parentUid: movedTab.uid,
        indentLevel: 3,
      })
      const window = createWindow('window-1' as UID, [
        oldParent,
        newParent,
        movedTab,
        childNote,
      ])

      Tree.treeItemIndentIncrease([movedTab.uid])

      expect(window.children.map((item) => item.uid)).toEqual([
        oldParent.uid,
        newParent.uid,
        movedTab.uid,
        childNote.uid,
      ])
      expect(movedTab.parentUid).toBe(newParent.uid)
      expect(movedTab.indentLevel).toBe(3)
      if (expectedChildParent === 'selected') {
        expect(movedTab.isParent).toBe(true)
        expect(childNote.parentUid).toBe(movedTab.uid)
        expect(childNote.indentLevel).toBe(4)
        expect(oldParent.isParent).toBe(true)
      } else {
        expect(movedTab.isParent).toBe(false)
        expect(childNote.parentUid).toBe(oldParent.uid)
        expect(childNote.indentLevel).toBe(2)
        expect(oldParent.isParent).toBe(true)
      }
      expectTreeInvariants()
    },
  )

  it('waits for async tree item movement when increasing indent', async () => {
    Settings.values.includeChildrenOfSelectedItemsWhenIndenting = 'never'
    const parent = createTab('tab-parent' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const movedTab = createTab('tab-moved' as UID, {
      id: 20,
      state: State.OPEN,
    })
    const window = createWindow('window-1' as UID, [parent, movedTab], {
      id: 100,
      state: State.OPEN,
    })
    let resolveMove: () => void = () => {}
    const moveTreeItems = vi.spyOn(Tree, 'moveTreeItems').mockReturnValue(
      new Promise<void>((resolve) => {
        resolveMove = resolve
      }),
    )

    let resolved = false
    const indentPromise = Promise.resolve(
      Tree.treeItemIndentIncrease([movedTab.uid]),
    ).then(() => {
      resolved = true
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(moveTreeItems).toHaveBeenCalledWith(
      [movedTab.uid],
      1,
      parent.uid,
      window.uid,
      false,
      false,
    )
    expect(resolved).toBe(false)

    resolveMove()
    await indentPromise

    expect(resolved).toBe(true)
  })

  it.each([
    {
      setting: 'always',
      collapsed: false,
      expectedChildParent: 'selected',
    },
    {
      setting: 'collapsed',
      collapsed: true,
      expectedChildParent: 'selected',
    },
    {
      setting: 'collapsed',
      collapsed: false,
      expectedChildParent: 'old-parent',
    },
    {
      setting: 'never',
      collapsed: true,
      expectedChildParent: 'old-parent',
    },
  ] as const)(
    'uses $setting setting with collapsed=$collapsed when decreasing indent',
    ({ setting, collapsed, expectedChildParent }) => {
      Settings.values.includeChildrenOfSelectedItemsWhenIndenting = setting
      const oldParent = createTab('tab-old-parent' as UID, { isParent: true })
      const movedTab = createTab('tab-moved' as UID, {
        parentUid: oldParent.uid,
        indentLevel: 2,
        isParent: true,
        collapsed,
      })
      const childNote = createNote('note-child' as UID, {
        parentUid: movedTab.uid,
        indentLevel: 3,
      })
      const remainingTab = createTab('tab-remaining' as UID, {
        parentUid: oldParent.uid,
        indentLevel: 2,
      })
      const window = createWindow('window-1' as UID, [
        oldParent,
        movedTab,
        childNote,
        remainingTab,
      ])

      Tree.treeItemIndentDecrease([movedTab.uid])

      if (expectedChildParent === 'selected') {
        expect(window.children.map((item) => item.uid)).toEqual([
          oldParent.uid,
          remainingTab.uid,
          movedTab.uid,
          childNote.uid,
        ])
        expect(movedTab.isParent).toBe(true)
        expect(childNote.parentUid).toBe(movedTab.uid)
        expect(childNote.indentLevel).toBe(2)
      } else {
        expect(window.children.map((item) => item.uid)).toEqual([
          oldParent.uid,
          childNote.uid,
          remainingTab.uid,
          movedTab.uid,
        ])
        expect(movedTab.isParent).toBe(false)
        expect(childNote.parentUid).toBe(oldParent.uid)
        expect(childNote.indentLevel).toBe(2)
      }
      expect(movedTab.parentUid).toBeUndefined()
      expect(movedTab.indentLevel).toBe(1)
      expect(oldParent.isParent).toBe(true)
      expectTreeInvariants()
    },
  )

  it.each([
    {
      setting: 'collapsed',
      collapsed: true,
      expectedChildParent: 'selected',
    },
    {
      setting: 'collapsed',
      collapsed: false,
      expectedChildParent: 'old-parent',
    },
    {
      setting: 'never',
      collapsed: true,
      expectedChildParent: 'old-parent',
    },
  ] as const)(
    'uses $setting setting with collapsed=$collapsed when decreasing note indent',
    ({ setting, collapsed, expectedChildParent }) => {
      Settings.values.includeChildrenOfSelectedItemsWhenIndenting = setting
      const oldParent = createNote('note-old-parent' as UID, { isParent: true })
      const movedNote = createNote('note-moved' as UID, {
        parentUid: oldParent.uid,
        indentLevel: 2,
        isParent: true,
        collapsed,
      })
      const childSeparator = createSeparator('separator-child' as UID, {
        parentUid: movedNote.uid,
        indentLevel: 3,
      })
      const remainingTab = createTab('tab-remaining' as UID, {
        parentUid: oldParent.uid,
        indentLevel: 2,
      })
      const window = createWindow('window-1' as UID, [
        oldParent,
        movedNote,
        childSeparator,
        remainingTab,
      ])

      Tree.treeItemIndentDecrease([movedNote.uid])

      if (expectedChildParent === 'selected') {
        expect(window.children.map((item) => item.uid)).toEqual([
          oldParent.uid,
          remainingTab.uid,
          movedNote.uid,
          childSeparator.uid,
        ])
        expect(movedNote.isParent).toBe(true)
        expect(childSeparator.parentUid).toBe(movedNote.uid)
        expect(childSeparator.indentLevel).toBe(2)
      } else {
        expect(window.children.map((item) => item.uid)).toEqual([
          oldParent.uid,
          childSeparator.uid,
          remainingTab.uid,
          movedNote.uid,
        ])
        expect(movedNote.isParent).toBe(false)
        expect(childSeparator.parentUid).toBe(oldParent.uid)
        expect(childSeparator.indentLevel).toBe(2)
      }
      expect(movedNote.parentUid).toBeUndefined()
      expect(movedNote.indentLevel).toBe(1)
      expect(oldParent.isParent).toBe(true)
      expectTreeInvariants()
    },
  )
})
