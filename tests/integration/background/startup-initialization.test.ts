import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY } from '@/defaults/constants'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Settings } from '@/services/settings'
import { Tree } from '@/services/background-tree'
import { State, TreeItemType, Window } from '@/types/session-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import { resetTree } from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

describe('startup initialization', () => {
  beforeEach(() => {
    installFakeBrowser()
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS), {
      fetchMissingFaviconsOnStartup: false,
      matchOpenedWindowsWithSavedWindowsOnStartup: true,
      restorePreviousSessionOnStartup: true,
    })
    vi.mocked(browser.windows.getAll).mockResolvedValue([])
  })

  it('records private identity for windows already open at startup', async () => {
    vi.mocked(browser.windows.getAll).mockResolvedValue([
      {
        id: 20,
        alwaysOnTop: false,
        incognito: true,
        focused: true,
        tabs: [
          {
            id: 21,
            windowId: 20,
            index: 0,
            active: true,
            discarded: false,
            pinned: false,
            title: 'Private tab',
            url: 'https://example.test/private',
          } as browser.tabs.Tab,
        ],
      } as browser.windows.Window,
    ])

    await Tree.initializeWindows()

    const window = Tree.Items.find(Tree.isWindow)
    expect(window).toMatchObject({
      id: 20,
      incognito: true,
      state: State.OPEN,
    })
    expect(window?.children).toHaveLength(1)
    expectTreeInvariants()
  })

  it('saves an unmatched previously-open window when it has only saved tabs to restore', async () => {
    const storedWindow = makeStoredWindow({
      uid: 'window-open-saved-tab' as UID,
      state: State.OPEN,
      activeTabId: 10,
      children: [
        makeStoredTab({
          uid: 'tab-saved' as UID,
          state: State.SAVED,
          active: true,
          id: 10,
        }),
      ],
    })
    mockStoredTree([storedWindow])

    await Tree.initializeWindows()

    const window = Tree.windowsByUid.get(storedWindow.uid)!
    const tab = Tree.tabsByUid.get('tab-saved' as UID)!
    expect(window.state).toBe(State.SAVED)
    expect(window.active).toBe(false)
    expect(window.activeTabId).toBeUndefined()
    expect(tab.state).toBe(State.SAVED)
    expect(tab.active).toBe(false)
    expectNoOpenWindowsWithoutOpenTabs()
    expectNoOpenTabsInSavedWindows()
    expectTreeInvariants()
  })

  it('saves an unmatched previously-open window when it has only notes', async () => {
    const storedWindow = makeStoredWindow({
      uid: 'window-open-note-only' as UID,
      state: State.OPEN,
      activeTabId: 20,
      children: [
        {
          type: TreeItemType.NOTE,
          uid: 'note-only' as UID,
          text: 'note-only',
          selected: true,
          windowUid: 'stale-window' as UID,
          collapsed: false,
          indentLevel: 1,
        },
      ],
    })
    mockStoredTree([storedWindow])

    await Tree.initializeWindows()

    const window = Tree.windowsByUid.get(storedWindow.uid)!
    expect(window.state).toBe(State.SAVED)
    expect(window.active).toBe(false)
    expect(window.activeTabId).toBeUndefined()
    expect(window.children[0].windowUid).toBe(window.uid)
    expectNoOpenWindowsWithoutOpenTabs()
    expectNoOpenTabsInSavedWindows()
    expectTreeInvariants()
  })

  it('saves an unmatched previously-open empty window', async () => {
    const storedWindow = makeStoredWindow({
      uid: 'window-open-empty' as UID,
      state: State.OPEN,
      activeTabId: 30,
      children: [],
    })
    mockStoredTree([storedWindow])

    await Tree.initializeWindows()

    const window = Tree.windowsByUid.get(storedWindow.uid)!
    expect(window.state).toBe(State.SAVED)
    expect(window.active).toBe(false)
    expect(window.activeTabId).toBeUndefined()
    expectNoOpenWindowsWithoutOpenTabs()
    expectNoOpenTabsInSavedWindows()
    expectTreeInvariants()
  })

  it('does not leave open or discarded tabs inside saved windows after startup', async () => {
    const storedWindow = makeStoredWindow({
      uid: 'window-saved-with-stale-open-tabs' as UID,
      state: State.SAVED,
      children: [
        makeStoredTab({
          uid: 'tab-stale-open' as UID,
          state: State.OPEN,
          active: true,
          id: 40,
        }),
        makeStoredTab({
          uid: 'tab-stale-discarded' as UID,
          state: State.DISCARDED,
          active: false,
          id: 41,
        }),
      ],
    })
    mockStoredTree([storedWindow])

    await Tree.initializeWindows()

    const window = Tree.windowsByUid.get(storedWindow.uid)!
    expect(window.state).toBe(State.SAVED)
    expect(Tree.getTabs(window.children).map((item) => item.state)).toEqual([
      State.SAVED,
      State.SAVED,
    ])
    expectNoOpenWindowsWithoutOpenTabs()
    expectNoOpenTabsInSavedWindows()
    expectTreeInvariants()
  })
})

function mockStoredTree(treeItems: Window[]): void {
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    [STORAGE_KEY]: structuredClone(treeItems),
  })
}

function makeStoredWindow(overrides: Partial<Window>): Window {
  return {
    type: TreeItemType.WINDOW,
    uid: 'window-1' as UID,
    active: true,
    activeTabId: 1,
    id: 1,
    incognito: false,
    selected: true,
    state: State.OPEN,
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
    active: true,
    id: 1,
    selected: true,
    state: State.OPEN,
    title: 'Tab',
    url: 'https://example.test',
    windowUid: 'window-1' as UID,
    indentLevel: 1,
    pinned: false,
    ...overrides,
  } as Window['children'][number]
}

function expectNoOpenWindowsWithoutOpenTabs(): void {
  for (const window of Tree.Items.filter(Tree.isWindow)) {
    if (window.state !== State.OPEN) continue
    const openTabs = Tree.getTabs(window.children).filter(
      (tab) => tab.state === State.OPEN || tab.state === State.DISCARDED,
    )
    expect(
      openTabs.length,
      `open window ${window.uid} should have at least one open or discarded tab`,
    ).toBeGreaterThan(0)
    expect(
      openTabs.some((tab) => tab.id === window.activeTabId),
      `open window ${window.uid} activeTabId should point at an open tab`,
    ).toBe(true)
  }
}

function expectNoOpenTabsInSavedWindows(): void {
  for (const window of Tree.Items.filter(Tree.isWindow)) {
    if (window.state !== State.SAVED) continue
    for (const tab of Tree.getTabs(window.children)) {
      expect(
        tab.state,
        `saved window ${window.uid} should not contain open tab ${tab.uid}`,
      ).toBe(State.SAVED)
    }
  }
}
