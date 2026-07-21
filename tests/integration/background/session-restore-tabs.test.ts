import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import {
  handleCreatedTab,
  handleCreatedWindow,
  isTabRelocating,
} from '@/services/background-session-restore'
import { Settings } from '@/services/settings'
import { Tree } from '@/services/background-tree'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { State } from '@/types/session-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import {
  createNote,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'

function restoredTab(
  overrides: Partial<browser.tabs.Tab> = {},
): browser.tabs.Tab {
  return {
    active: true,
    discarded: false,
    highlighted: true,
    id: 101,
    incognito: false,
    index: 0,
    pinned: false,
    status: 'complete',
    title: 'Restored title',
    url: 'https://example.test/restored',
    windowId: 20,
    ...overrides,
  }
}

describe('Firefox-restored tabs', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    installFakeBrowser()
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })

  it('reconnects a restored browser tab to its saved tree item (EV-29)', async () => {
    const parent = createNote('note-parent' as UID, { isParent: true })
    const savedTab = createTab('tab-saved' as UID, {
      id: -1,
      state: State.SAVED,
      parentUid: parent.uid,
      indentLevel: 2,
      customLabel: 'Keep me',
    })
    const window = createWindow('window-1' as UID, [parent, savedTab], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.sessions.getTabValue).mockResolvedValue({
      version: 1,
      uid: savedTab.uid,
    })
    const originalTabCount = Tree.tabsByUid.size

    await expect(handleCreatedTab(restoredTab())).resolves.toBe(true)

    expect(Tree.tabsByUid.size).toBe(originalTabCount)
    expect(Tree.tabsByUid.get(savedTab.uid)).toMatchObject({
      uid: savedTab.uid,
      id: 101,
      state: State.OPEN,
      parentUid: parent.uid,
      indentLevel: 2,
      customLabel: 'Keep me',
      title: 'Restored title',
      url: 'https://example.test/restored',
      windowUid: window.uid,
    })
  })

  it('moves a restored tab to its saved live-tab position while claiming events', async () => {
    const firstOpen = createTab('tab-first' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const savedTab = createTab('tab-saved' as UID, {
      id: -1,
      state: State.SAVED,
    })
    const lastOpen = createTab('tab-last' as UID, {
      id: 11,
      state: State.OPEN,
    })
    createWindow('window-1' as UID, [firstOpen, savedTab, lastOpen], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.sessions.getTabValue).mockResolvedValue({
      version: 1,
      uid: savedTab.uid,
    })
    let finishMove: ((tab: browser.tabs.Tab) => void) | undefined
    vi.mocked(browser.tabs.move).mockReturnValueOnce(
      new Promise((resolve) => {
        finishMove = resolve
      }),
    )
    const tab = restoredTab({ windowId: 99, index: 0 })

    const restoration = handleCreatedTab(tab)
    await vi.waitFor(() => {
      expect(browser.tabs.move).toHaveBeenCalledWith(101, {
        windowId: 20,
        index: 1,
      })
    })
    expect(isTabRelocating(101)).toBe(true)
    finishMove?.(tab)

    await expect(restoration).resolves.toBe(true)
    expect(isTabRelocating(101)).toBe(false)
  })

  it('lets only one concurrent restoration claim a saved tab UID', async () => {
    const savedTab = createTab('tab-saved' as UID, {
      id: -1,
      state: State.SAVED,
    })
    createWindow('window-1' as UID, [savedTab], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.sessions.getTabValue).mockResolvedValue({
      version: 1,
      uid: savedTab.uid,
    })
    let finishFirstMove: ((tab: browser.tabs.Tab) => void) | undefined
    vi.mocked(browser.tabs.move).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirstMove = resolve
        }),
    )
    const firstTab = restoredTab({ id: 101, windowId: 99 })
    const secondTab = restoredTab({ id: 102, windowId: 99 })

    const firstRestoration = handleCreatedTab(firstTab)
    await vi.waitFor(() => {
      expect(browser.tabs.move).toHaveBeenCalledWith(101, {
        windowId: 20,
        index: 0,
      })
    })

    await expect(handleCreatedTab(secondTab)).resolves.toBe(false)
    expect(browser.tabs.move).toHaveBeenCalledTimes(1)

    finishFirstMove?.(firstTab)
    await expect(firstRestoration).resolves.toBe(true)
    expect(savedTab).toMatchObject({ id: 101, state: State.OPEN })
  })

  it('blocks a restored window while a restored tab claims its saved target window', async () => {
    const savedTab = createTab('tab-saved' as UID, {
      id: -1,
      state: State.SAVED,
    })
    const savedWindow = createWindow('window-saved' as UID, [savedTab], {
      id: -1,
      state: State.SAVED,
    })
    vi.mocked(browser.sessions.getTabValue).mockResolvedValue({
      version: 1,
      uid: savedTab.uid,
    })
    vi.mocked(browser.sessions.getWindowValue).mockResolvedValue({
      version: 1,
      uid: savedWindow.uid,
    })
    let finishCreate: ((window: browser.windows.Window) => void) | undefined
    vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCreate = resolve
        }),
    )

    const tabRestoration = handleCreatedTab(restoredTab({ windowId: 99 }))
    await vi.waitFor(() => {
      expect(OnCreatedQueue.createWindowAndWait).toHaveBeenCalled()
    })

    await expect(
      handleCreatedWindow({ id: 30 } as browser.windows.Window),
    ).resolves.toBe(false)
    expect(browser.windows.get).not.toHaveBeenCalled()

    finishCreate?.({
      alwaysOnTop: false,
      id: 40,
      focused: true,
      incognito: false,
      tabs: [{ id: 101, active: true } as browser.tabs.Tab],
    })
    await expect(tabRestoration).resolves.toBe(true)
    expect(savedWindow).toMatchObject({ id: 40, state: State.OPEN })
  })

  it('creates a saved target window around the already restored tab', async () => {
    const savedTab = createTab('tab-saved' as UID, {
      id: -1,
      state: State.SAVED,
    })
    const otherSavedTab = createTab('tab-other' as UID, {
      id: -1,
      state: State.SAVED,
    })
    const savedWindow = createWindow(
      'window-saved' as UID,
      [savedTab, otherSavedTab],
      { id: -1, state: State.SAVED },
    )
    vi.mocked(browser.sessions.getTabValue).mockResolvedValue({
      version: 1,
      uid: savedTab.uid,
    })
    const createWindowAndWait = vi
      .spyOn(OnCreatedQueue, 'createWindowAndWait')
      .mockResolvedValue({
        alwaysOnTop: false,
        id: 30,
        focused: true,
        incognito: false,
        tabs: [{ id: 101, pinned: false } as browser.tabs.Tab],
      })

    await expect(handleCreatedTab(restoredTab({ windowId: 99 }))).resolves.toBe(
      true,
    )

    expect(createWindowAndWait).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 101 }),
    )
    expect(savedWindow).toMatchObject({
      id: 30,
      state: State.OPEN,
      active: true,
      activeTabId: 101,
    })
    expect(savedTab).toMatchObject({
      id: 101,
      state: State.OPEN,
      windowUid: savedWindow.uid,
    })
    expect(otherSavedTab).toMatchObject({ id: -1, state: State.SAVED })
    expect(Tree.Items).toEqual([savedWindow])
    expect(browser.tabs.create).not.toHaveBeenCalled()
  })

  it('reconciles pinning and group membership after browser placement', async () => {
    const savedTab = createTab('tab-saved' as UID, {
      id: -1,
      state: State.SAVED,
      pinned: true,
      tabGroup: {
        uid: 'group-1' as UID,
        id: -1,
        title: 'Saved group',
        color: 'blue',
        collapsed: false,
      },
    })
    createWindow('window-1' as UID, [savedTab], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.sessions.getTabValue).mockResolvedValue({
      version: 1,
      uid: savedTab.uid,
    })
    const restoreTabGroup = vi
      .spyOn(Tree, 'restoreTabGroup')
      .mockResolvedValue(undefined)

    await handleCreatedTab(
      restoredTab({ windowId: 99, index: 2, pinned: false }),
    )

    expect(browser.tabs.move).toHaveBeenCalledWith(101, {
      windowId: 20,
      index: 0,
    })
    expect(browser.tabs.update).toHaveBeenCalledWith(101, { pinned: true })
    expect(restoreTabGroup).toHaveBeenCalledWith(savedTab.uid)
    expect(
      vi.mocked(browser.tabs.move).mock.invocationCallOrder[0],
    ).toBeLessThan(restoreTabGroup.mock.invocationCallOrder[0])
  })

  it('keeps a reconnected tab when secondary group restoration fails', async () => {
    const savedTab = createTab('tab-saved' as UID, {
      id: -1,
      state: State.SAVED,
      tabGroup: {
        uid: 'group-1' as UID,
        id: -1,
        color: 'blue',
        collapsed: false,
      },
    })
    createWindow('window-1' as UID, [savedTab], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.sessions.getTabValue).mockResolvedValue({
      version: 1,
      uid: savedTab.uid,
    })
    const error = new Error('group API failed')
    vi.spyOn(Tree, 'restoreTabGroup').mockRejectedValue(error)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(handleCreatedTab(restoredTab())).resolves.toBe(true)

    expect(savedTab).toMatchObject({
      uid: 'tab-saved',
      id: 101,
      state: State.OPEN,
    })
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to restore metadata for Firefox-restored tab:',
      error,
    )
  })

  it('does not create a saved private target window without private access', async () => {
    const savedTab = createTab('tab-private' as UID, {
      id: -1,
      state: State.SAVED,
    })
    createWindow('window-private' as UID, [savedTab], {
      id: -1,
      state: State.SAVED,
      incognito: true,
    })
    vi.mocked(browser.sessions.getTabValue).mockResolvedValue({
      version: 1,
      uid: savedTab.uid,
    })
    vi.mocked(browser.extension.isAllowedIncognitoAccess!).mockResolvedValue(
      false,
    )
    const createWindowAndWait = vi.spyOn(OnCreatedQueue, 'createWindowAndWait')

    await expect(
      handleCreatedTab(restoredTab({ incognito: true, windowId: 99 })),
    ).resolves.toBe(false)

    expect(createWindowAndWait).not.toHaveBeenCalled()
    expect(savedTab).toMatchObject({ id: -1, state: State.SAVED })
  })

  it('rejects a restored tab whose private state differs from its saved window', async () => {
    const savedTab = createTab('tab-private' as UID, {
      id: -1,
      state: State.SAVED,
    })
    createWindow('window-private' as UID, [savedTab], {
      id: 20,
      state: State.OPEN,
      incognito: true,
    })
    vi.mocked(browser.sessions.getTabValue).mockResolvedValue({
      version: 1,
      uid: savedTab.uid,
    })

    await expect(
      handleCreatedTab(restoredTab({ incognito: false })),
    ).resolves.toBe(false)

    expect(savedTab).toMatchObject({ id: -1, state: State.SAVED })
  })

  it.each([
    ['setting disabled', false, { version: 1, uid: 'tab-saved' }, State.SAVED],
    ['identity missing', true, undefined, State.SAVED],
    ['identity malformed', true, { version: 2, uid: 'tab-saved' }, State.SAVED],
    ['target missing', true, { version: 1, uid: 'tab-missing' }, State.SAVED],
    ['target open', true, { version: 1, uid: 'tab-saved' }, State.OPEN],
    [
      'target discarded',
      true,
      { version: 1, uid: 'tab-saved' },
      State.DISCARDED,
    ],
  ] as const)(
    'uses the new-item path when %s (EV-29)',
    async (_label, enabled, identity, targetState) => {
      Settings.values.reconnectFirefoxRestoredItems = enabled
      const target = createTab('tab-saved' as UID, {
        id: targetState === State.SAVED ? -1 : 10,
        state: targetState,
      })
      createWindow('window-1' as UID, [target], {
        id: 20,
        state: State.OPEN,
      })
      vi.mocked(browser.sessions.getTabValue).mockResolvedValue(identity)

      await expect(handleCreatedTab(restoredTab())).resolves.toBe(false)

      expect(target.id).toBe(targetState === State.SAVED ? -1 : 10)
      expect(target.state).toBe(targetState)
    },
  )
})
