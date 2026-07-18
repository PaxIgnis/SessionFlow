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
    vi.restoreAllMocks()
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

  it('captures container metadata for tabs already open at startup', async () => {
    const identity = {
      cookieStoreId: 'firefox-container-work',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
      iconUrl: 'resource://usercontext-content/briefcase.svg',
    }
    vi.mocked(browser.contextualIdentities.query).mockResolvedValue([identity])
    vi.mocked(browser.windows.getAll).mockResolvedValue([
      {
        id: 20,
        alwaysOnTop: false,
        incognito: false,
        focused: true,
        tabs: [
          {
            id: 21,
            windowId: 20,
            index: 0,
            active: true,
            discarded: false,
            pinned: false,
            title: 'Work tab',
            url: 'https://example.test/work',
            cookieStoreId: identity.cookieStoreId,
          } as browser.tabs.Tab,
        ],
      } as browser.windows.Window,
    ])
    await Tree.initializeContainers()
    await Tree.initializeWindows()

    const window = Tree.Items.find(Tree.isWindow)!
    expect(Tree.getTabs(window.children)[0].container).toEqual(identity)
    expectTreeInvariants()
  })

  it('refreshes saved container snapshots from live Firefox metadata at startup', async () => {
    const savedContainer = {
      cookieStoreId: 'firefox-container-work',
      name: 'Old Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
      iconUrl: 'resource://usercontext-content/briefcase.svg',
    }
    const liveContainer = {
      ...savedContainer,
      name: 'Renamed Work',
      color: 'purple',
      colorCode: '#af51f5',
      icon: 'fingerprint',
      iconUrl: 'resource://usercontext-content/fingerprint.svg',
    }
    mockStoredTree([
      makeStoredWindow({
        uid: 'window-saved' as UID,
        state: State.SAVED,
        children: [
          makeStoredTab({
            uid: 'tab-saved' as UID,
            container: savedContainer,
            state: State.SAVED,
          }),
        ],
      }),
    ])
    vi.mocked(browser.contextualIdentities.query).mockResolvedValue([
      liveContainer,
    ])

    await Tree.initializeContainers()
    await Tree.initializeWindows()

    expect(Tree.tabsByUid.get('tab-saved' as UID)?.container).toEqual(
      liveContainer,
    )
  })

  it('matches same-URL startup tabs by container and captures unmatched containers', async () => {
    const work = {
      cookieStoreId: 'firefox-container-work',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
      iconUrl: 'resource://usercontext-content/briefcase.svg',
    }
    const personal = {
      ...work,
      cookieStoreId: 'firefox-container-personal',
      name: 'Personal',
      color: 'green',
      colorCode: '#51cd00',
      icon: 'fence',
      iconUrl: 'resource://usercontext-content/fence.svg',
    }
    vi.mocked(browser.contextualIdentities.query).mockResolvedValue([
      work,
      personal,
    ])
    const storedWindow = makeStoredWindow({
      uid: 'window-matched' as UID,
      state: State.OPEN,
      children: [
        makeStoredTab({
          uid: 'tab-work' as UID,
          container: work,
          title: 'Same URL',
          url: 'https://example.test/same',
        }),
        makeStoredTab({
          uid: 'tab-personal' as UID,
          container: personal,
          title: 'Same URL',
          url: 'https://example.test/same',
        }),
      ],
    })
    mockStoredTree([storedWindow])
    vi.mocked(browser.windows.getAll).mockResolvedValue([
      {
        id: 20,
        incognito: false,
        focused: true,
        tabs: [
          {
            id: 31,
            windowId: 20,
            active: true,
            discarded: false,
            pinned: false,
            title: 'Same URL',
            url: 'https://example.test/same',
            cookieStoreId: personal.cookieStoreId,
          },
          {
            id: 30,
            windowId: 20,
            active: false,
            discarded: false,
            pinned: false,
            title: 'Same URL',
            url: 'https://example.test/same',
            cookieStoreId: work.cookieStoreId,
          },
          {
            id: 32,
            windowId: 20,
            active: false,
            discarded: false,
            pinned: false,
            title: 'Personal extra',
            url: 'https://example.test/extra',
            cookieStoreId: personal.cookieStoreId,
          },
        ],
      } as browser.windows.Window,
    ])

    await Tree.initializeContainers()
    await Tree.initializeWindows()

    expect(Tree.tabsByUid.get('tab-work' as UID)).toMatchObject({
      id: 30,
      container: work,
    })
    expect(Tree.tabsByUid.get('tab-personal' as UID)).toMatchObject({
      id: 31,
      container: personal,
    })
    const extra = [...Tree.tabsByUid.values()].find((tab) => tab.id === 32)
    expect(extra?.container).toEqual(personal)
    expectTreeInvariants()
  })

  it('treats missing legacy container metadata as unknown during startup matching', async () => {
    const work = {
      cookieStoreId: 'firefox-container-work',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
      iconUrl: 'resource://usercontext-content/briefcase.svg',
    }
    mockStoredTree([
      makeStoredWindow({
        uid: 'window-legacy' as UID,
        state: State.OPEN,
        children: [
          makeStoredTab({
            uid: 'tab-legacy' as UID,
            title: 'Legacy work tab',
            url: 'https://example.test/work',
            container: undefined,
          }),
        ],
      }),
    ])
    vi.mocked(browser.contextualIdentities.query).mockResolvedValue([work])
    vi.mocked(browser.windows.getAll).mockResolvedValue([
      {
        id: 20,
        incognito: false,
        focused: true,
        tabs: [
          {
            id: 21,
            windowId: 20,
            index: 0,
            active: true,
            discarded: false,
            pinned: false,
            title: 'Legacy work tab',
            url: 'https://example.test/work',
            cookieStoreId: work.cookieStoreId,
          },
        ],
      } as browser.windows.Window,
    ])
    vi.spyOn(Tree, 'openTab').mockResolvedValue(undefined)

    await Tree.initializeContainers()
    await Tree.initializeWindows()

    expect(Tree.Items.filter(Tree.isWindow)).toHaveLength(1)
    expect(Tree.windowsByUid.get('window-legacy' as UID)).toMatchObject({
      id: 20,
      state: State.OPEN,
    })
    expect(Tree.tabsByUid.get('tab-legacy' as UID)).toMatchObject({
      id: 21,
      container: work,
    })
  })

  it('restores a previously open legacy tab after assigning its missing UID', async () => {
    const legacyTab = makeStoredTab({
      uid: undefined as unknown as UID,
      state: State.OPEN,
      title: 'Legacy tab without UID',
      url: 'https://example.test/legacy',
    })
    mockStoredTree([
      makeStoredWindow({
        uid: 'window-legacy' as UID,
        state: State.OPEN,
        children: [legacyTab],
      }),
    ])
    const openTab = vi.spyOn(Tree, 'openTab').mockResolvedValue(undefined)

    await Tree.initializeWindows()

    const normalizedTab = Tree.getTabs(
      Tree.windowsByUid.get('window-legacy' as UID)!.children,
    )[0]
    expect(normalizedTab.uid).toBeTruthy()
    expect(openTab).toHaveBeenCalledWith(
      expect.objectContaining({
        tabUid: normalizedTab.uid,
        windowUid: 'window-legacy',
      }),
    )
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
