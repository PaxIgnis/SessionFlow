import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import { State } from '@/types/session-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import {
  createNote,
  createSeparator,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

describe('background browser API interactions', () => {
  let fakeBrowser: ReturnType<typeof installFakeBrowser>

  beforeEach(() => {
    vi.restoreAllMocks()
    fakeBrowser = installFakeBrowser()
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })

  it('moves saved tabs in the tree without calling browser.tabs.move', async () => {
    const tab = createTab('tab-1' as UID, { state: State.SAVED })
    const note = createNote('note-1' as UID)
    const window = createWindow('window-1' as UID, [note, tab], {
      state: State.SAVED,
    })

    await Tree.moveTab(tab.uid, window.uid, 0, undefined, false, false)

    expect(browser.tabs.move).not.toHaveBeenCalled()
    expect(window.children.map((item) => item.uid)).toEqual([tab.uid, note.uid])
    expectTreeInvariants()
  })

  it('moves open tabs in the browser using an index that excludes notes', async () => {
    const note = createNote('note-1' as UID)
    const firstTab = createTab('tab-first' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const movedTab = createTab('tab-moved' as UID, {
      id: 11,
      state: State.OPEN,
    })
    const window = createWindow('window-1' as UID, [note, firstTab, movedTab], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.tabs.move).mockResolvedValue({
      id: movedTab.id,
    } as browser.tabs.Tab)

    await Tree.moveTab(movedTab.uid, window.uid, 0, undefined, false, false)

    expect(browser.tabs.move).toHaveBeenCalledWith(movedTab.id, {
      windowId: window.id,
      index: 0,
    })
    expect(window.children.map((item) => item.uid)).toEqual([
      movedTab.uid,
      note.uid,
      firstTab.uid,
    ])
    expectTreeInvariants()
  })

  it.each([
    { action: 'pin' as const, pinned: true },
    { action: 'unpin' as const, pinned: false },
  ])(
    'does not send a redundant browser update when a live tab is already $actionned',
    ({ action, pinned }) => {
      const tab = createTab('tab-1' as UID, {
        id: 10,
        pinned,
        state: State.OPEN,
      })
      createWindow('window-1' as UID, [tab], {
        id: 20,
        state: State.OPEN,
      })

      if (action === 'pin') Tree.pinTab(tab.uid)
      else Tree.unpinTab(tab.uid)

      expect(browser.tabs.update).not.toHaveBeenCalled()
      expect(tab.pinned).toBe(pinned)
      expectTreeInvariants()
    },
  )

  it.each([
    { action: 'pin' as const, initialPinned: false, expectedPinned: true },
    { action: 'unpin' as const, initialPinned: true, expectedPinned: false },
  ])(
    'waits for Firefox before applying a live $action tree state',
    ({ action, initialPinned, expectedPinned }) => {
      const tab = createTab('tab-1' as UID, {
        id: 10,
        pinned: initialPinned,
        state: State.OPEN,
      })
      createWindow('window-1' as UID, [tab], {
        id: 20,
        state: State.OPEN,
      })

      if (action === 'pin') Tree.pinTab(tab.uid)
      else Tree.unpinTab(tab.uid)

      expect(browser.tabs.update).toHaveBeenCalledWith(10, {
        pinned: expectedPinned,
      })
      expect(tab.pinned).toBe(initialPinned)
      expectTreeInvariants()
    },
  )

  it('does not call browser.tabs.remove when closing a saved tab id', () => {
    const tab = createTab('tab-1' as UID, { id: -1, state: State.SAVED })
    const note = createNote('note-1' as UID)
    const window = createWindow('window-1' as UID, [tab, note])

    Tree.closeTab({ tabId: -1, tabUid: tab.uid })

    expect(browser.tabs.remove).not.toHaveBeenCalled()
    expect(window.children.map((item) => item.uid)).toEqual([note.uid])
    expectTreeInvariants()
  })

  it('removes a saved single-tab window once when closing its saved tab', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const tab = createTab('tab-1' as UID, { id: -1, state: State.SAVED })
    const window = createWindow('window-1' as UID, [tab], {
      id: -1,
      state: State.SAVED,
    })

    Tree.closeTab({ tabId: -1, tabUid: tab.uid })

    expect(Tree.tabsByUid.has(tab.uid)).toBe(false)
    expect(Tree.windowsByUid.has(window.uid)).toBe(false)
    expect(browser.tabs.remove).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalledWith(
      `Error Removing Window ${window.uid} from sessionTree`,
    )
    expectTreeInvariants()
  })

  it('clears active state when saving the only open tab in an active window', async () => {
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

    await Tree.saveTab({ tabId: tab.id, tabUid: tab.uid })

    expect(window.state).toBe(State.SAVED)
    expect(window.id).toBe(-1)
    expect(window.active).toBe(false)
    expect(window.activeTabId).toBeUndefined()
    expect(tab.state).toBe(State.SAVED)
    expect(tab.active).toBe(false)
    expect(browser.tabs.remove).toHaveBeenCalledWith(10)
    expectTreeInvariants()
  })

  it.each(['save', 'close'] as const)(
    '%s clears the active tab before Firefox activates its replacement',
    async (action) => {
      const activeTab = createTab('tab-active' as UID, {
        active: true,
        id: 10,
        state: State.OPEN,
      })
      const replacement = createTab('tab-replacement' as UID, {
        active: false,
        id: 11,
        state: State.OPEN,
      })
      const window = createWindow('window-1' as UID, [activeTab, replacement], {
        active: true,
        activeTabId: activeTab.id,
        id: 20,
        state: State.OPEN,
      })

      if (action === 'save') {
        await Tree.saveTab({ tabId: activeTab.id, tabUid: activeTab.uid })
        expect(activeTab).toMatchObject({
          active: false,
          id: -1,
          state: State.SAVED,
        })
      } else {
        await Tree.closeTab({ tabId: activeTab.id, tabUid: activeTab.uid })
        expect(Tree.tabsByUid.has(activeTab.uid)).toBe(false)
      }

      expect(window.activeTabId).toBeUndefined()
      expect(replacement.active).toBe(false)

      Tree.tabOnActivated({
        tabId: replacement.id,
        windowId: window.id,
        previousTabId: activeTab.id,
      })

      expect(window.activeTabId).toBe(replacement.id)
      expect(replacement.active).toBe(true)
      expect(
        window.children.filter(
          (item) => item.type === 1 && item.active === true,
        ),
      ).toEqual([replacement])
      expectTreeInvariants()
    },
  )

  it.each(['save', 'close'] as const)(
    '%s the only browser-backed tab preserves a note/separator window',
    async (action) => {
      const tab = createTab('tab-1' as UID, {
        active: true,
        id: 10,
        state: State.OPEN,
      })
      const note = createNote('note-1' as UID)
      const separator = createSeparator('separator-1' as UID)
      const window = createWindow('window-1' as UID, [tab, note, separator], {
        active: true,
        activeTabId: tab.id,
        id: 20,
        state: State.OPEN,
      })

      if (action === 'save') {
        await Tree.saveTab({ tabId: tab.id, tabUid: tab.uid })
        expect(window.children.map((item) => item.uid)).toEqual([
          tab.uid,
          note.uid,
          separator.uid,
        ])
        expect(tab).toMatchObject({ id: -1, state: State.SAVED })
      } else {
        await Tree.closeTab({ tabId: tab.id, tabUid: tab.uid })
        expect(window.children.map((item) => item.uid)).toEqual([
          note.uid,
          separator.uid,
        ])
        expect(Tree.tabsByUid.has(tab.uid)).toBe(false)
      }

      expect(window).toMatchObject({ id: -1, state: State.SAVED })
      expect(Tree.notesByUid.get(note.uid)).toBe(note)
      expect(Tree.separatorsByUid.get(separator.uid)).toBe(separator)
      expectTreeInvariants()
    },
  )

  it('saves mixed live tabs while preserving saved items and metadata', async () => {
    const group = {
      uid: 'group-1' as UID,
      id: 7,
      title: 'Research',
      color: 'blue' as const,
      collapsed: true,
    }
    const container = {
      cookieStoreId: 'firefox-container-1',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
    }
    const open = createTab('tab-open' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: { ...group },
      container: { ...container },
    })
    const discarded = createTab('tab-discarded' as UID, {
      id: 11,
      state: State.DISCARDED,
      tabGroup: { ...group },
      container: { ...container },
    })
    const alreadySaved = createTab('tab-saved' as UID, {
      id: -1,
      state: State.SAVED,
      savedTime: 123,
    })
    const note = createNote('note-1' as UID)
    const separator = createSeparator('separator-1' as UID)
    const window = createWindow(
      'window-1' as UID,
      [open, note, discarded, separator, alreadySaved],
      { id: 20, state: State.OPEN },
    )

    await Tree.saveTab({ tabId: open.id, tabUid: open.uid })
    await Tree.saveTab({ tabId: discarded.id, tabUid: discarded.uid })
    await Tree.saveTab({ tabId: alreadySaved.id, tabUid: alreadySaved.uid })

    expect(open).toMatchObject({
      id: -1,
      state: State.SAVED,
      tabGroup: { uid: group.uid, id: -1 },
      container,
    })
    expect(discarded).toMatchObject({
      id: -1,
      state: State.SAVED,
      tabGroup: { uid: group.uid, id: -1 },
      container,
    })
    expect(alreadySaved).toMatchObject({
      id: -1,
      state: State.SAVED,
      savedTime: 123,
    })
    expect(window.children.map((item) => item.uid)).toEqual([
      open.uid,
      note.uid,
      discarded.uid,
      separator.uid,
      alreadySaved.uid,
    ])
    expect(browser.tabs.remove).toHaveBeenCalledTimes(2)
    expectTreeInvariants()
  })

  it('keeps an open tab unchanged when browser removal fails and it still exists', async () => {
    const tab = createTab('tab-1' as UID, { id: 10, state: State.OPEN })
    const window = createWindow('window-1' as UID, [tab], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.tabs.remove).mockRejectedValue(new Error('remove failed'))
    vi.mocked(browser.tabs.get).mockResolvedValue({
      id: tab.id,
      windowId: window.id,
    } as browser.tabs.Tab)

    await expect(
      Tree.closeTab({ tabId: tab.id, tabUid: tab.uid }),
    ).rejects.toThrow('remove failed')

    expect(Tree.tabsByUid.get(tab.uid)).toBe(tab)
    expect(window.children).toEqual([tab])
    expect(tab).toMatchObject({ id: 10, state: State.OPEN })
    expectTreeInvariants()
  })

  it('keeps an open tab unchanged when failed removal cannot be revalidated', async () => {
    const tab = createTab('tab-1' as UID, { id: 10, state: State.OPEN })
    const window = createWindow('window-1' as UID, [tab], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.tabs.remove).mockRejectedValue(new Error('remove failed'))
    vi.mocked(browser.tabs.get).mockRejectedValue(new Error('lookup failed'))

    await expect(
      Tree.saveTab({ tabId: tab.id, tabUid: tab.uid }),
    ).rejects.toThrow('Could not confirm whether Firefox removed tab 10')

    expect(tab).toMatchObject({ id: 10, state: State.OPEN })
    expect(window).toMatchObject({ id: 20, state: State.OPEN })
    expectTreeInvariants()
  })

  it('commits a save when Firefox reports that the tab is already gone', async () => {
    const tab = createTab('tab-1' as UID, { id: 10, state: State.OPEN })
    const window = createWindow('window-1' as UID, [tab], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.tabs.remove).mockRejectedValue(
      new Error('Invalid tab ID: 10'),
    )
    vi.mocked(browser.tabs.get).mockRejectedValue(
      new Error('Invalid tab ID: 10'),
    )

    await expect(
      Tree.saveTab({ tabId: tab.id, tabUid: tab.uid }),
    ).resolves.toBeUndefined()

    expect(tab).toMatchObject({ id: -1, state: State.SAVED })
    expect(window).toMatchObject({ id: -1, state: State.SAVED })
    expectTreeInvariants()
  })

  it('keeps an open window unchanged when browser removal fails and it still exists', async () => {
    const tab = createTab('tab-1' as UID, { id: 10, state: State.OPEN })
    const window = createWindow('window-1' as UID, [tab], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.windows.remove).mockRejectedValue(
      new Error('remove failed'),
    )
    vi.mocked(browser.windows.get).mockResolvedValue({
      id: window.id,
    } as browser.windows.Window)

    await expect(
      Tree.closeWindow({ windowId: window.id, windowUid: window.uid }),
    ).rejects.toThrow('remove failed')

    expect(Tree.windowsByUid.get(window.uid)).toBe(window)
    expect(Tree.tabsByUid.get(tab.uid)).toBe(tab)
    expectTreeInvariants()
  })

  it('commits a saved window when Firefox reports that it is already gone', async () => {
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

    await expect(
      Tree.saveAndRemoveWindow({
        windowId: window.id,
        windowUid: window.uid,
      }),
    ).resolves.toBeUndefined()

    expect(window).toMatchObject({ id: -1, state: State.SAVED })
    expect(tab).toMatchObject({ id: -1, state: State.SAVED })
    expectTreeInvariants()
  })

  it('restores a saved grouped tab in its open session window instead of the popup', async () => {
    const openTab = createTab('open-tab' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const savedGroupedTab = createTab('saved-grouped-tab' as UID, {
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
    const window = createWindow('window-1' as UID, [openTab, savedGroupedTab], {
      id: 20,
      state: State.OPEN,
    })
    Tree.sessionTreeWindowId = 99
    vi.spyOn(OnCreatedQueue, 'createTabAndWait').mockResolvedValue({
      id: 30,
      windowId: window.id,
      index: 1,
      active: true,
      discarded: false,
      pinned: false,
    } as browser.tabs.Tab)
    vi.mocked(browser.tabs.group).mockResolvedValue(7)
    vi.mocked(browser.tabGroups.update).mockResolvedValue({
      id: 7,
      windowId: window.id,
      title: 'Research',
      color: 'blue',
      collapsed: false,
    })
    vi.mocked(browser.tabs.query).mockResolvedValue([
      {
        id: 30,
        windowId: window.id,
        groupId: 7,
      } as browser.tabs.Tab,
    ])

    await Tree.openTab({
      tabUid: savedGroupedTab.uid,
      windowUid: window.uid,
    })

    expect(OnCreatedQueue.createTabAndWait).toHaveBeenCalledWith(
      expect.objectContaining({ windowId: window.id }),
    )
    expect(browser.tabs.group).toHaveBeenCalledWith({
      tabIds: [30],
      createProperties: { windowId: window.id },
    })
    expect(browser.tabs.group).not.toHaveBeenCalledWith(
      expect.objectContaining({
        createProperties: { windowId: Tree.sessionTreeWindowId },
      }),
    )
    expect(savedGroupedTab.tabGroup?.id).toBe(7)
    expectTreeInvariants()
  })

  it('opens a saved tab in its Firefox container', async () => {
    const identity = {
      cookieStoreId: 'firefox-container-1',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
      iconUrl: 'resource://usercontext-content/briefcase.svg',
    }
    vi.mocked(fakeBrowser.contextualIdentities.query).mockResolvedValue([
      identity,
    ])
    await Tree.initializeContainers()
    const openTab = createTab('open-tab' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const savedTab = createTab('saved-tab' as UID, {
      container: identity,
      id: -1,
      state: State.SAVED,
    })
    const window = createWindow('window-1' as UID, [openTab, savedTab], {
      id: 20,
      state: State.OPEN,
    })
    vi.spyOn(OnCreatedQueue, 'createTabAndWait').mockResolvedValue({
      id: 30,
      windowId: window.id,
      index: 1,
      active: true,
      discarded: false,
      pinned: false,
      cookieStoreId: identity.cookieStoreId,
    } as browser.tabs.Tab)

    await Tree.openTab({ tabUid: savedTab.uid, windowUid: window.uid })

    expect(OnCreatedQueue.createTabAndWait).toHaveBeenCalledWith(
      expect.objectContaining({ cookieStoreId: identity.cookieStoreId }),
    )
  })

  it.each([
    ['about:blank', undefined, false],
    [
      'about:config',
      'moz-extension://test-id/redirect.html' +
        '?targetUrl=about%3Aconfig&targetTitle=Saved%20title',
      false,
    ],
    [
      'not a valid absolute url',
      'moz-extension://test-id/redirect.html' +
        '?targetUrl=not%20a%20valid%20absolute%20url' +
        '&targetTitle=Saved%20title',
      false,
    ],
    ['https://example.test/path', 'https://example.test/path', true],
  ] as const)(
    'applies the shared URL policy when opening a discarded saved tab: %s',
    async (url, expectedUrl, expectedDiscarded) => {
      const openTab = createTab('open-tab' as UID, {
        id: 10,
        state: State.OPEN,
      })
      const savedTab = createTab('saved-tab' as UID, {
        id: -1,
        state: State.SAVED,
        title: 'Saved title',
        url,
      })
      const window = createWindow('window-1' as UID, [openTab, savedTab], {
        id: 20,
        state: State.OPEN,
      })
      const createTabAndWait = vi
        .spyOn(OnCreatedQueue, 'createTabAndWait')
        .mockResolvedValue({
          id: 30,
          windowId: window.id,
          index: 1,
          active: false,
          discarded: expectedDiscarded,
          pinned: false,
        } as browser.tabs.Tab)

      await Tree.openTab({
        tabUid: savedTab.uid,
        windowUid: window.uid,
        discarded: true,
      })

      const properties = createTabAndWait.mock.calls[0][0]
      if (expectedUrl === undefined) {
        expect(properties).not.toHaveProperty('url')
      } else {
        expect(properties.url).toBe(expectedUrl)
      }
      expect(properties).toMatchObject({
        active: false,
        discarded: expectedDiscarded,
        windowId: window.id,
      })
      expectTreeInvariants()
    },
  )

  it.each([
    {
      focusSetting: false,
      explicitActive: undefined,
      expectedActive: false,
    },
    { focusSetting: true, explicitActive: undefined, expectedActive: true },
    { focusSetting: true, explicitActive: false, expectedActive: false },
    { focusSetting: false, explicitActive: true, expectedActive: true },
  ])(
    'uses focusTabOnOpen=$focusSetting with explicit active=$explicitActive',
    async ({ focusSetting, explicitActive, expectedActive }) => {
      Settings.values.focusTabOnOpen = focusSetting
      const openTab = createTab('open-tab' as UID, {
        id: 10,
        state: State.OPEN,
      })
      const savedTab = createTab('saved-tab' as UID, {
        id: -1,
        state: State.SAVED,
      })
      const window = createWindow('window-1' as UID, [openTab, savedTab], {
        id: 20,
        state: State.OPEN,
      })
      const createTabAndWait = vi
        .spyOn(OnCreatedQueue, 'createTabAndWait')
        .mockResolvedValue({
          id: 30,
          windowId: window.id,
          index: 1,
          active: expectedActive,
          discarded: false,
          pinned: false,
        } as browser.tabs.Tab)

      await Tree.openTab({
        tabUid: savedTab.uid,
        windowUid: window.uid,
        active: explicitActive,
      })

      expect(createTabAndWait).toHaveBeenCalledWith(
        expect.objectContaining({ active: expectedActive }),
      )
      expectTreeInvariants()
    },
  )

  it.each([
    { focusWindowOnOpen: true, shouldRestorePopupFocus: false },
    { focusWindowOnOpen: false, shouldRestorePopupFocus: true },
  ])(
    'honors focusWindowOnOpen=$focusWindowOnOpen for a saved tab window',
    async ({ focusWindowOnOpen, shouldRestorePopupFocus }) => {
      Settings.values.focusWindowOnOpen = focusWindowOnOpen
      Tree.sessionTreeWindowId = 99
      const tab = createTab('saved-tab' as UID, {
        id: -1,
        state: State.SAVED,
      })
      const window = createWindow('window-1' as UID, [tab], {
        id: -1,
        state: State.SAVED,
      })
      vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockResolvedValue({
        id: 30,
        tabs: [{ id: 31 }],
      } as browser.windows.Window)

      await Tree.openTab({ tabUid: tab.uid, windowUid: window.uid })

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

  it('rejects and restores saved state when browser tab creation fails', async () => {
    const openTab = createTab('open-tab' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const savedTab = createTab('saved-tab' as UID, {
      id: -1,
      state: State.SAVED,
    })
    const window = createWindow('window-1' as UID, [openTab, savedTab], {
      id: 20,
      state: State.OPEN,
    })
    vi.spyOn(OnCreatedQueue, 'createTabAndWait').mockRejectedValue(
      new Error('Firefox refused tab creation'),
    )

    await expect(
      Tree.openTab({ tabUid: savedTab.uid, windowUid: window.uid }),
    ).rejects.toThrow('Firefox refused tab creation')
    expect(savedTab.state).toBe(State.SAVED)
    expect(savedTab.id).toBe(-1)
  })

  it('rejects and removes a created tab returned for the wrong window', async () => {
    const openTab = createTab('open-tab' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const savedTab = createTab('saved-tab' as UID, {
      id: -1,
      state: State.SAVED,
    })
    const window = createWindow('window-1' as UID, [openTab, savedTab], {
      id: 20,
      state: State.OPEN,
    })
    vi.spyOn(OnCreatedQueue, 'createTabAndWait').mockResolvedValue({
      id: 30,
      windowId: 999,
      index: 0,
    } as browser.tabs.Tab)

    await expect(
      Tree.openTab({ tabUid: savedTab.uid, windowUid: window.uid }),
    ).rejects.toThrow('Tab creation returned an unexpected window ID')

    expect(browser.tabs.remove).toHaveBeenCalledWith(30)
    expect(savedTab).toMatchObject({ id: -1, state: State.SAVED })
    expect(window).toMatchObject({ id: 20, state: State.OPEN })
    expectTreeInvariants()
  })

  it('rolls back recreated container metadata when browser tab creation fails', async () => {
    const oldContainer = {
      cookieStoreId: 'firefox-container-missing',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
      iconUrl: 'resource://usercontext-content/briefcase.svg',
    }
    const replacement = {
      ...oldContainer,
      cookieStoreId: 'firefox-container-new',
    }
    vi.mocked(fakeBrowser.contextualIdentities.query).mockResolvedValue([])
    vi.mocked(fakeBrowser.contextualIdentities.create).mockResolvedValue(
      replacement,
    )
    const openTab = createTab('open-tab' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const savedTab = createTab('saved-tab' as UID, {
      container: oldContainer,
      id: -1,
      state: State.SAVED,
    })
    const window = createWindow('window-1' as UID, [openTab, savedTab], {
      id: 20,
      state: State.OPEN,
    })
    vi.spyOn(OnCreatedQueue, 'createTabAndWait').mockRejectedValue(
      new Error('Firefox refused tab creation'),
    )

    await expect(
      Tree.openTab({
        tabUid: savedTab.uid,
        windowUid: window.uid,
        containerRecovery: 'recreate',
        containerRecoveryStoreIds: [oldContainer.cookieStoreId],
      }),
    ).rejects.toThrow('Firefox refused tab creation')

    expect(savedTab.container).toEqual(oldContainer)
    expect(savedTab.state).toBe(State.SAVED)
    expect(fakeBrowser.contextualIdentities.remove).toHaveBeenCalledWith(
      replacement.cookieStoreId,
    )
  })

  it('creates a private window when opening a tab from a saved private window', async () => {
    const tab = createTab('saved-private-tab' as UID, {
      id: -1,
      state: State.SAVED,
      url: 'https://example.test/private',
    })
    const window = createWindow('window-private' as UID, [tab], {
      id: -1,
      incognito: true,
      state: State.SAVED,
    })
    vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockResolvedValue({
      id: 30,
      alwaysOnTop: false,
      focused: false,
      incognito: true,
      tabs: [{ id: 31 } as browser.tabs.Tab],
    } as browser.windows.Window)

    await Tree.openTab({ tabUid: tab.uid, windowUid: window.uid })

    expect(OnCreatedQueue.createWindowAndWait).toHaveBeenCalledWith({
      incognito: true,
      url: tab.url,
    })
    expect(window.id).toBe(30)
    expect(window.incognito).toBe(true)
    expect(tab.id).toBe(31)
    expect(tab.state).toBe(State.OPEN)
    expectTreeInvariants()
  })

  it('creates a normal Firefox window when a saved tab has no live destination', async () => {
    const tab = createTab('saved-tab' as UID, {
      id: -1,
      state: State.SAVED,
      url: 'https://example.test/saved',
    })
    const window = createWindow('window-1' as UID, [tab], {
      id: -1,
      incognito: false,
      state: State.SAVED,
    })
    vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockResolvedValue({
      id: 30,
      tabs: [{ id: 31 }],
    } as browser.windows.Window)

    await Tree.openTab({ tabUid: tab.uid, windowUid: window.uid })

    expect(OnCreatedQueue.createWindowAndWait).toHaveBeenCalledWith({
      incognito: false,
      url: tab.url,
    })
    expect(window).toMatchObject({ id: 30, state: State.OPEN })
    expect(tab).toMatchObject({ id: 31, state: State.OPEN })
    expect(Tree.windowsByUid.get(window.uid)).toBe(window)
    expect(Tree.tabsByUid.get(tab.uid)).toBe(tab)
    expectTreeInvariants()
  })

  it('normalizes saved-window bounds when opening a saved tab', async () => {
    Settings.values.openWindowsInSameLocation = true
    const tab = createTab('saved-tab' as UID, {
      id: -1,
      state: State.SAVED,
      url: 'https://example.test/saved',
    })
    const window = createWindow('window-1' as UID, [tab], {
      id: -1,
      state: State.SAVED,
      windowPosition: {
        left: 0,
        top: -400,
        width: 0,
        height: 700,
      },
    })
    const createWindowAndWait = vi
      .spyOn(OnCreatedQueue, 'createWindowAndWait')
      .mockResolvedValue({
        id: 30,
        tabs: [{ id: 31 } as browser.tabs.Tab],
      } as browser.windows.Window)

    await Tree.openTab({ tabUid: tab.uid, windowUid: window.uid })

    expect(createWindowAndWait).toHaveBeenCalledWith({
      incognito: false,
      url: tab.url,
      left: 0,
      top: -400,
      height: 700,
    })
    expectTreeInvariants()
  })

  it('does not open a saved private tab when Firefox private access is denied', async () => {
    const tab = createTab('saved-private-tab' as UID, {
      id: -1,
      state: State.SAVED,
      url: 'https://example.test/private',
    })
    const window = createWindow('window-private' as UID, [tab], {
      id: -1,
      incognito: true,
      state: State.SAVED,
    })
    fakeBrowser.extension.isAllowedIncognitoAccess?.mockResolvedValue(false)
    const createWindowAndWait = vi
      .spyOn(OnCreatedQueue, 'createWindowAndWait')
      .mockResolvedValue({
        id: 30,
        tabs: [{ id: 31 } as browser.tabs.Tab],
      } as browser.windows.Window)
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await Tree.openTab({ tabUid: tab.uid, windowUid: window.uid })

    expect(createWindowAndWait).not.toHaveBeenCalled()
    expect(browser.windows.create).not.toHaveBeenCalled()
    expect(browser.tabs.create).not.toHaveBeenCalled()
    expect(window).toMatchObject({ id: -1, state: State.SAVED })
    expect(tab).toMatchObject({ id: -1, state: State.SAVED })
    expect(consoleWarn).toHaveBeenCalledWith(
      'Cannot open saved private tab without Firefox private-window access',
    )
    expectTreeInvariants()
  })

  it('checks a saved tab actual private window when the command window is stale', async () => {
    const tab = createTab('saved-private-tab' as UID, {
      id: -1,
      state: State.SAVED,
      url: 'https://example.test/private',
    })
    createWindow('window-private' as UID, [tab], {
      id: -1,
      incognito: true,
      state: State.SAVED,
    })
    const staleWindow = createWindow('window-normal' as UID, [], {
      id: -1,
      incognito: false,
      state: State.SAVED,
    })
    fakeBrowser.extension.isAllowedIncognitoAccess?.mockResolvedValue(false)
    const createWindowAndWait = vi
      .spyOn(OnCreatedQueue, 'createWindowAndWait')
      .mockResolvedValue({
        id: 30,
        tabs: [{ id: 31 } as browser.tabs.Tab],
      } as browser.windows.Window)
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await Tree.openTab({
      tabUid: tab.uid,
      windowUid: staleWindow.uid,
    })

    expect(createWindowAndWait).not.toHaveBeenCalled()
    expect(tab).toMatchObject({ id: -1, state: State.SAVED })
    expectTreeInvariants()
  })

  it('does not open a saved private window when Firefox private access is denied', async () => {
    const tab = createTab('saved-private-tab' as UID, {
      id: -1,
      state: State.SAVED,
      url: 'https://example.test/private',
    })
    const window = createWindow('window-private' as UID, [tab], {
      id: -1,
      incognito: true,
      state: State.SAVED,
    })
    fakeBrowser.extension.isAllowedIncognitoAccess?.mockResolvedValue(false)
    const createWindowAndWait = vi
      .spyOn(OnCreatedQueue, 'createWindowAndWait')
      .mockResolvedValue({
        id: 30,
        tabs: [{ id: 31 } as browser.tabs.Tab],
      } as browser.windows.Window)
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await Tree.openWindow({ windowUid: window.uid })

    expect(createWindowAndWait).not.toHaveBeenCalled()
    expect(browser.windows.create).not.toHaveBeenCalled()
    expect(browser.tabs.create).not.toHaveBeenCalled()
    expect(window).toMatchObject({ id: -1, state: State.SAVED })
    expect(tab).toMatchObject({ id: -1, state: State.SAVED })
    expect(consoleWarn).toHaveBeenCalledWith(
      'Cannot open saved private window without Firefox private-window access',
    )
    expectTreeInvariants()
  })

  it('removes a saved note-only window from the tree without calling browser.windows.remove', () => {
    const note = createNote('note-1' as UID)
    const childNote = createNote('note-child' as UID, {
      parentUid: note.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [note, childNote], {
      id: -1,
      state: State.SAVED,
    })

    Tree.closeWindow({ windowId: -1, windowUid: window.uid })

    expect(browser.windows.remove).not.toHaveBeenCalled()
    expect(Tree.windowsByUid.has(window.uid)).toBe(false)
    expect(Tree.notesByUid.has(note.uid)).toBe(false)
    expect(Tree.notesByUid.has(childNote.uid)).toBe(false)
    expectTreeInvariants()
  })

  it('removes an open note-only window from the tree and closes the browser window', async () => {
    const note = createNote('note-1' as UID)
    const window = createWindow('window-1' as UID, [note], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.windows.get).mockResolvedValue({
      id: window.id,
    } as browser.windows.Window)

    await Tree.closeWindow({ windowId: window.id, windowUid: window.uid })

    expect(Tree.windowsByUid.has(window.uid)).toBe(false)
    expect(Tree.notesByUid.has(note.uid)).toBe(false)
    await vi.waitFor(() => {
      expect(browser.windows.remove).toHaveBeenCalledWith(window.id)
    })
    expectTreeInvariants()
  })

  it('restores the original tree position when browser tab move rejects', async () => {
    const firstTab = createTab('tab-first' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const movedTab = createTab('tab-moved' as UID, {
      id: 11,
      state: State.OPEN,
    })
    const window = createWindow('window-1' as UID, [firstTab, movedTab], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.tabs.move).mockRejectedValue(new Error('move failed'))

    await expect(
      Tree.moveTab(movedTab.uid, window.uid, 0, undefined, false, false),
    ).rejects.toThrow('move failed')

    expect(window.children.map((item) => item.uid)).toEqual([
      firstTab.uid,
      movedTab.uid,
    ])
    expectTreeInvariants()
  })

  it('rebinds the stable tab UID when Firefox returns a new ID after moving', async () => {
    const firstTab = createTab('tab-first' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const movedTab = createTab('tab-moved' as UID, {
      id: 11,
      state: State.OPEN,
    })
    const window = createWindow('window-1' as UID, [firstTab, movedTab], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.tabs.move).mockResolvedValue({
      id: 77,
      windowId: window.id,
      index: 0,
    } as browser.tabs.Tab)

    await Tree.moveTab(movedTab.uid, window.uid, 0, undefined, false, false)

    expect(window.children.map((item) => item.uid)).toEqual([
      movedTab.uid,
      firstTab.uid,
    ])
    expect(Tree.tabsByUid.get(movedTab.uid)).toMatchObject({
      id: 77,
      uid: movedTab.uid,
      windowUid: window.uid,
    })
    expect(
      Tree.getTabs(window.children).some((tab) => tab.id === movedTab.id),
    ).toBe(false)
    expectTreeInvariants()
  })

  it.each([
    {
      scenario: 'rejects',
      setupCreateWindow: () => {
        const error = new Error('create failed')
        vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockRejectedValue(error)
        return error
      },
      expectedError: 'create failed',
    },
    {
      scenario: 'returns undefined',
      setupCreateWindow: () => {
        vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockResolvedValue(
          undefined as unknown as browser.windows.Window,
        )
        return undefined
      },
      expectedError: 'Window creation returned no window or tab ID',
    },
  ])(
    'rolls back saved tab and window state when opening a saved tab $scenario',
    async ({ setupCreateWindow, expectedError }) => {
      const tab = createTab('tab-1' as UID, {
        id: -1,
        state: State.SAVED,
        url: 'https://example.test/saved-tab',
      })
      const window = createWindow('window-1' as UID, [tab], {
        id: -1,
        state: State.SAVED,
      })
      setupCreateWindow()

      await expect(
        Tree.openTab({
          tabUid: tab.uid,
          windowUid: window.uid,
        }),
      ).rejects.toThrow(expectedError)

      expect(OnCreatedQueue.createWindowAndWait).toHaveBeenCalledWith({
        incognito: false,
        url: tab.url,
      })
      expect(window.state).toBe(State.SAVED)
      expect(window.id).toBe(-1)
      expect(tab.state).toBe(State.SAVED)
      expect(tab.id).toBe(-1)
      expect(browser.windows.create).not.toHaveBeenCalled()
      expect(browser.tabs.create).not.toHaveBeenCalled()
      expectTreeInvariants()
    },
  )
})
