import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import {
  beginWindowClassification,
  finishWindowClassification,
  handleCreatedTab,
  handleCreatedWindow,
  waitForWindowClassification,
} from '@/services/background-session-restore'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Settings } from '@/services/settings'
import { Tree } from '@/services/background-tree'
import { State, Tab, TreeItemType } from '@/types/session-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import {
  createNote,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'

function browserTab(
  id: number,
  index: number,
  overrides: Partial<browser.tabs.Tab> = {},
): browser.tabs.Tab {
  return {
    active: index === 0,
    discarded: false,
    highlighted: index === 0,
    id,
    incognito: false,
    index,
    pinned: false,
    status: 'complete',
    title: `Browser tab ${id}`,
    url: `https://example.test/${id}`,
    windowId: 30,
    ...overrides,
  }
}

describe('Firefox-restored windows', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    installFakeBrowser()
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })

  it('buffers tab handling until a new window is classified', async () => {
    beginWindowClassification(30)
    let resolved = false
    const classification = waitForWindowClassification(30).then((value) => {
      resolved = true
      return value
    })
    await Promise.resolve()
    expect(resolved).toBe(false)

    finishWindowClassification(30, 'new-window')

    await expect(classification).resolves.toBe('new-window')
  })

  it('reconnects matching children, adds unmatched tabs, and retains absent saved children', async () => {
    const parent = createNote('note-parent' as UID, { isParent: true })
    const matching = createTab('tab-matching' as UID, {
      id: -1,
      state: State.SAVED,
      parentUid: parent.uid,
      indentLevel: 2,
      customLabel: 'Keep structure',
    })
    const absent = createTab('tab-absent' as UID, {
      id: -1,
      state: State.SAVED,
    })
    const savedWindow = createWindow(
      'window-saved' as UID,
      [parent, matching, absent],
      { id: -1, state: State.SAVED, title: 'Saved window' },
    )
    const restoredMatching = browserTab(101, 0)
    const restoredUnmatched = browserTab(102, 1)
    vi.mocked(browser.sessions.getWindowValue).mockResolvedValue({
      version: 1,
      uid: savedWindow.uid,
    })
    vi.mocked(browser.sessions.getTabValue).mockImplementation(async (tabId) =>
      tabId === 101 ? { version: 1, uid: matching.uid } : undefined,
    )
    vi.mocked(browser.windows.get).mockResolvedValue({
      alwaysOnTop: false,
      id: 30,
      focused: true,
      incognito: false,
      tabs: [restoredMatching, restoredUnmatched],
    })

    await expect(
      handleCreatedWindow({ id: 30 } as browser.windows.Window),
    ).resolves.toBe(true)

    expect(Tree.Items).toEqual([savedWindow])
    expect(savedWindow).toMatchObject({
      id: 30,
      state: State.OPEN,
      title: 'Saved window',
    })
    expect(matching).toMatchObject({
      uid: 'tab-matching',
      id: 101,
      state: State.OPEN,
      parentUid: parent.uid,
      indentLevel: 2,
      customLabel: 'Keep structure',
    })
    expect(absent).toMatchObject({ id: -1, state: State.SAVED })
    const fresh = Tree.getTabs(savedWindow.children).find(
      (tab) => tab.id === 102,
    )
    expect(fresh).toMatchObject({
      state: State.OPEN,
      title: 'Browser tab 102',
      windowUid: savedWindow.uid,
    })
    expect(fresh?.uid).not.toBe(matching.uid)
    expect(savedWindow.children[0]).toBe(parent)
  })

  it('retries a child identity read that hangs while Firefox restores the window', async () => {
    vi.useFakeTimers()
    try {
      const savedTab = createTab('tab-saved' as UID, {
        id: -1,
        state: State.SAVED,
      })
      const savedWindow = createWindow('window-saved' as UID, [savedTab], {
        id: -1,
        state: State.SAVED,
      })
      const restoredTab = browserTab(101, 0)
      vi.mocked(browser.sessions.getWindowValue).mockResolvedValue({
        version: 1,
        uid: savedWindow.uid,
      })
      vi.mocked(browser.sessions.getTabValue)
        .mockImplementationOnce(() => new Promise(() => undefined))
        .mockResolvedValue({ version: 1, uid: savedTab.uid })
      vi.mocked(browser.windows.get).mockResolvedValue({
        alwaysOnTop: false,
        id: 30,
        focused: true,
        incognito: false,
        tabs: [restoredTab],
      })

      const restoration = handleCreatedWindow({
        id: 30,
      } as browser.windows.Window)
      let settled = false
      void restoration.then(() => {
        settled = true
      })

      await vi.advanceTimersByTimeAsync(1_000)

      expect(settled).toBe(true)
      await expect(restoration).resolves.toBe(true)
      expect(savedTab).toMatchObject({ id: 101, state: State.OPEN })
      expect(browser.sessions.getTabValue).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries a child identity that is briefly unavailable during restoration', async () => {
    vi.useFakeTimers()
    try {
      const savedTab = createTab('tab-saved' as UID, {
        id: -1,
        state: State.SAVED,
      })
      const savedWindow = createWindow(
        'window-saved' as UID,
        [savedTab],
        { id: -1, state: State.SAVED },
      )
      const restoredTab = browserTab(101, 0)
      vi.mocked(browser.sessions.getWindowValue).mockResolvedValue({
        version: 1,
        uid: savedWindow.uid,
      })
      vi.mocked(browser.sessions.getTabValue)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValue({ version: 1, uid: savedTab.uid })
      vi.mocked(browser.windows.get).mockResolvedValue({
        alwaysOnTop: false,
        id: 30,
        focused: true,
        incognito: false,
        tabs: [restoredTab],
      })

      const restoration = handleCreatedWindow({
        id: 30,
      } as browser.windows.Window)
      await vi.advanceTimersByTimeAsync(500)

      await expect(restoration).resolves.toBe(true)
      expect(savedTab).toMatchObject({ id: 101, state: State.OPEN })
      expect(browser.sessions.getTabValue).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets only one concurrent restoration claim a saved window UID', async () => {
    const savedWindow = createWindow('window-saved' as UID, [], {
      id: -1,
      state: State.SAVED,
    })
    vi.mocked(browser.sessions.getWindowValue).mockResolvedValue({
      version: 1,
      uid: savedWindow.uid,
    })
    let finishFirstGet: ((window: browser.windows.Window) => void) | undefined
    vi.mocked(browser.windows.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirstGet = resolve
        }),
    )
    const firstRestoration = handleCreatedWindow({
      id: 30,
    } as browser.windows.Window)
    await vi.waitFor(() => {
      expect(browser.windows.get).toHaveBeenCalledWith(30, { populate: true })
    })

    await expect(
      handleCreatedWindow({ id: 31 } as browser.windows.Window),
    ).resolves.toBe(false)
    expect(browser.windows.get).toHaveBeenCalledTimes(1)

    finishFirstGet?.({
      alwaysOnTop: false,
      id: 30,
      focused: true,
      incognito: false,
      tabs: [],
    })
    await expect(firstRestoration).resolves.toBe(true)
    expect(savedWindow).toMatchObject({ id: 30, state: State.OPEN })
  })

  it('blocks a restored tab while a restored window claims its saved target', async () => {
    const savedTab = createTab('tab-saved' as UID, {
      id: -1,
      state: State.SAVED,
    })
    const savedWindow = createWindow('window-saved' as UID, [savedTab], {
      id: -1,
      state: State.SAVED,
    })
    vi.mocked(browser.sessions.getWindowValue).mockResolvedValue({
      version: 1,
      uid: savedWindow.uid,
    })
    vi.mocked(browser.sessions.getTabValue).mockResolvedValue({
      version: 1,
      uid: savedTab.uid,
    })
    let finishWindowGet: ((window: browser.windows.Window) => void) | undefined
    vi.mocked(browser.windows.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishWindowGet = resolve
        }),
    )
    const createWindowAndWait = vi.spyOn(OnCreatedQueue, 'createWindowAndWait')

    const windowRestoration = handleCreatedWindow({
      id: 30,
    } as browser.windows.Window)
    await vi.waitFor(() => {
      expect(browser.windows.get).toHaveBeenCalledWith(30, { populate: true })
    })

    await expect(
      handleCreatedTab(browserTab(101, 0, { windowId: 99 })),
    ).resolves.toBe(false)
    expect(createWindowAndWait).not.toHaveBeenCalled()

    finishWindowGet?.({
      alwaysOnTop: false,
      id: 30,
      focused: true,
      incognito: false,
      tabs: [],
    })
    await expect(windowRestoration).resolves.toBe(true)
    expect(savedWindow).toMatchObject({ id: 30, state: State.OPEN })
    expect(savedTab).toMatchObject({ id: -1, state: State.SAVED })
  })

  it.each([
    ['setting disabled', false, State.SAVED],
    ['target already open', true, State.OPEN],
  ] as const)(
    'uses the new-window path when %s',
    async (_label, enabled, targetState) => {
      Settings.values.reconnectFirefoxRestoredItems = enabled
      const target = createWindow('window-saved' as UID, [], {
        id: targetState === State.OPEN ? 20 : -1,
        state: targetState,
      })
      vi.mocked(browser.sessions.getWindowValue).mockResolvedValue({
        version: 1,
        uid: target.uid,
      })

      await expect(
        handleCreatedWindow({ id: 30 } as browser.windows.Window),
      ).resolves.toBe(false)

      expect(target.state).toBe(targetState)
    },
  )

  it('does not reconnect a child UID that belongs to another window', async () => {
    const foreignTab = createTab('tab-foreign' as UID, {
      id: -1,
      state: State.SAVED,
    })
    createWindow('window-foreign' as UID, [foreignTab], {
      id: -1,
      state: State.SAVED,
    })
    const savedWindow = createWindow('window-saved' as UID, [], {
      id: -1,
      state: State.SAVED,
    })
    const restored = browserTab(101, 0)
    vi.mocked(browser.sessions.getWindowValue).mockResolvedValue({
      version: 1,
      uid: savedWindow.uid,
    })
    vi.mocked(browser.sessions.getTabValue).mockResolvedValue({
      version: 1,
      uid: foreignTab.uid,
    })
    vi.mocked(browser.windows.get).mockResolvedValue({
      alwaysOnTop: false,
      id: 30,
      focused: true,
      incognito: false,
      tabs: [restored],
    })

    await handleCreatedWindow({ id: 30 } as browser.windows.Window)

    expect(foreignTab).toMatchObject({ id: -1, state: State.SAVED })
    expect(
      savedWindow.children.some(
        (item) => item.type === TreeItemType.TAB && (item as Tab).id === 101,
      ),
    ).toBe(true)
  })

  it('restores saved browser order, pinning, and groups after window rebinding', async () => {
    const first = createTab('tab-first' as UID, {
      id: -1,
      state: State.SAVED,
      pinned: true,
      tabGroup: {
        uid: 'group-1' as UID,
        id: -1,
        color: 'blue',
        collapsed: false,
      },
    })
    const second = createTab('tab-second' as UID, {
      id: -1,
      state: State.SAVED,
      tabGroup: {
        uid: 'group-1' as UID,
        id: -1,
        color: 'blue',
        collapsed: false,
      },
    })
    const savedWindow = createWindow('window-saved' as UID, [first, second], {
      id: -1,
      state: State.SAVED,
    })
    const restoredSecond = browserTab(102, 0)
    const restoredFirst = browserTab(101, 1, { pinned: false })
    vi.mocked(browser.sessions.getWindowValue).mockResolvedValue({
      version: 1,
      uid: savedWindow.uid,
    })
    vi.mocked(browser.sessions.getTabValue).mockImplementation(
      async (tabId) => ({
        version: 1,
        uid: tabId === 101 ? first.uid : second.uid,
      }),
    )
    vi.mocked(browser.windows.get).mockResolvedValue({
      alwaysOnTop: false,
      id: 30,
      focused: true,
      incognito: false,
      tabs: [restoredSecond, restoredFirst],
    })
    const restoreTabGroup = vi
      .spyOn(Tree, 'restoreTabGroup')
      .mockResolvedValue(undefined)

    await handleCreatedWindow({ id: 30 } as browser.windows.Window)

    expect(browser.tabs.move).toHaveBeenCalledTimes(1)
    expect(browser.tabs.move).toHaveBeenCalledWith(101, {
      windowId: 30,
      index: 0,
    })
    expect(browser.tabs.update).toHaveBeenCalledWith(101, { pinned: true })
    expect(restoreTabGroup).toHaveBeenCalledTimes(1)
    expect(restoreTabGroup).toHaveBeenCalledWith(first.uid)
    expect(
      vi.mocked(browser.tabs.move).mock.invocationCallOrder[0],
    ).toBeLessThan(restoreTabGroup.mock.invocationCallOrder[0])
  })

  it('rejects a restored window whose private state differs from the saved window', async () => {
    const savedWindow = createWindow('window-private' as UID, [], {
      id: -1,
      state: State.SAVED,
      incognito: true,
    })
    vi.mocked(browser.sessions.getWindowValue).mockResolvedValue({
      version: 1,
      uid: savedWindow.uid,
    })
    vi.mocked(browser.windows.get).mockResolvedValue({
      alwaysOnTop: false,
      id: 30,
      focused: true,
      incognito: false,
      tabs: [],
    })

    await expect(
      handleCreatedWindow({ id: 30 } as browser.windows.Window),
    ).resolves.toBe(false)

    expect(savedWindow).toMatchObject({ id: -1, state: State.SAVED })
  })

  it('leaves a saved private window untouched without private access', async () => {
    const savedWindow = createWindow('window-private' as UID, [], {
      id: -1,
      state: State.SAVED,
      incognito: true,
    })
    vi.mocked(browser.sessions.getWindowValue).mockResolvedValue({
      version: 1,
      uid: savedWindow.uid,
    })
    vi.mocked(browser.windows.get).mockResolvedValue({
      alwaysOnTop: false,
      id: 30,
      focused: true,
      incognito: true,
      tabs: [],
    })
    vi.mocked(browser.extension.isAllowedIncognitoAccess!).mockResolvedValue(
      false,
    )

    await expect(
      handleCreatedWindow({ id: 30 } as browser.windows.Window),
    ).resolves.toBe(false)

    expect(savedWindow).toMatchObject({ id: -1, state: State.SAVED })
  })
})
