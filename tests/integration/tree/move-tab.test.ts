import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { installFakeBrowser } from '../../helpers/fake-browser'
import {
  createNote,
  createSeparator,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'
import { State } from '@/types/session-tree'

describe('moveTab', () => {
  beforeEach(() => {
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
    Settings.values.allowDropOntoDescendantItems = true
  })

  it('moves a tab under a note parent', async () => {
    const note = createNote('note-parent' as UID)
    const tab = createTab('tab-child' as UID)
    const window = createWindow('window-1' as UID, [note, tab])

    await Tree.moveTab(tab.uid, window.uid, 1, note.uid, false, false)

    const movedTab = Tree.tabsByUid.get(tab.uid)
    expect(window.children.map((item) => item.uid)).toEqual([note.uid, tab.uid])
    expect(movedTab?.parentUid).toBe(note.uid)
    expect(movedTab?.indentLevel).toBe(2)
    expect(note.isParent).toBe(true)
    expectTreeInvariants()
  })

  it('clears a moved tab parent when inserting above a root tab', async () => {
    const root = createTab('tab-root' as UID, { isParent: true })
    const child = createTab('tab-child' as UID, {
      parentUid: root.uid,
      indentLevel: 2,
    })
    const sibling = createTab('tab-sibling' as UID)
    const window = createWindow('window-1' as UID, [sibling, root, child])

    await Tree.moveTab(child.uid, window.uid, 0, undefined, false, false)

    const movedTab = Tree.tabsByUid.get(child.uid)
    expect(window.children.map((item) => item.uid)).toEqual([
      child.uid,
      sibling.uid,
      root.uid,
    ])
    expect(movedTab?.parentUid).toBeUndefined()
    expect(movedTab?.indentLevel).toBe(1)
    expect(root.isParent).toBe(false)
    expectTreeInvariants()
  })

  it('hides a tab moved under a collapsed note', async () => {
    const note = createNote('note-parent' as UID, {
      collapsed: true,
      isParent: true,
    })
    const tab = createTab('tab-child' as UID, { isVisible: true })
    const window = createWindow('window-1' as UID, [note, tab])

    await Tree.moveTab(tab.uid, window.uid, 1, note.uid, false, false)

    const movedTab = Tree.tabsByUid.get(tab.uid)
    expect(movedTab?.parentUid).toBe(note.uid)
    expect(movedTab?.isVisible).toBe(false)
    expectTreeInvariants()
  })

  it('does not move a tab when the parent uid is missing', async () => {
    const tab = createTab('tab-child' as UID)
    const window = createWindow('window-1' as UID, [tab])

    await Tree.moveTab(
      tab.uid,
      window.uid,
      0,
      'missing-parent' as UID,
      false,
      false,
    )

    expect(window.children.map((item) => item.uid)).toEqual([tab.uid])
    expect(tab.parentUid).toBeUndefined()
    expect(tab.indentLevel).toBe(1)
    expectTreeInvariants()
  })

  it('does not move a tab under a parent from another window', async () => {
    const tab = createTab('tab-child' as UID)
    const sourceWindow = createWindow('window-source' as UID, [tab])
    const otherNote = createNote('note-other' as UID)
    const targetWindow = createWindow('window-target' as UID, [otherNote])

    await Tree.moveTab(
      tab.uid,
      sourceWindow.uid,
      0,
      otherNote.uid,
      false,
      false,
    )

    expect(sourceWindow.children.map((item) => item.uid)).toEqual([tab.uid])
    expect(targetWindow.children.map((item) => item.uid)).toEqual([
      otherNote.uid,
    ])
    expect(tab.windowUid).toBe(sourceWindow.uid)
    expect(tab.parentUid).toBeUndefined()
    expectTreeInvariants()
  })
})

describe('moveTreeItems tab moves', () => {
  beforeEach(() => {
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
    Settings.values.allowDropOntoDescendantItems = true
  })

  it('moves multiple tabs in tree order to the end', async () => {
    const tabA = createTab('tab-a' as UID)
    const note = createNote('note-1' as UID)
    const tabB = createTab('tab-b' as UID)
    const tabC = createTab('tab-c' as UID)
    const window = createWindow('window-1' as UID, [tabA, note, tabB, tabC])

    await Tree.moveTreeItems(
      [tabC.uid, tabA.uid],
      window.children.length,
      undefined,
      window.uid,
      false,
      false,
    )

    expect(window.children.map((item) => item.uid)).toEqual([
      note.uid,
      tabB.uid,
      tabA.uid,
      tabC.uid,
    ])
    expect(tabA.parentUid).toBeUndefined()
    expect(tabC.parentUid).toBeUndefined()
    expectTreeInvariants()
  })

  it('maintains hierarchy when moving a parent tab and child tab together', async () => {
    const parent = createTab('tab-parent' as UID, { isParent: true })
    const child = createTab('tab-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const targetNote = createNote('note-target' as UID)
    const window = createWindow('window-1' as UID, [parent, child, targetNote])

    await Tree.moveTreeItems([parent.uid], 3, targetNote.uid, window.uid)

    expect(window.children.map((item) => item.uid)).toEqual([
      targetNote.uid,
      parent.uid,
      child.uid,
    ])
    const movedParent = Tree.tabsByUid.get(parent.uid)
    const movedChild = Tree.tabsByUid.get(child.uid)
    expect(movedParent?.parentUid).toBe(targetNote.uid)
    expect(movedParent?.indentLevel).toBe(2)
    expect(movedChild?.parentUid).toBe(parent.uid)
    expect(movedChild?.indentLevel).toBe(3)
    expect(targetNote.isParent).toBe(true)
    expectTreeInvariants()
  })

  it('keeps unpinned tabs after pinned tabs when moving near the start', async () => {
    const fakeBrowser = installFakeBrowser()
    const pinned = createTab('tab-pinned' as UID, {
      id: 10,
      pinned: true,
      state: State.OPEN,
    })
    const firstUnpinned = createTab('tab-first-unpinned' as UID, {
      id: 20,
      state: State.OPEN,
    })
    const moved = createTab('tab-moved' as UID, {
      id: 30,
      state: State.OPEN,
    })
    const window = createWindow(
      'window-1' as UID,
      [pinned, firstUnpinned, moved],
      { id: 100, state: State.OPEN },
    )
    fakeBrowser.tabs.move.mockResolvedValueOnce({ id: 30 } as browser.tabs.Tab)

    await Tree.moveTreeItems(
      [moved.uid],
      0,
      undefined,
      window.uid,
      false,
      false,
    )

    expect(window.children.map((item) => item.uid)).toEqual([
      pinned.uid,
      moved.uid,
      firstUnpinned.uid,
    ])
    expect(moved.parentUid).toBeUndefined()
    expectTreeInvariants()
  })

  it('moves tabs with note and separator descendants through one tree item move', async () => {
    const target = createTab('tab-target' as UID)
    const parent = createTab('tab-parent' as UID, {
      collapsed: true,
      isParent: true,
    })
    const childTab = createTab('tab-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
      isParent: true,
    })
    const childNote = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const childSeparator = createSeparator('separator-child' as UID, {
      parentUid: childTab.uid,
      indentLevel: 3,
    })
    const window = createWindow('window-1' as UID, [
      target,
      parent,
      childTab,
      childNote,
      childSeparator,
    ])

    await Tree.moveTreeItems(
      [parent.uid, childTab.uid, childNote.uid, childSeparator.uid],
      0,
      undefined,
      window.uid,
      false,
      true,
    )

    expect(window.children.map((item) => item.uid)).toEqual([
      parent.uid,
      childTab.uid,
      childNote.uid,
      childSeparator.uid,
      target.uid,
    ])
    const movedParent = Tree.tabsByUid.get(parent.uid)
    const movedChildTab = Tree.tabsByUid.get(childTab.uid)
    const movedNote = Tree.notesByUid.get(childNote.uid)
    const movedSeparator = Tree.separatorsByUid.get(childSeparator.uid)
    expect(movedParent?.parentUid).toBeUndefined()
    expect(movedChildTab?.parentUid).toBe(parent.uid)
    expect(movedNote?.parentUid).toBe(parent.uid)
    expect(movedSeparator?.parentUid).toBe(childTab.uid)
    expect(movedNote?.indentLevel).toBe(2)
    expect(movedSeparator?.indentLevel).toBe(3)
    expectTreeInvariants()
  })

  it('moves open tabs through the tree item move path using browser tab movement', async () => {
    const fakeBrowser = installFakeBrowser()
    const target = createTab('tab-target' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const parent = createTab('tab-parent' as UID, {
      id: 20,
      state: State.OPEN,
      collapsed: true,
      isParent: true,
    })
    const childTab = createTab('tab-child' as UID, {
      id: 30,
      state: State.OPEN,
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const childNote = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const window = createWindow(
      'window-1' as UID,
      [target, parent, childTab, childNote],
      { id: 100, state: State.OPEN },
    )
    fakeBrowser.tabs.move
      .mockResolvedValueOnce({ id: 20 } as browser.tabs.Tab)
      .mockResolvedValueOnce({ id: 30 } as browser.tabs.Tab)

    await Tree.moveTreeItems(
      [parent.uid, childTab.uid, childNote.uid],
      0,
      undefined,
      window.uid,
      false,
      true,
    )

    expect(fakeBrowser.tabs.move).toHaveBeenCalled()
    expect(window.children.map((item) => item.uid)).toEqual([
      parent.uid,
      childTab.uid,
      childNote.uid,
      target.uid,
    ])
    expect(Tree.notesByUid.get(childNote.uid)?.parentUid).toBe(parent.uid)
    expectTreeInvariants()
  })

  it('includes descendants for an open tab moved through the tree item move path', async () => {
    const fakeBrowser = installFakeBrowser()
    const target = createTab('tab-target' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const parent = createTab('tab-parent' as UID, {
      id: 20,
      state: State.OPEN,
      collapsed: true,
      isParent: true,
    })
    const childNote = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const childTab = createTab('tab-child' as UID, {
      id: 30,
      state: State.OPEN,
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const window = createWindow(
      'window-1' as UID,
      [target, parent, childNote, childTab],
      { id: 100, state: State.OPEN },
    )
    fakeBrowser.tabs.move
      .mockResolvedValueOnce({ id: 20 } as browser.tabs.Tab)
      .mockResolvedValueOnce({ id: 30 } as browser.tabs.Tab)

    await Tree.moveTreeItems(
      [parent.uid],
      0,
      undefined,
      window.uid,
      false,
      true,
    )

    expect(window.children.map((item) => item.uid)).toEqual([
      parent.uid,
      childNote.uid,
      childTab.uid,
      target.uid,
    ])
    expect(Tree.notesByUid.get(childNote.uid)?.parentUid).toBe(parent.uid)
    expect(Tree.tabsByUid.get(childTab.uid)?.parentUid).toBe(parent.uid)
    expectTreeInvariants()
  })

  it('moves an open parent tab onto the middle of its child tab through tree item moves', async () => {
    const fakeBrowser = installFakeBrowser()
    const parent = createTab('tab-parent' as UID, {
      id: 10,
      state: State.OPEN,
      isParent: true,
    })
    const child = createTab('tab-child' as UID, {
      id: 20,
      state: State.OPEN,
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [parent, child], {
      id: 100,
      state: State.OPEN,
    })
    fakeBrowser.tabs.move.mockResolvedValueOnce({ id: 10 } as browser.tabs.Tab)

    await Tree.moveTreeItems(
      [parent.uid],
      2,
      child.uid,
      window.uid,
      false,
      true,
    )

    expect(fakeBrowser.tabs.move).toHaveBeenCalledWith(10, {
      windowId: 100,
      index: 1,
    })
    expect(window.children.map((item) => item.uid)).toEqual([
      child.uid,
      parent.uid,
    ])
    const movedChild = Tree.tabsByUid.get(child.uid)
    const movedParent = Tree.tabsByUid.get(parent.uid)
    expect(movedChild?.parentUid).toBeUndefined()
    expect(movedChild?.indentLevel).toBe(1)
    expect(movedChild?.isParent).toBe(true)
    expect(movedParent?.parentUid).toBe(child.uid)
    expect(movedParent?.indentLevel).toBe(2)
    expect(movedParent?.isParent).toBe(false)
    expectTreeInvariants()
  })

  it('preserves interleaved note and tab order for open tab tree item moves', async () => {
    const fakeBrowser = installFakeBrowser()
    const target = createTab('tab-target' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const parent = createTab('tab-parent' as UID, {
      id: 20,
      state: State.OPEN,
      isParent: true,
    })
    const childNote = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const childTab = createTab('tab-child' as UID, {
      id: 30,
      state: State.OPEN,
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const window = createWindow(
      'window-1' as UID,
      [target, parent, childNote, childTab],
      { id: 100, state: State.OPEN },
    )
    fakeBrowser.tabs.move
      .mockResolvedValueOnce({ id: 20 } as browser.tabs.Tab)
      .mockResolvedValueOnce({ id: 30 } as browser.tabs.Tab)

    await Tree.moveTreeItems(
      [parent.uid, childNote.uid, childTab.uid],
      0,
      undefined,
      window.uid,
      false,
      true,
    )

    expect(window.children.map((item) => item.uid)).toEqual([
      parent.uid,
      childNote.uid,
      childTab.uid,
      target.uid,
    ])
    expect(Tree.notesByUid.get(childNote.uid)?.parentUid).toBe(parent.uid)
    expect(Tree.tabsByUid.get(childTab.uid)?.parentUid).toBe(parent.uid)
    expectTreeInvariants()
  })

  it('orders cross-window open tab tree item moves by source window order', async () => {
    const fakeBrowser = installFakeBrowser()
    const firstSourceTab = createTab('tab-first-source' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const secondSourceTab = createTab('tab-second-source' as UID, {
      id: 20,
      state: State.OPEN,
    })
    const firstWindow = createWindow('window-first' as UID, [firstSourceTab], {
      id: 100,
      state: State.OPEN,
    })
    const secondWindow = createWindow(
      'window-second' as UID,
      [secondSourceTab],
      {
        id: 200,
        state: State.OPEN,
      },
    )
    const targetWindow = createWindow('window-target' as UID, [], {
      id: 300,
      state: State.OPEN,
    })
    fakeBrowser.tabs.move
      .mockResolvedValueOnce({ id: 10 } as browser.tabs.Tab)
      .mockResolvedValueOnce({ id: 20 } as browser.tabs.Tab)

    await Tree.moveTreeItems(
      [secondSourceTab.uid, firstSourceTab.uid],
      0,
      undefined,
      targetWindow.uid,
      false,
      true,
    )

    expect(targetWindow.children.map((item) => item.uid)).toEqual([
      firstSourceTab.uid,
      secondSourceTab.uid,
    ])
    expect(firstWindow.children).toEqual([])
    expect(secondWindow.children).toEqual([])
    expectTreeInvariants()
  })

  it('moves an open tab below its descendant through tree item moves without blocking', async () => {
    const fakeBrowser = installFakeBrowser()
    const initial = createTab('tab-initial' as UID, {
      id: 10,
      state: State.OPEN,
      isParent: true,
    })
    const alpha = createTab('tab-alpha' as UID, {
      id: 20,
      state: State.OPEN,
      parentUid: initial.uid,
      indentLevel: 2,
      isParent: true,
    })
    const beta = createTab('tab-beta' as UID, {
      id: 30,
      state: State.OPEN,
      parentUid: alpha.uid,
      indentLevel: 3,
    })
    const window = createWindow('window-1' as UID, [initial, alpha, beta], {
      id: 100,
      state: State.OPEN,
    })
    fakeBrowser.tabs.move.mockResolvedValueOnce({ id: 20 } as browser.tabs.Tab)

    await Tree.moveTreeItems(
      [alpha.uid, beta.uid],
      3,
      alpha.uid,
      window.uid,
      false,
      true,
    )

    expect(fakeBrowser.tabs.move).toHaveBeenCalled()
    expect(window.children.map((item) => item.uid)).toEqual([
      initial.uid,
      beta.uid,
      alpha.uid,
    ])
    expect(initial.parentUid).toBeUndefined()
    expect(beta.parentUid).toBe(initial.uid)
    expect(alpha.parentUid).toBe(initial.uid)
    expect(beta.indentLevel).toBe(2)
    expect(alpha.indentLevel).toBe(2)
    expectTreeInvariants()
  })

  it.each([
    {
      label: 'above',
      targetIndex: 2,
      expectedOrder: ['tab-initial', 'tab-alpha', 'tab-beta'],
    },
    {
      label: 'below',
      targetIndex: 3,
      expectedOrder: ['tab-initial', 'tab-beta', 'tab-alpha'],
    },
  ])(
    'moves an open parent tab $label its direct child without included descendants',
    async ({ targetIndex, expectedOrder }) => {
      const fakeBrowser = installFakeBrowser()
      const initial = createTab('tab-initial' as UID, {
        id: 10,
        state: State.OPEN,
        isParent: true,
      })
      const alpha = createTab('tab-alpha' as UID, {
        id: 20,
        state: State.OPEN,
        parentUid: initial.uid,
        indentLevel: 2,
        isParent: true,
      })
      const beta = createTab('tab-beta' as UID, {
        id: 30,
        state: State.OPEN,
        parentUid: alpha.uid,
        indentLevel: 3,
      })
      const window = createWindow('window-1' as UID, [initial, alpha, beta], {
        id: 100,
        state: State.OPEN,
      })
      fakeBrowser.tabs.move.mockResolvedValueOnce({
        id: 20,
      } as browser.tabs.Tab)

      await Tree.moveTreeItems(
        [alpha.uid],
        targetIndex,
        alpha.uid,
        window.uid,
        false,
        false,
      )

      expect(window.children.map((item) => item.uid)).toEqual(expectedOrder)
      expect(Tree.tabsByUid.get(initial.uid)?.parentUid).toBeUndefined()
      expect(Tree.tabsByUid.get(alpha.uid)?.parentUid).toBe(initial.uid)
      expect(Tree.tabsByUid.get(beta.uid)?.parentUid).toBe(initial.uid)
      expect(Tree.tabsByUid.get(alpha.uid)?.indentLevel).toBe(2)
      expect(Tree.tabsByUid.get(beta.uid)?.indentLevel).toBe(2)
      expect(Tree.tabsByUid.get(alpha.uid)?.isParent).toBe(false)
      expectTreeInvariants()
    },
  )

  it('moves tab C below descendant tab D in the A-F regression shape when descendant drops are allowed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const tabA = createTab('tab-a' as UID, { indentLevel: 1, isParent: true })
    const tabB = createTab('tab-b' as UID, {
      parentUid: tabA.uid,
      indentLevel: 2,
      isParent: true,
    })
    const tabC = createTab('tab-c' as UID, {
      parentUid: tabB.uid,
      indentLevel: 3,
      isParent: true,
    })
    const tabD = createTab('tab-d' as UID, {
      parentUid: tabC.uid,
      indentLevel: 4,
    })
    const tabE = createTab('tab-e' as UID, {
      parentUid: tabB.uid,
      indentLevel: 3,
    })
    const tabF = createTab('tab-f' as UID, { indentLevel: 1 })
    const window = createWindow('window-1' as UID, [
      tabA,
      tabB,
      tabC,
      tabD,
      tabE,
      tabF,
    ])

    try {
      await Tree.moveTreeItems(
        [tabC.uid],
        4,
        tabC.uid,
        window.uid,
        false,
        false,
      )
      expect(consoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Cannot move tab'),
      )
    } finally {
      consoleError.mockRestore()
    }

    expect(window.children.map((item) => item.uid)).toEqual([
      tabA.uid,
      tabB.uid,
      tabD.uid,
      tabC.uid,
      tabE.uid,
      tabF.uid,
    ])
    expect(tabC.parentUid).toBe(tabB.uid)
    expect(tabC.indentLevel).toBe(3)
    expect(tabD.parentUid).toBe(tabB.uid)
    expect(tabD.indentLevel).toBe(3)
    expect(tabE.parentUid).toBe(tabB.uid)
    expect(tabE.indentLevel).toBe(3)
    expectTreeInvariants()
  })

  it('moves a tab relative to its former descendant when descendant drops are disabled', async () => {
    Settings.values.allowDropOntoDescendantItems = false
    const tabA = createTab('tab-a' as UID, { indentLevel: 1, isParent: true })
    const tabB = createTab('tab-b' as UID, {
      parentUid: tabA.uid,
      indentLevel: 2,
      isParent: true,
    })
    const tabC = createTab('tab-c' as UID, {
      parentUid: tabB.uid,
      indentLevel: 3,
      isParent: true,
    })
    const tabD = createTab('tab-d' as UID, {
      parentUid: tabC.uid,
      indentLevel: 4,
    })
    const tabE = createTab('tab-e' as UID, {
      parentUid: tabB.uid,
      indentLevel: 3,
    })
    const tabF = createTab('tab-f' as UID, { indentLevel: 1 })
    const window = createWindow('window-1' as UID, [
      tabA,
      tabB,
      tabC,
      tabD,
      tabE,
      tabF,
    ])

    await Tree.moveTreeItems([tabC.uid], 4, tabB.uid, window.uid, false, false)

    expect(window.children.map((item) => item.uid)).toEqual([
      tabA.uid,
      tabB.uid,
      tabD.uid,
      tabC.uid,
      tabE.uid,
      tabF.uid,
    ])
    expect(tabD.parentUid).toBe(tabB.uid)
    expect(tabD.indentLevel).toBe(3)
    expect(tabC.parentUid).toBe(tabB.uid)
    expect(tabC.indentLevel).toBe(3)
    expect(tabE.parentUid).toBe(tabB.uid)
    expect(tabE.indentLevel).toBe(3)
    expectTreeInvariants()
  })

  it('moves a tab relative to itself by falling back to its previous parent when descendant drops are allowed', async () => {
    Settings.values.allowDropOntoDescendantItems = true
    const tabA = createTab('tab-a' as UID, { indentLevel: 1, isParent: true })
    const tabB = createTab('tab-b' as UID, {
      parentUid: tabA.uid,
      indentLevel: 2,
      isParent: true,
    })
    const tabC = createTab('tab-c' as UID, {
      parentUid: tabB.uid,
      indentLevel: 3,
      isParent: true,
    })
    const tabD = createTab('tab-d' as UID, {
      parentUid: tabC.uid,
      indentLevel: 4,
    })
    const tabE = createTab('tab-e' as UID, {
      parentUid: tabB.uid,
      indentLevel: 3,
    })
    const window = createWindow('window-1' as UID, [
      tabA,
      tabB,
      tabC,
      tabD,
      tabE,
    ])

    await Tree.moveTab(tabC.uid, window.uid, 4, tabC.uid, false, false)

    const movedTabC = Tree.tabsByUid.get(tabC.uid)
    const movedTabD = Tree.tabsByUid.get(tabD.uid)
    expect(movedTabC).toBeDefined()
    expect(movedTabD).toBeDefined()
    expect(window.children.map((item) => item.uid)).toEqual([
      tabA.uid,
      tabB.uid,
      tabD.uid,
      tabE.uid,
      tabC.uid,
    ])
    expect(movedTabC?.parentUid).toBe(tabB.uid)
    expect(movedTabC?.indentLevel).toBe(3)
    expect(movedTabD?.parentUid).toBe(tabB.uid)
    expect(movedTabD?.indentLevel).toBe(3)
    expect(tabB.isParent).toBe(true)
    expect(movedTabC?.isParent).toBe(false)
    expectTreeInvariants()
  })

  it('promotes a remaining child to a root tab after its former parent is moved above another root tab', async () => {
    const tabA = createTab('tab-a' as UID, { indentLevel: 1, isParent: true })
    const tabB = createTab('tab-b' as UID, {
      parentUid: tabA.uid,
      indentLevel: 2,
    })
    const tabC = createTab('tab-c' as UID, {
      parentUid: tabA.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [tabA, tabB, tabC])

    await Tree.moveTreeItems([tabC.uid], 0, undefined, window.uid, false, false)
    await Tree.moveTreeItems([tabB.uid], 0, undefined, window.uid, false, false)

    const movedTabA = Tree.tabsByUid.get(tabA.uid)
    const movedTabB = Tree.tabsByUid.get(tabB.uid)
    const movedTabC = Tree.tabsByUid.get(tabC.uid)
    expect(window.children.map((item) => item.uid)).toEqual([
      tabB.uid,
      tabC.uid,
      tabA.uid,
    ])
    expect(movedTabB?.parentUid).toBeUndefined()
    expect(movedTabB?.indentLevel).toBe(1)
    expect(movedTabC?.parentUid).toBeUndefined()
    expect(movedTabC?.indentLevel).toBe(1)
    expect(movedTabA?.parentUid).toBeUndefined()
    expect(movedTabA?.indentLevel).toBe(1)
    expect(movedTabA?.isParent).toBe(false)
    expectTreeInvariants()
  })

  it.each([
    {
      label: 'above',
      targetIndex: 1,
      parentUid: 'tab-a' as UID,
      expectedOrder: ['tab-a', 'tab-b', 'tab-tail'],
      expectedParents: {
        'tab-a': undefined,
        'tab-b': undefined,
        'tab-tail': undefined,
      },
    },
    {
      label: 'mid',
      targetIndex: 2,
      parentUid: 'tab-b' as UID,
      expectedOrder: ['tab-b', 'tab-a', 'tab-tail'],
      expectedParents: {
        'tab-a': 'tab-b',
        'tab-b': undefined,
        'tab-tail': undefined,
      },
    },
    {
      label: 'below',
      targetIndex: 2,
      parentUid: 'tab-a' as UID,
      expectedOrder: ['tab-b', 'tab-a', 'tab-tail'],
      expectedParents: {
        'tab-a': undefined,
        'tab-b': undefined,
        'tab-tail': undefined,
      },
    },
  ])(
    'moves a tab $label its direct child with exact hierarchy',
    async ({ targetIndex, parentUid, expectedOrder, expectedParents }) => {
      const tabA = createTab('tab-a' as UID, {
        indentLevel: 1,
        isParent: true,
      })
      const tabB = createTab('tab-b' as UID, {
        parentUid: tabA.uid,
        indentLevel: 2,
      })
      const tail = createTab('tab-tail' as UID)
      const window = createWindow('window-1' as UID, [tabA, tabB, tail])

      await Tree.moveTreeItems(
        [tabA.uid],
        targetIndex,
        parentUid,
        window.uid,
        false,
        false,
      )

      const movedA = Tree.tabsByUid.get(tabA.uid)
      const movedB = Tree.tabsByUid.get(tabB.uid)
      const movedTail = Tree.tabsByUid.get(tail.uid)
      expect(window.children.map((item) => item.uid)).toEqual(expectedOrder)
      expect(movedA?.parentUid).toBe(expectedParents['tab-a'])
      expect(movedB?.parentUid).toBe(expectedParents['tab-b'])
      expect(movedTail?.parentUid).toBe(expectedParents['tab-tail'])
      expect(movedA?.indentLevel).toBe(expectedParents['tab-a'] ? 2 : 1)
      expect(movedB?.indentLevel).toBe(expectedParents['tab-b'] ? 2 : 1)
      expect(Boolean(movedA?.isParent)).toBe(
        expectedParents['tab-b'] === 'tab-a',
      )
      expect(Boolean(movedB?.isParent)).toBe(
        expectedParents['tab-a'] === 'tab-b',
      )
      expectTreeInvariants()
    },
  )

  it('rejects a direct self-parent move when descendant drops are disabled', async () => {
    Settings.values.allowDropOntoDescendantItems = false
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const tabA = createTab('tab-a' as UID, { indentLevel: 1, isParent: true })
    const tabB = createTab('tab-b' as UID, {
      parentUid: tabA.uid,
      indentLevel: 2,
      isParent: true,
    })
    const tabC = createTab('tab-c' as UID, {
      parentUid: tabB.uid,
      indentLevel: 3,
    })
    const window = createWindow('window-1' as UID, [tabA, tabB, tabC])

    try {
      await Tree.moveTab(tabC.uid, window.uid, 2, tabC.uid, false, false)

      expect(window.children.map((item) => item.uid)).toEqual([
        tabA.uid,
        tabB.uid,
        tabC.uid,
      ])
      expect(tabC.parentUid).toBe(tabB.uid)
      expect(tabC.indentLevel).toBe(3)
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('Cannot move tab'),
      )
    } finally {
      consoleError.mockRestore()
    }
    expectTreeInvariants()
  })

  it.each([
    {
      label: 'above direct child',
      targetIndex: 1,
      parentUid: 'tab-source' as UID,
      expectedOrder: ['tab-source', 'tab-child', 'tab-grandchild', 'tab-tail'],
      expectedParents: {
        'tab-source': undefined,
        'tab-child': undefined,
        'tab-grandchild': 'tab-child' as UID,
        'tab-tail': undefined,
      },
      expectedIndents: {
        'tab-source': 1,
        'tab-child': 1,
        'tab-grandchild': 2,
        'tab-tail': 1,
      },
    },
    {
      label: 'mid direct child',
      targetIndex: 2,
      parentUid: 'tab-child' as UID,
      expectedOrder: ['tab-child', 'tab-source', 'tab-grandchild', 'tab-tail'],
      expectedParents: {
        'tab-source': 'tab-child' as UID,
        'tab-child': undefined,
        'tab-grandchild': 'tab-child' as UID,
        'tab-tail': undefined,
      },
      expectedIndents: {
        'tab-source': 2,
        'tab-child': 1,
        'tab-grandchild': 2,
        'tab-tail': 1,
      },
    },
    {
      label: 'below direct child',
      targetIndex: 3,
      parentUid: 'tab-source' as UID,
      expectedOrder: ['tab-child', 'tab-grandchild', 'tab-source', 'tab-tail'],
      expectedParents: {
        'tab-source': undefined,
        'tab-child': undefined,
        'tab-grandchild': 'tab-child' as UID,
        'tab-tail': undefined,
      },
      expectedIndents: {
        'tab-source': 1,
        'tab-child': 1,
        'tab-grandchild': 2,
        'tab-tail': 1,
      },
    },
    {
      label: 'above nested child',
      targetIndex: 2,
      parentUid: 'tab-child' as UID,
      expectedOrder: ['tab-child', 'tab-source', 'tab-grandchild', 'tab-tail'],
      expectedParents: {
        'tab-source': 'tab-child' as UID,
        'tab-child': undefined,
        'tab-grandchild': 'tab-child' as UID,
        'tab-tail': undefined,
      },
      expectedIndents: {
        'tab-source': 2,
        'tab-child': 1,
        'tab-grandchild': 2,
        'tab-tail': 1,
      },
    },
    {
      label: 'mid nested child',
      targetIndex: 3,
      parentUid: 'tab-grandchild' as UID,
      expectedOrder: ['tab-child', 'tab-grandchild', 'tab-source', 'tab-tail'],
      expectedParents: {
        'tab-source': 'tab-grandchild' as UID,
        'tab-child': undefined,
        'tab-grandchild': 'tab-child' as UID,
        'tab-tail': undefined,
      },
      expectedIndents: {
        'tab-source': 3,
        'tab-child': 1,
        'tab-grandchild': 2,
        'tab-tail': 1,
      },
    },
    {
      label: 'below nested child',
      targetIndex: 3,
      parentUid: 'tab-child' as UID,
      expectedOrder: ['tab-child', 'tab-grandchild', 'tab-source', 'tab-tail'],
      expectedParents: {
        'tab-source': 'tab-child' as UID,
        'tab-child': undefined,
        'tab-grandchild': 'tab-child' as UID,
        'tab-tail': undefined,
      },
      expectedIndents: {
        'tab-source': 2,
        'tab-child': 1,
        'tab-grandchild': 2,
        'tab-tail': 1,
      },
    },
  ])(
    'moves a tab onto its descendant without rejection when dropping $label',
    async ({
      targetIndex,
      parentUid,
      expectedOrder,
      expectedParents,
      expectedIndents,
    }) => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      const source = createTab('tab-source' as UID, {
        indentLevel: 1,
        isParent: true,
      })
      const child = createTab('tab-child' as UID, {
        parentUid: source.uid,
        indentLevel: 2,
        isParent: true,
      })
      const grandchild = createTab('tab-grandchild' as UID, {
        parentUid: child.uid,
        indentLevel: 3,
      })
      const tail = createTab('tab-tail' as UID, { indentLevel: 1 })
      const window = createWindow('window-1' as UID, [
        source,
        child,
        grandchild,
        tail,
      ])

      try {
        await Tree.moveTreeItems(
          [source.uid],
          targetIndex,
          parentUid,
          window.uid,
          false,
          false,
        )
        expect(consoleError).not.toHaveBeenCalledWith(
          expect.stringContaining('Cannot move tab'),
        )
      } finally {
        consoleError.mockRestore()
      }

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

  it('moves a saved tab from a note child to a sibling above the note', async () => {
    const tab = createTab('tab-1' as UID)
    const window = createWindow('window-1' as UID, [tab])
    const noteUid = Tree.createNote(window.uid, undefined, 'Window note')
    const note = Tree.notesByUid.get(noteUid)
    expect(note).toBeDefined()
    if (!note) return

    await Tree.moveTreeItems([tab.uid], 1, note.uid, window.uid, false, false)
    await Tree.moveTreeItems([tab.uid], 0, undefined, window.uid, false, false)

    const movedTab = Tree.tabsByUid.get(tab.uid)
    expect(window.children.map((item) => item.uid)).toEqual([tab.uid, note.uid])
    expect(movedTab?.parentUid).toBeUndefined()
    expect(movedTab?.indentLevel).toBe(1)
    expect(note.isParent).toBe(false)
    expectTreeInvariants()
  })

  it('uses the UI drop indexes when moving a saved tab into a note and then above it', async () => {
    const tab = createTab('tab-1' as UID)
    const window = createWindow('window-1' as UID, [tab])
    const noteUid = Tree.createNote(window.uid, undefined, 'Window note')
    const note = Tree.notesByUid.get(noteUid)
    expect(note).toBeDefined()
    if (!note) return

    await Tree.moveTreeItems([tab.uid], 2, note.uid, window.uid, false, false)
    expect(window.children.map((item) => item.uid)).toEqual([note.uid, tab.uid])

    await Tree.moveTreeItems([tab.uid], 0, undefined, window.uid, false, false)

    const movedTab = Tree.tabsByUid.get(tab.uid)
    expect(window.children.map((item) => item.uid)).toEqual([tab.uid, note.uid])
    expect(movedTab?.parentUid).toBeUndefined()
    expect(movedTab?.indentLevel).toBe(1)
    expect(note.isParent).toBe(false)
    expectTreeInvariants()
  })

  it('moves a tab above a root note when the UI passes the window uid as parent', async () => {
    const note = createNote('note-1' as UID)
    const tab = createTab('tab-1' as UID)
    const window = createWindow('window-1' as UID, [note, tab])

    await Tree.moveTreeItems([tab.uid], 0, window.uid, window.uid, false, false)

    const movedTab = Tree.tabsByUid.get(tab.uid)
    expect(window.children.map((item) => item.uid)).toEqual([tab.uid, note.uid])
    expect(movedTab?.parentUid).toBeUndefined()
    expect(movedTab?.indentLevel).toBe(1)
    expectTreeInvariants()
  })
})
