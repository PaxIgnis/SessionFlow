import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Tree } from '@/services/background-tree'
import { State } from '@/types/session-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import {
  createNote,
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

  it('clears active state when saving the only open tab in an active window', () => {
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

    Tree.saveTab({ tabId: tab.id, tabUid: tab.uid })

    expect(window.state).toBe(State.SAVED)
    expect(window.id).toBe(-1)
    expect(window.active).toBe(false)
    expect(window.activeTabId).toBeUndefined()
    expect(tab.state).toBe(State.SAVED)
    expect(tab.active).toBe(false)
    expect(browser.tabs.remove).toHaveBeenCalledWith(10)
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

    Tree.closeWindow({ windowId: window.id, windowUid: window.uid })

    expect(Tree.windowsByUid.has(window.uid)).toBe(false)
    expect(Tree.notesByUid.has(note.uid)).toBe(false)
    await vi.waitFor(() => {
      expect(browser.windows.remove).toHaveBeenCalledWith(window.id)
    })
    expectTreeInvariants()
  })

  it('keeps tree state consistent when browser tab move rejects', async () => {
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
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(browser.tabs.move).mockRejectedValue(new Error('move failed'))

    await Tree.moveTab(movedTab.uid, window.uid, 0, undefined, false, false)

    expect(consoleError).toHaveBeenCalledWith(
      'Error moving tab in browser:',
      expect.any(Error),
    )
    expect(window.children.map((item) => item.uid)).toEqual([
      movedTab.uid,
      firstTab.uid,
    ])
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
