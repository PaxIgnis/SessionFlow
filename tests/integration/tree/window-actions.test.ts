import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import { State, Window } from '@/types/session-tree'
import { flushMicrotasks, installFakeBrowser } from '../../helpers/fake-browser'
import {
  createNote,
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

  it('removes an open tree window immediately and then closes the browser window', async () => {
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
    vi.mocked(browser.windows.get).mockResolvedValue({
      id: window.id,
    } as browser.windows.Window)
    vi.mocked(browser.windows.remove).mockReturnValue(removeSettled)

    Tree.closeWindow({ windowId: window.id, windowUid: window.uid })

    expect(Tree.Items).toEqual([])
    expect(Tree.windowsByUid.has(window.uid)).toBe(false)
    expect(Tree.tabsByUid.has(tab.uid)).toBe(false)
    expect(Tree.notesByUid.has(note.uid)).toBe(false)
    expect(Tree.existingUidsSet.has(window.uid)).toBe(false)
    expect(Tree.existingUidsSet.has(tab.uid)).toBe(false)
    expect(Tree.existingUidsSet.has(note.uid)).toBe(false)
    expect(browser.windows.get).toHaveBeenCalledWith(window.id)
    await vi.waitFor(() => {
      expect(browser.windows.remove).toHaveBeenCalledWith(window.id)
    })
    resolveRemove()
    await removeSettled
    expectTreeInvariants()
  })

  it('logs debug and skips browser removal when a closed tree window no longer exists in the browser', async () => {
    const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const tab = createTab('tab-1' as UID, { id: 10, state: State.OPEN })
    const window = createWindow('window-1' as UID, [tab], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.windows.get).mockRejectedValue(new Error('not found'))

    Tree.closeWindow({ windowId: window.id, windowUid: window.uid })

    expect(Tree.windowsByUid.has(window.uid)).toBe(false)
    expect(Tree.tabsByUid.has(tab.uid)).toBe(false)
    await vi.waitFor(() => {
      expect(consoleDebug).toHaveBeenCalledWith(
        'Window ID not found.',
        window.id,
      )
    })
    expect(browser.windows.remove).not.toHaveBeenCalled()
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

    Tree.saveAndRemoveWindow({ windowId: window.id, windowUid: window.uid })

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

  it('logs an error when browser removal fails after saving a window', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
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

    Tree.saveAndRemoveWindow({ windowId: window.id, windowUid: window.uid })

    expect(window.state).toBe(State.SAVED)
    expect(window.id).toBe(-1)
    expect(tab.state).toBe(State.SAVED)
    expect(tab.id).toBe(-1)
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Error saving window:',
        removeError,
      )
    })
    expectTreeInvariants()
  })

  it('opens a saved window with tab URLs, assigns browser ids, and pins saved pinned tabs', async () => {
    vi.useFakeTimers()
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
    vi.mocked(browser.windows.create).mockResolvedValue({
      id: 30,
      tabs: [{ id: 101 }, { id: 102 }],
    } as browser.windows.Window)

    const result = Tree.openWindow({ windowUid: window.uid })
    await flushMicrotasks()

    expect(browser.windows.create).toHaveBeenCalledWith({
      incognito: true,
      url: ['https://example.test/first', 'https://example.test/second'],
    })
    await resolveCreatedWindowAndTabs(30, [101, 102])

    await result

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

  it('recreates saved tab groups after opening an entire saved window', async () => {
    vi.useFakeTimers()
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
    vi.mocked(browser.windows.create).mockResolvedValue({
      id: 30,
      tabs: [{ id: 101 }, { id: 102 }],
    } as browser.windows.Window)
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

    const result = Tree.openWindow({ windowUid: window.uid })
    await flushMicrotasks()
    await resolveCreatedWindowAndTabs(30, [101, 102])
    await result

    expect(browser.tabs.group).toHaveBeenCalledWith({
      tabIds: [101, 102],
      createProperties: { windowId: 30 },
    })
    expect(firstTab.tabGroup?.id).toBe(23)
    expect(secondTab.tabGroup?.id).toBe(23)
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
