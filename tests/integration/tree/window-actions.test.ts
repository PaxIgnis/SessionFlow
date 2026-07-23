import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import { State, Window } from '@/types/session-tree'
import { flushMicrotasks, installFakeBrowser } from '../../helpers/fake-browser'
import {
  createNote,
  createSeparator,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

const settingsDefaults = { ...DEFAULT_SETTINGS }

describe('window actions', () => {
  beforeEach(() => {
    installFakeBrowser()
    resetTree()
    OnCreatedQueue.pendingWindowCount = 0
    OnCreatedQueue.pendingTabCount = 0
    OnCreatedQueue.pendingWindows = new Map()
    OnCreatedQueue.pendingTabs = new Map()
    Object.assign(Settings.values, settingsDefaults)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('records private identity when Firefox creates a private window', async () => {
    vi.mocked(browser.windows.get).mockResolvedValue({
      id: 20,
      alwaysOnTop: false,
      incognito: true,
      focused: false,
      tabs: [],
    } as browser.windows.Window)

    await Tree.addWindow(20)

    const window = Tree.Items.find(Tree.isWindow)
    expect(window).toMatchObject({
      id: 20,
      incognito: true,
      state: State.OPEN,
    })
    expectTreeInvariants()
  })

  it('saves a window and descendant tabs while preserving notes and indexes', () => {
    const rootTab = createTab('tab-root' as UID, {
      active: true,
      id: 10,
      state: State.OPEN,
    })
    const note = createNote('note-1' as UID, {
      collapsed: true,
      isParent: true,
      text: 'keep this note',
    })
    const childTab = createTab('tab-child' as UID, {
      active: true,
      id: 11,
      isVisible: false,
      state: State.DISCARDED,
      parentUid: note.uid,
      indentLevel: 2,
    })
    const childNote = createNote('note-child' as UID, {
      isVisible: false,
      parentUid: note.uid,
      indentLevel: 2,
      text: 'keep this child note',
    })
    const window = createWindow(
      'window-1' as UID,
      [rootTab, note, childTab, childNote],
      {
        active: true,
        activeTabId: rootTab.id,
        id: 20,
        state: State.OPEN,
      },
    )

    Tree.saveWindow(window.uid)

    expect(window.state).toBe(State.SAVED)
    expect(window.id).toBe(-1)
    expect(window.active).toBe(false)
    expect(window.activeTabId).toBeUndefined()
    expect(window.savedActiveTabUid).toBe(rootTab.uid)
    expect(rootTab.state).toBe(State.SAVED)
    expect(rootTab.id).toBe(-1)
    expect(rootTab.active).toBe(false)
    expect(childTab.state).toBe(State.SAVED)
    expect(childTab.id).toBe(-1)
    expect(childTab.active).toBe(false)
    expect(note.text).toBe('keep this note')
    expect(note.collapsed).toBe(true)
    expect(note.windowUid).toBe(window.uid)
    expect(childNote.text).toBe('keep this child note')
    expect(childNote.parentUid).toBe(note.uid)
    expectTreeInvariants()
  })

  it('toggles window collapse while respecting collapsed child subtrees', () => {
    const rootTab = createTab('tab-root' as UID)
    const collapsedNote = createNote('note-parent' as UID, {
      collapsed: true,
      isParent: true,
    })
    const noteChild = createTab('tab-note-child' as UID, {
      parentUid: collapsedNote.uid,
      indentLevel: 2,
    })
    const collapsedTab = createTab('tab-parent' as UID, {
      collapsed: true,
      isParent: true,
    })
    const tabChild = createNote('note-tab-child' as UID, {
      parentUid: collapsedTab.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [
      rootTab,
      collapsedNote,
      noteChild,
      collapsedTab,
      tabChild,
    ])
    Tree.recomputeSessionTree(false)

    expect(rootTab.isVisible).toBe(true)
    expect(collapsedNote.isVisible).toBe(true)
    expect(noteChild.isVisible).toBe(false)
    expect(collapsedTab.isVisible).toBe(true)
    expect(tabChild.isVisible).toBe(false)

    Tree.toggleCollapseWindow(window.uid)

    expect(window.collapsed).toBe(true)
    expect(rootTab.isVisible).toBe(false)
    expect(collapsedNote.isVisible).toBe(false)
    expect(noteChild.isVisible).toBe(false)
    expect(collapsedTab.isVisible).toBe(false)
    expect(tabChild.isVisible).toBe(false)
    expectTreeInvariants()

    Tree.toggleCollapseWindow(window.uid)

    expect(window.collapsed).toBe(false)
    expect(rootTab.isVisible).toBe(true)
    expect(collapsedNote.isVisible).toBe(true)
    expect(noteChild.isVisible).toBe(false)
    expect(collapsedTab.isVisible).toBe(true)
    expect(tabChild.isVisible).toBe(false)
    expectTreeInvariants()
  })

  it('sets the active window and clears the previously active window', () => {
    const previous = createWindow('window-1' as UID, [], {
      active: true,
      id: 10,
    })
    const next = createWindow('window-2' as UID, [], {
      active: false,
      id: 20,
    })

    Tree.setActiveWindow(next.id)

    expect(previous.active).toBe(false)
    expect(next.active).toBe(true)
    expectTreeInvariants()
  })

  it('retries setting the active window when the window is not yet indexed', () => {
    vi.useFakeTimers()
    try {
      Tree.setActiveWindow(20, 1)

      const window = createWindow('window-1' as UID, [], {
        active: false,
        id: 20,
      })
      vi.advanceTimersByTime(100)

      expect(window.active).toBe(true)
      expectTreeInvariants()
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves the last active window while an unknown focus target retries (EV-26)', () => {
    vi.useFakeTimers()
    try {
      const active = createWindow('window-active' as UID, [], {
        active: true,
        id: 10,
      })

      Tree.setActiveWindow(999, 1)
      expect(active.active).toBe(true)

      vi.advanceTimersByTime(100)
      expect(active.active).toBe(true)
      expectTreeInvariants()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores invalid and session tree window ids when setting the active window', () => {
    const active = createWindow('window-1' as UID, [], {
      active: true,
      id: 10,
    })
    const sessionTreeWindow = createWindow('window-session-tree' as UID, [], {
      active: false,
      id: 20,
    })
    Tree.sessionTreeWindowId = sessionTreeWindow.id

    Tree.setActiveWindow(-1)
    expect(active.active).toBe(true)
    expect(sessionTreeWindow.active).toBe(false)

    Tree.setActiveWindow(sessionTreeWindow.id)
    expect(active.active).toBe(true)
    expect(sessionTreeWindow.active).toBe(false)
    expectTreeInvariants()
  })

  it('removes mixed tab and note descendants from indexes when removing a window', () => {
    const tab = createTab('tab-1' as UID)
    const note = createNote('note-1' as UID)
    const childNote = createNote('note-child' as UID, {
      parentUid: note.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [tab, note, childNote])

    Tree.removeWindow(window.uid)

    expect(Tree.Items).toEqual([])
    expect(Tree.windowsByUid.has(window.uid)).toBe(false)
    expect(Tree.tabsByUid.has(tab.uid)).toBe(false)
    expect(Tree.notesByUid.has(note.uid)).toBe(false)
    expect(Tree.notesByUid.has(childNote.uid)).toBe(false)
    expect(Tree.existingUidsSet.has(window.uid)).toBe(false)
    expect(Tree.existingUidsSet.has(tab.uid)).toBe(false)
    expect(Tree.existingUidsSet.has(note.uid)).toBe(false)
    expect(Tree.existingUidsSet.has(childNote.uid)).toBe(false)
    expectTreeInvariants()
  })

  it('moves windows to the requested top-level index', () => {
    const first = createWindow('window-1' as UID)
    const second = createWindow('window-2' as UID)
    const third = createWindow('window-3' as UID)

    Tree.moveWindows([first.uid], 3, false)

    expect(Tree.Items.map((item) => item.uid)).toEqual([
      second.uid,
      third.uid,
      first.uid,
    ])
    expectTreeInvariants()
  })

  it('moves multiple windows in tree order and clamps invalid target indexes to the end', () => {
    const first = createWindow('window-1' as UID)
    const second = createWindow('window-2' as UID)
    const third = createWindow('window-3' as UID)
    const fourth = createWindow('window-4' as UID)

    Tree.moveWindows([third.uid, first.uid], -1, false)

    expect(Tree.Items.map((item) => item.uid)).toEqual([
      second.uid,
      fourth.uid,
      first.uid,
      third.uid,
    ])
    expectTreeInvariants()
  })

  it('copies windows with fresh saved identities through moveWindows', () => {
    const tab = createTab('tab-open' as UID, {
      id: 11,
      state: State.OPEN,
    })
    const source = createWindow('window-source' as UID, [tab], {
      id: 10,
      incognito: true,
      state: State.OPEN,
    })

    Tree.moveWindows([source.uid], 1, true)

    expect(Tree.Items).toHaveLength(2)
    expect(Tree.Items[0]).toBe(source)
    const copy = Tree.Items[1] as Window
    expect(copy.uid).not.toBe(source.uid)
    expect(copy.id).toBe(-1)
    expect(copy.incognito).toBe(true)
    expect(copy.state).toBe(State.SAVED)
    expect(copy.children[0].uid).not.toBe(tab.uid)
    expect(copy.children[0]).toMatchObject({
      id: -1,
      state: State.SAVED,
      windowUid: copy.uid,
    })
    expectTreeInvariants()
  })

  it('removes an open tree window after the browser window closes', async () => {
    const tab = createTab('tab-1' as UID, { id: 10, state: State.OPEN })
    const note = createNote('note-1' as UID)
    const window = createWindow('window-1' as UID, [tab, note], {
      id: 20,
      state: State.OPEN,
    })
    let resolveRemove: () => void = () => {}
    const removeSettled = new Promise<void>((resolve) => {
      resolveRemove = resolve
    })
    vi.mocked(browser.windows.remove).mockReturnValue(removeSettled)

    const command = Tree.closeWindow({
      windowId: window.id,
      windowUid: window.uid,
    })

    expect(Tree.windowsByUid.get(window.uid)).toBe(window)
    expect(browser.windows.remove).toHaveBeenCalledWith(window.id)
    resolveRemove()
    await command

    expect(Tree.Items).toEqual([])
    expect(Tree.windowsByUid.has(window.uid)).toBe(false)
    expect(Tree.tabsByUid.has(tab.uid)).toBe(false)
    expect(Tree.notesByUid.has(note.uid)).toBe(false)
    expect(Tree.existingUidsSet.has(window.uid)).toBe(false)
    expect(Tree.existingUidsSet.has(tab.uid)).toBe(false)
    expect(Tree.existingUidsSet.has(note.uid)).toBe(false)
    expectTreeInvariants()
  })

  it('commits close when the browser window is already gone', async () => {
    const tab = createTab('tab-1' as UID, { id: 10, state: State.OPEN })
    const window = createWindow('window-1' as UID, [tab], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.windows.remove).mockRejectedValue(
      new Error('Invalid window ID: 20'),
    )
    vi.mocked(browser.windows.get).mockRejectedValue(
      new Error('Invalid window ID: 20'),
    )

    await Tree.closeWindow({ windowId: window.id, windowUid: window.uid })

    expect(Tree.windowsByUid.has(window.uid)).toBe(false)
    expect(Tree.tabsByUid.has(tab.uid)).toBe(false)
    expect(browser.windows.remove).toHaveBeenCalledWith(window.id)
    expectTreeInvariants()
  })

  it('saves a window and clears active tab state before removing the browser window', async () => {
    const activeTab = createTab('tab-active' as UID, {
      active: true,
      id: 10,
      state: State.OPEN,
    })
    const inactiveTab = createTab('tab-inactive' as UID, {
      active: false,
      id: 11,
      state: State.DISCARDED,
    })
    const window = createWindow('window-1' as UID, [activeTab, inactiveTab], {
      active: true,
      activeTabId: activeTab.id,
      id: 20,
      state: State.OPEN,
    })

    await Tree.saveAndRemoveWindow({
      windowId: window.id,
      windowUid: window.uid,
    })

    expect(window.state).toBe(State.SAVED)
    expect(window.id).toBe(-1)
    expect(window.active).toBe(false)
    expect(window.activeTabId).toBeUndefined()
    expect(activeTab.state).toBe(State.SAVED)
    expect(activeTab.id).toBe(-1)
    expect(activeTab.active).toBe(false)
    expect(inactiveTab.state).toBe(State.SAVED)
    expect(inactiveTab.id).toBe(-1)
    expect(inactiveTab.active).toBe(false)
    await vi.waitFor(() => {
      expect(browser.windows.remove).toHaveBeenCalledWith(20)
    })
    expectTreeInvariants()
  })

  it('keeps a window open when browser removal fails', async () => {
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
    const removeError = new Error('remove failed')
    vi.mocked(browser.windows.remove).mockRejectedValue(removeError)
    vi.mocked(browser.windows.get).mockResolvedValue({
      id: window.id,
    } as browser.windows.Window)

    await expect(
      Tree.saveAndRemoveWindow({
        windowId: window.id,
        windowUid: window.uid,
      }),
    ).rejects.toBe(removeError)

    expect(window.state).toBe(State.OPEN)
    expect(window.id).toBe(20)
    expect(tab.state).toBe(State.OPEN)
    expect(tab.id).toBe(10)
    expectTreeInvariants()
  })

  it('opens a saved window with tab URLs, assigns browser ids, and pins saved pinned tabs', async () => {
    Settings.values.openWindowWithTabsDiscarded = false
    Settings.values.openWindowsInSameLocation = false
    const firstTab = createTab('tab-first' as UID, {
      id: -1,
      pinned: true,
      state: State.SAVED,
      url: 'https://example.test/first',
    })
    const secondTab = createTab('tab-second' as UID, {
      id: -1,
      pinned: false,
      state: State.SAVED,
      url: 'https://example.test/second',
    })
    const window = createWindow('window-1' as UID, [firstTab, secondTab], {
      id: -1,
      incognito: true,
      state: State.SAVED,
    })
    vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockResolvedValue({
      id: 30,
      tabs: [{ id: 101 }],
    } as browser.windows.Window)
    vi.spyOn(OnCreatedQueue, 'createTabAndWait').mockResolvedValue({
      id: 102,
      windowId: 30,
      index: 1,
      active: false,
      discarded: false,
      pinned: false,
    } as browser.tabs.Tab)

    await Tree.openWindow({ windowUid: window.uid })

    expect(OnCreatedQueue.createWindowAndWait).toHaveBeenCalledWith({
      incognito: true,
      url: 'https://example.test/first',
    })
    expect(OnCreatedQueue.createTabAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        active: false,
        url: 'https://example.test/second',
        windowId: 30,
      }),
    )

    expect(window.id).toBe(30)
    expect(window.state).toBe(State.OPEN)
    expect(firstTab.id).toBe(101)
    expect(firstTab.state).toBe(State.OPEN)
    expect(secondTab.id).toBe(102)
    expect(secondTab.state).toBe(State.OPEN)
    await vi.waitFor(() => {
      expect(browser.tabs.update).toHaveBeenCalledWith(101, { pinned: true })
    })
    expect(browser.tabs.update).not.toHaveBeenCalledWith(102, {
      pinned: true,
    })
    expectTreeInvariants()
  })

  it.each([
    { label: 'empty', includeNote: false },
    { label: 'note-only', includeNote: true },
  ])(
    'opens a $label saved window without pre-adding a synthetic tree tab',
    async ({ includeNote }) => {
      const note = createNote('note-1' as UID)
      const children = includeNote ? [note] : []
      const window = createWindow('window-1' as UID, children, {
        id: -1,
        state: State.SAVED,
      })
      vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockResolvedValue({
        id: 30,
        tabs: [{ id: 101, url: 'about:blank' }],
      } as browser.windows.Window)

      await Tree.openWindow({ windowUid: window.uid })

      expect(OnCreatedQueue.createWindowAndWait).toHaveBeenCalledWith({
        incognito: false,
      })
      expect(window).toMatchObject({ id: 30, state: State.OPEN })
      expect(window.children).toEqual(children)
      expect(Tree.tabsByUid.size).toBe(0)
      if (includeNote) expect(Tree.notesByUid.get(note.uid)).toBe(note)
      expectTreeInvariants()
    },
  )

  it('restores mixed groups around notes and separators without changing tree order', async () => {
    Settings.values.openWindowWithTabsDiscarded = false
    const groupA = {
      uid: 'group-a' as UID,
      id: -1,
      title: 'Research',
      color: 'blue' as const,
      collapsed: false,
    }
    const groupB = {
      uid: 'group-b' as UID,
      id: -1,
      title: 'Personal',
      color: 'green' as const,
      collapsed: true,
    }
    const firstA = createTab('tab-a-1' as UID, {
      id: -1,
      pinned: true,
      state: State.SAVED,
      tabGroup: { ...groupA },
    })
    const note = createNote('note-between' as UID)
    const secondA = createTab('tab-a-2' as UID, {
      id: -1,
      state: State.SAVED,
      tabGroup: { ...groupA },
    })
    const separator = createSeparator('separator-between' as UID)
    const onlyB = createTab('tab-b-1' as UID, {
      id: -1,
      state: State.SAVED,
      tabGroup: { ...groupB },
    })
    const ungrouped = createTab('tab-ungrouped' as UID, {
      id: -1,
      state: State.SAVED,
    })
    const originalOrder = [firstA, note, secondA, separator, onlyB, ungrouped]
    const window = createWindow('window-1' as UID, originalOrder, {
      id: -1,
      state: State.SAVED,
    })
    vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockResolvedValue({
      id: 30,
      tabs: [{ id: 101 }],
    } as browser.windows.Window)
    vi.spyOn(OnCreatedQueue, 'createTabAndWait')
      .mockResolvedValueOnce({
        id: 102,
        windowId: 30,
        active: false,
        discarded: false,
      } as browser.tabs.Tab)
      .mockResolvedValueOnce({
        id: 103,
        windowId: 30,
        active: false,
        discarded: false,
      } as browser.tabs.Tab)
      .mockResolvedValueOnce({
        id: 104,
        windowId: 30,
        active: false,
        discarded: false,
      } as browser.tabs.Tab)
    vi.mocked(browser.tabs.group).mockImplementation(async (options) => {
      if ('groupId' in options && options.groupId !== undefined) {
        return options.groupId
      }
      const tabIds = Array.isArray(options.tabIds)
        ? options.tabIds
        : [options.tabIds]
      return tabIds.includes(103) ? 24 : 23
    })
    vi.mocked(browser.tabGroups.update).mockImplementation(
      async (groupId, changes) =>
        ({
          id: groupId,
          windowId: 30,
          title: changes.title,
          color: changes.color,
          collapsed: changes.collapsed,
        }) as browser.tabGroups.TabGroup,
    )
    vi.mocked(browser.tabs.query).mockImplementation(async ({ groupId }) => {
      if (groupId === 23) {
        return [
          { id: 101, windowId: 30, groupId: 23 },
          { id: 102, windowId: 30, groupId: 23 },
        ] as browser.tabs.Tab[]
      }
      if (groupId === 24) {
        return [{ id: 103, windowId: 30, groupId: 24 }] as browser.tabs.Tab[]
      }
      return []
    })

    await Tree.openWindow({ windowUid: window.uid })

    expect(window.children.map((item) => item.uid)).toEqual(
      originalOrder.map((item) => item.uid),
    )
    expect(browser.tabs.group).toHaveBeenCalledWith({
      tabIds: [101, 102],
      createProperties: { windowId: 30 },
    })
    expect(browser.tabs.group).toHaveBeenCalledWith({
      tabIds: [103],
      createProperties: { windowId: 30 },
    })
    expect(browser.tabs.group).toHaveBeenCalledTimes(2)
    expect(firstA.tabGroup).toMatchObject({ uid: groupA.uid, id: 23 })
    expect(secondA.tabGroup).toMatchObject({ uid: groupA.uid, id: 23 })
    expect(onlyB.tabGroup).toMatchObject({ uid: groupB.uid, id: 24 })
    expect(ungrouped.tabGroup).toBeUndefined()
    await vi.waitFor(() => {
      expect(browser.tabs.update).toHaveBeenCalledWith(101, { pinned: true })
    })
    expect(Tree.notesByUid.get(note.uid)).toBe(note)
    expect(Tree.separatorsByUid.get(separator.uid)).toBe(separator)
    expectTreeInvariants()
  })

  it('restores saved group metadata cleared by transient tab-creation events', async () => {
    Settings.values.openWindowWithTabsDiscarded = false
    const tabGroup = {
      uid: 'group-1' as UID,
      id: -1,
      title: 'Research',
      color: 'blue' as const,
      collapsed: false,
    }
    const ungrouped = createTab('tab-ungrouped' as UID, {
      id: -1,
      state: State.SAVED,
    })
    const firstGrouped = createTab('tab-grouped-1' as UID, {
      id: -1,
      state: State.SAVED,
      tabGroup: { ...tabGroup },
    })
    const note = createNote('note-between' as UID)
    const secondGrouped = createTab('tab-grouped-2' as UID, {
      id: -1,
      state: State.SAVED,
      tabGroup: { ...tabGroup },
    })
    const window = createWindow(
      'window-1' as UID,
      [ungrouped, firstGrouped, note, secondGrouped],
      { id: -1, state: State.SAVED },
    )
    vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockResolvedValue({
      id: 30,
      tabs: [{ id: 101 }],
    } as browser.windows.Window)
    vi.spyOn(OnCreatedQueue, 'createTabAndWait')
      .mockImplementationOnce(async () => {
        firstGrouped.tabGroup = undefined
        return {
          id: 102,
          windowId: 30,
          active: false,
          discarded: false,
        } as browser.tabs.Tab
      })
      .mockResolvedValueOnce({
        id: 103,
        windowId: 30,
        active: false,
        discarded: false,
      } as browser.tabs.Tab)
    vi.mocked(browser.tabs.group).mockResolvedValue(23)
    vi.mocked(browser.tabGroups.update).mockResolvedValue({
      id: 23,
      windowId: 30,
      title: tabGroup.title,
      color: tabGroup.color,
      collapsed: tabGroup.collapsed,
    })
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 102, windowId: 30, groupId: 23 },
      { id: 103, windowId: 30, groupId: 23 },
    ] as browser.tabs.Tab[])

    await Tree.openWindow({ windowUid: window.uid })

    expect(browser.tabs.group).toHaveBeenCalledWith({
      tabIds: [102, 103],
      createProperties: { windowId: 30 },
    })
    expect(firstGrouped.tabGroup).toMatchObject({
      uid: tabGroup.uid,
      id: 23,
    })
    expect(secondGrouped.tabGroup).toMatchObject({
      uid: tabGroup.uid,
      id: 23,
    })
    expectTreeInvariants()
  })

  it('uses the shared URL policy for blank and malformed tabs in a saved window', async () => {
    Settings.values.openWindowWithTabsDiscarded = true
    Settings.values.openWindowsInSameLocation = false
    const blank = createTab('tab-blank' as UID, {
      id: -1,
      state: State.SAVED,
      title: 'Blank',
      url: 'about:blank',
    })
    const malformed = createTab('tab-malformed' as UID, {
      id: -1,
      state: State.SAVED,
      title: 'Malformed title',
      url: 'not a valid absolute url',
    })
    const window = createWindow('window-1' as UID, [blank, malformed], {
      id: -1,
      state: State.SAVED,
    })
    const createWindowAndWait = vi
      .spyOn(OnCreatedQueue, 'createWindowAndWait')
      .mockResolvedValue({
        id: 30,
        tabs: [{ id: 101 }],
      } as browser.windows.Window)
    const createTabAndWait = vi
      .spyOn(OnCreatedQueue, 'createTabAndWait')
      .mockResolvedValue({
        id: 102,
        windowId: 30,
        index: 1,
        active: false,
        discarded: false,
        pinned: false,
      } as browser.tabs.Tab)

    await Tree.openWindow({ windowUid: window.uid })

    expect(createWindowAndWait).toHaveBeenCalledWith({
      incognito: false,
      url: 'about:blank',
    })
    expect(createTabAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        active: false,
        discarded: false,
        url:
          'moz-extension://test-id/redirect.html' +
          '?targetUrl=not%20a%20valid%20absolute%20url' +
          '&targetTitle=Malformed%20title',
        windowId: 30,
      }),
    )
    expectTreeInvariants()
  })

  it('normalizes multi-monitor bounds when reopening a saved window', async () => {
    Settings.values.openWindowsInSameLocation = true
    const tab = createTab('tab-1' as UID, {
      id: -1,
      state: State.SAVED,
      url: 'https://example.test/saved',
    })
    const window = createWindow('window-1' as UID, [tab], {
      id: -1,
      state: State.SAVED,
      windowPosition: {
        left: -1920,
        top: 0,
        width: Number.NaN,
        height: 900,
      },
    })
    const createWindowAndWait = vi
      .spyOn(OnCreatedQueue, 'createWindowAndWait')
      .mockResolvedValue({
        id: 30,
        tabs: [{ id: 101 }],
      } as browser.windows.Window)

    await Tree.openWindow({ windowUid: window.uid })

    expect(createWindowAndWait).toHaveBeenCalledWith({
      incognito: false,
      url: tab.url,
      left: -1920,
      top: 0,
      height: 900,
    })
    expectTreeInvariants()
  })

  it('records zero and negative coordinates for later window restoration', async () => {
    vi.useFakeTimers()
    Settings.values.openWindowsInSameLocation = true
    Settings.values.openWindowsInSameLocationUpdateInterval = 1
    Settings.values.openWindowsInSameLocationUpdateIntervalUnit = 'seconds'
    const tab = createTab('tab-1' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const window = createWindow('window-1' as UID, [tab], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.windows.getAll).mockResolvedValue([
      {
        id: window.id,
        left: 0,
        top: -400,
        width: 900,
        height: 700,
      } as browser.windows.Window,
    ])

    Tree.updateWindowPositionInterval()
    await vi.advanceTimersByTimeAsync(1000)
    await flushMicrotasks()

    expect(window.windowPosition).toEqual({
      left: 0,
      top: -400,
      width: 900,
      height: 700,
    })
    if (Tree.windowPositionInterval) {
      clearInterval(Tree.windowPositionInterval)
      Tree.windowPositionInterval = undefined
    }
    expectTreeInvariants()
  })

  it.each([
    { focusWindowOnOpen: true, shouldRestorePopupFocus: false },
    { focusWindowOnOpen: false, shouldRestorePopupFocus: true },
  ])(
    'honors focusWindowOnOpen=$focusWindowOnOpen when reopening a window',
    async ({ focusWindowOnOpen, shouldRestorePopupFocus }) => {
      Settings.values.focusWindowOnOpen = focusWindowOnOpen
      Tree.sessionTreeWindowId = 99
      const tab = createTab('tab-1' as UID, {
        id: -1,
        state: State.SAVED,
      })
      const window = createWindow('window-1' as UID, [tab], {
        id: -1,
        state: State.SAVED,
      })
      vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockResolvedValue({
        id: 30,
        tabs: [{ id: 101 }],
      } as browser.windows.Window)

      await Tree.openWindow({ windowUid: window.uid })

      if (shouldRestorePopupFocus) {
        expect(browser.windows.update).toHaveBeenCalledWith(99, {
          focused: true,
        })
      } else {
        expect(browser.windows.update).not.toHaveBeenCalledWith(99, {
          focused: true,
        })
      }
      expectTreeInvariants()
    },
  )

  it('restores a mixed-container window one tab at a time', async () => {
    Settings.values.openWindowWithTabsDiscarded = false
    Settings.values.openWindowsInSameLocation = false
    const work = {
      cookieStoreId: 'firefox-container-work',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
      iconUrl: 'resource://usercontext-content/briefcase.svg',
    }
    const banking = {
      cookieStoreId: 'firefox-container-banking',
      name: 'Banking',
      color: 'green',
      colorCode: '#51cd00',
      icon: 'dollar',
      iconUrl: 'resource://usercontext-content/dollar.svg',
    }
    vi.mocked(browser.contextualIdentities.query).mockResolvedValue([
      work,
      banking,
    ])
    await Tree.initializeContainers()
    const firstTab = createTab('tab-first' as UID, {
      container: work,
      id: -1,
      pinned: true,
      state: State.SAVED,
      url: 'https://example.test/work',
    })
    const secondTab = createTab('tab-second' as UID, {
      container: banking,
      id: -1,
      state: State.SAVED,
      url: 'https://example.test/banking',
    })
    const window = createWindow('window-1' as UID, [firstTab, secondTab], {
      id: -1,
      state: State.SAVED,
    })
    vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockResolvedValue({
      id: 30,
      tabs: [{ id: 101, cookieStoreId: work.cookieStoreId }],
    } as browser.windows.Window)
    vi.spyOn(OnCreatedQueue, 'createTabAndWait').mockResolvedValue({
      id: 102,
      windowId: 30,
      index: 1,
      active: false,
      discarded: false,
      pinned: false,
      cookieStoreId: banking.cookieStoreId,
    } as browser.tabs.Tab)

    await Tree.openWindow({ windowUid: window.uid })

    expect(OnCreatedQueue.createWindowAndWait).toHaveBeenCalledWith({
      incognito: false,
      url: firstTab.url,
      cookieStoreId: work.cookieStoreId,
    })
    expect(OnCreatedQueue.createTabAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        active: false,
        cookieStoreId: banking.cookieStoreId,
        url: secondTab.url,
        windowId: 30,
      }),
    )
    expect(firstTab.id).toBe(101)
    expect(secondTab.id).toBe(102)
  })

  it('restores the saved active tab after incremental window creation', async () => {
    Settings.values.openWindowWithTabsDiscarded = false
    Settings.values.openWindowsInSameLocation = false
    const firstTab = createTab('tab-first' as UID, {
      id: -1,
      state: State.SAVED,
    })
    const secondTab = createTab('tab-second' as UID, {
      id: -1,
      state: State.SAVED,
    })
    const window = createWindow('window-1' as UID, [firstTab, secondTab], {
      id: -1,
      savedActiveTabUid: secondTab.uid,
      state: State.SAVED,
    })
    vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockResolvedValue({
      id: 30,
      tabs: [{ id: 101, active: true }],
    } as browser.windows.Window)
    vi.spyOn(OnCreatedQueue, 'createTabAndWait').mockResolvedValue({
      id: 102,
      windowId: 30,
      index: 1,
      active: false,
      discarded: false,
      pinned: false,
    } as browser.tabs.Tab)

    await Tree.openWindow({ windowUid: window.uid })

    await vi.waitFor(() => {
      expect(browser.tabs.update).toHaveBeenCalledWith(102, { active: true })
    })
    expect(window.activeTabId).toBe(102)
    expect(firstTab.active).toBe(false)
    expect(secondTab.active).toBe(true)
  })

  it('rejects when a later tab fails during incremental window restoration', async () => {
    Settings.values.openWindowWithTabsDiscarded = false
    Settings.values.openWindowsInSameLocation = false
    const firstTab = createTab('tab-first' as UID, {
      id: -1,
      state: State.SAVED,
      url: 'https://example.test/first',
    })
    const secondTab = createTab('tab-second' as UID, {
      id: -1,
      state: State.SAVED,
      url: 'https://example.test/second',
    })
    const window = createWindow('window-1' as UID, [firstTab, secondTab], {
      id: -1,
      state: State.SAVED,
    })
    vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockResolvedValue({
      id: 30,
      tabs: [{ id: 101 }],
    } as browser.windows.Window)
    vi.spyOn(OnCreatedQueue, 'createTabAndWait').mockRejectedValue(
      new Error('Firefox refused the second tab'),
    )

    await expect(Tree.openWindow({ windowUid: window.uid })).rejects.toThrow(
      'Firefox refused the second tab',
    )
    expect(window.state).toBe(State.SAVED)
    expect(window.id).toBe(-1)
    expect(firstTab.state).toBe(State.SAVED)
    expect(firstTab.id).toBe(-1)
    expect(secondTab.state).toBe(State.SAVED)
    expect(secondTab.id).toBe(-1)
    expect(browser.windows.remove).toHaveBeenCalledWith(30)
    expect(browser.tabs.group).not.toHaveBeenCalled()
  })

  it('restores a missing snapshot when open-without-container window creation fails', async () => {
    const missingContainer = {
      cookieStoreId: 'firefox-container-missing',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
      iconUrl: 'resource://usercontext-content/briefcase.svg',
    }
    vi.mocked(browser.contextualIdentities.query).mockResolvedValue([])
    const tab = createTab('tab-work' as UID, {
      container: missingContainer,
      id: -1,
      state: State.SAVED,
    })
    const window = createWindow('window-1' as UID, [tab], {
      id: -1,
      state: State.SAVED,
    })
    vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockRejectedValue(
      new Error('Firefox refused window creation'),
    )

    await expect(
      Tree.openWindow({
        windowUid: window.uid,
        containerRecovery: 'without-container',
        containerRecoveryStoreIds: [missingContainer.cookieStoreId],
      }),
    ).rejects.toThrow('Firefox refused window creation')

    expect(window.state).toBe(State.SAVED)
    expect(window.id).toBe(-1)
    expect(tab.state).toBe(State.SAVED)
    expect(tab.id).toBe(-1)
    expect(tab.container).toEqual(missingContainer)
  })

  it('rejects a saved window open before browser creation when its container is missing', async () => {
    const tab = createTab('tab-work' as UID, {
      container: {
        cookieStoreId: 'firefox-container-missing',
        name: 'Work',
        color: 'blue',
        colorCode: '#37adff',
        icon: 'briefcase',
      },
      state: State.SAVED,
    })
    const window = createWindow('window-1' as UID, [tab], {
      id: -1,
      state: State.SAVED,
    })

    await expect(Tree.openWindow({ windowUid: window.uid })).rejects.toThrow(
      'Firefox container "Work" no longer exists',
    )
    expect(browser.windows.create).not.toHaveBeenCalled()
    expect(window.state).toBe(State.SAVED)
  })

  it('recreates saved tab groups after opening an entire saved window', async () => {
    Settings.values.openWindowWithTabsDiscarded = false
    Settings.values.openWindowsInSameLocation = false
    const tabGroup = {
      uid: 'stable-group' as UID,
      id: -1,
      title: 'Research',
      color: 'blue' as const,
      collapsed: false,
    }
    const firstTab = createTab('tab-first' as UID, {
      id: -1,
      state: State.SAVED,
      tabGroup: { ...tabGroup },
    })
    const secondTab = createTab('tab-second' as UID, {
      id: -1,
      state: State.SAVED,
      tabGroup: { ...tabGroup },
    })
    const window = createWindow('window-1' as UID, [firstTab, secondTab], {
      id: -1,
      state: State.SAVED,
    })
    vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockResolvedValue({
      id: 30,
      tabs: [{ id: 101 }],
    } as browser.windows.Window)
    vi.spyOn(OnCreatedQueue, 'createTabAndWait').mockResolvedValue({
      id: 102,
      windowId: 30,
      index: 1,
      active: false,
      discarded: false,
      pinned: false,
    } as browser.tabs.Tab)
    vi.mocked(browser.tabs.group).mockResolvedValue(23)
    vi.mocked(browser.tabGroups.update).mockResolvedValue({
      id: 23,
      windowId: 30,
      title: 'Research',
      color: 'blue',
      collapsed: false,
    })
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 101, windowId: 30, groupId: 23 },
      { id: 102, windowId: 30, groupId: 23 },
    ] as browser.tabs.Tab[])

    await Tree.openWindow({ windowUid: window.uid })

    expect(browser.tabs.group).toHaveBeenCalledWith({
      tabIds: [101, 102],
      createProperties: { windowId: 30 },
    })
    expect(firstTab.tabGroup?.id).toBe(23)
    expect(secondTab.tabGroup?.id).toBe(23)
    expectTreeInvariants()
  })

  it('returns one warning without rolling back a window after group restoration fails', async () => {
    Settings.values.openWindowWithTabsDiscarded = false
    Settings.values.openWindowsInSameLocation = false
    const tab = createTab('tab-first' as UID, {
      id: -1,
      state: State.SAVED,
      tabGroup: {
        uid: 'stable-group' as UID,
        id: -1,
        title: 'Research',
        color: 'blue',
        collapsed: false,
      },
    })
    const window = createWindow('window-1' as UID, [tab], {
      id: -1,
      state: State.SAVED,
    })
    vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockResolvedValue({
      id: 30,
      tabs: [{ id: 101 }],
    } as browser.windows.Window)
    vi.mocked(browser.tabs.group).mockRejectedValue(new Error('group failed'))

    const result = await Tree.openWindow({ windowUid: window.uid })

    expect(result).toEqual({
      warnings: [
        {
          code: 'tab-group-restore-partial',
          message:
            'Session Flow opened the window, but 1 tab group could not be fully restored.',
          affectedCount: 1,
        },
      ],
    })
    expect(window).toMatchObject({ id: 30, state: State.OPEN })
    expect(tab).toMatchObject({ id: 101, state: State.OPEN })
    expect(browser.windows.remove).not.toHaveBeenCalledWith(30)
    expectTreeInvariants()
  })
})

async function resolveCreatedWindowAndTabs(
  windowId: number,
  tabIds: number[],
): Promise<void> {
  OnCreatedQueue.addPendingWindowToQueue(windowId, false, true)
  await vi.advanceTimersByTimeAsync(100)
  await flushMicrotasks()
  for (const tabId of tabIds) {
    OnCreatedQueue.addPendingTabToQueue(tabId, false, true)
  }
  await vi.advanceTimersByTimeAsync(100)
}
