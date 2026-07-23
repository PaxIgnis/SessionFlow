import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Settings } from '@/services/settings'
import type { SessionTreeMessage } from '@/types/messages'
import {
  getDispatchCommand,
  loadBackgroundHandlers,
} from '../../helpers/background-handler-harness'
import {
  LoadingStatus,
  State,
  Tab as SessionTab,
  TreeItemType,
} from '@/types/session-tree'

describe('background handlers', () => {
  beforeEach(() => {
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.doUnmock('@/services/background-actions')
    vi.doUnmock('@/services/background-on-created-queue')
    vi.doUnmock('@/services/background-tree')
    vi.doUnmock('@/services/runtime-port-service')
    vi.doUnmock('@/services/selection')
  })

  it('registers browser, runtime, tab, and window event listeners', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()

    initializeListeners()

    expect(mocks.initializeSessionTreePort).toHaveBeenCalledWith({
      dispatchCommand: expect.any(Function),
      getSnapshot: expect.any(Function),
    })
    expect(
      fakeBrowser.browserAction.onClicked.listeners.length,
    ).toBeGreaterThan(0)
    expect(fakeBrowser.menus.onHidden.listeners.length).toBeGreaterThan(0)
    expect(fakeBrowser.runtime.onInstalled.listeners.length).toBeGreaterThan(0)
    expect(fakeBrowser.runtime.onMessage.listeners.length).toBeGreaterThan(0)
    expect(fakeBrowser.runtime.onStartup.listeners.length).toBeGreaterThan(0)
    expect(fakeBrowser.tabs.onActivated.listeners.length).toBeGreaterThan(0)
    expect(fakeBrowser.tabs.onAttached.listeners.length).toBeGreaterThan(0)
    expect(fakeBrowser.tabs.onCreated.listeners.length).toBeGreaterThan(0)
    expect(fakeBrowser.tabs.onDetached.listeners.length).toBeGreaterThan(0)
    expect(fakeBrowser.tabs.onMoved.listeners.length).toBeGreaterThan(0)
    expect(fakeBrowser.tabs.onRemoved.listeners.length).toBeGreaterThan(0)
    expect(fakeBrowser.tabs.onUpdated.listeners.length).toBeGreaterThan(0)
    expect(fakeBrowser.windows.onCreated.listeners.length).toBeGreaterThan(0)
    expect(fakeBrowser.windows.onFocusChanged.listeners.length).toBeGreaterThan(
      0,
    )
    expect(fakeBrowser.windows.onRemoved.listeners.length).toBeGreaterThan(0)
  })

  it('continues registering unrelated listeners when contextual identities are unavailable', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    delete (fakeBrowser as Partial<typeof fakeBrowser>).contextualIdentities

    expect(() => initializeListeners()).not.toThrow()
    expect(mocks.initializeSessionTreePort).toHaveBeenCalledOnce()
    expect(
      fakeBrowser.browserAction.onClicked.listeners.length,
    ).toBeGreaterThan(0)
    expect(fakeBrowser.tabs.onCreated.listeners.length).toBeGreaterThan(0)
  })

  it('saves a deleted group when its grouped tab removals arrive in either event order', async () => {
    vi.useFakeTimers()
    const { fakeBrowser, initializeListeners, mocks, settings } =
      await loadBackgroundHandlers()
    settings.values.saveTabsWhenTabGroupDeleted = true
    const group = {
      id: 7,
      windowId: 20,
      title: 'Research',
      color: 'blue',
      collapsed: false,
    } satisfies browser.tabGroups.TabGroup
    mocks.Items.push({
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      id: 20,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [
        {
          type: TreeItemType.TAB,
          uid: 'tab-1' as UID,
          id: 10,
          title: 'Grouped',
          url: 'https://example.test/grouped',
          windowUid: 'window-1' as UID,
          selected: false,
          state: State.OPEN,
          indentLevel: 1,
          pinned: false,
          tabGroup: {
            uid: 'group-uid' as UID,
            id: 7,
            title: 'Research',
            color: 'blue',
            collapsed: false,
          },
        },
      ],
    })
    initializeListeners()

    fakeBrowser.tabGroups.onRemoved.emit(group, { isWindowClosing: false })
    fakeBrowser.tabs.onRemoved.emit(10, {
      windowId: 20,
      isWindowClosing: false,
    })
    await vi.advanceTimersByTimeAsync(100)

    expect(mocks.tabGroupRemoved).toHaveBeenCalledWith(group, true)
    vi.useRealTimers()
  })

  it('does not save tabs when a group disappears without tab removals', async () => {
    vi.useFakeTimers()
    const { fakeBrowser, initializeListeners, mocks, settings } =
      await loadBackgroundHandlers()
    settings.values.saveTabsWhenTabGroupDeleted = true
    const group = {
      id: 7,
      windowId: 20,
      title: 'Research',
      color: 'blue',
      collapsed: false,
    } satisfies browser.tabGroups.TabGroup
    initializeListeners()

    fakeBrowser.tabGroups.onRemoved.emit(group, { isWindowClosing: false })
    await vi.advanceTimersByTimeAsync(100)

    expect(mocks.tabGroupRemoved).toHaveBeenCalledWith(group, false)
    vi.useRealTimers()
  })

  it('preserves group metadata when Firefox removes a group while closing its window', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    const group = {
      id: 7,
      windowId: 20,
      title: 'Research',
      color: 'blue',
      collapsed: false,
    } satisfies browser.tabGroups.TabGroup
    initializeListeners()

    fakeBrowser.tabGroups.onRemoved.emit(group, { isWindowClosing: true })

    expect(mocks.tabGroupWindowClosed).toHaveBeenCalledWith(group)
    expect(mocks.tabGroupRemoved).not.toHaveBeenCalled()
  })

  it('clears selection and restores browser action menu when context menus are hidden', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    initializeListeners()

    fakeBrowser.menus.onHidden.emit()

    expect(mocks.clearSelection).toHaveBeenCalledTimes(1)
    expect(fakeBrowser.menus.removeAll).toHaveBeenCalledTimes(1)
    expect(mocks.setupBrowserActionMenu).toHaveBeenCalledTimes(1)
  })

  it('routes badge-related browser events to the badge updater', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    initializeListeners()

    fakeBrowser.runtime.onInstalled.emit()
    fakeBrowser.runtime.onStartup.emit()
    fakeBrowser.tabs.onCreated.emit({} as browser.tabs.Tab)
    fakeBrowser.tabs.onRemoved.emit(1, {} as browser.tabs._OnRemovedRemoveInfo)

    expect(mocks.updateBadge).toHaveBeenCalledTimes(4)
  })

  it('registers container listeners and captures a created tab container', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.Items.push({
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      id: 20,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [],
    })
    mocks.addTab.mockReturnValue('tab-1' as UID)
    initializeListeners()

    expect(fakeBrowser.contextualIdentities.onCreated.listeners).toContain(
      mocks.containerCreated,
    )
    expect(fakeBrowser.contextualIdentities.onUpdated.listeners).toContain(
      mocks.containerUpdated,
    )
    expect(fakeBrowser.contextualIdentities.onRemoved.listeners).toContain(
      mocks.containerRemoved,
    )

    fakeBrowser.tabs.onCreated.emit({
      id: 10,
      windowId: 20,
      index: 0,
      active: true,
      discarded: false,
      pinned: false,
      title: 'Work tab',
      url: 'https://example.test/work',
      cookieStoreId: 'firefox-container-1',
    } as browser.tabs.Tab)
    await vi.waitFor(() => {
      expect(mocks.updateTab).toHaveBeenCalledWith(
        { tabUid: 'tab-1' },
        { container: expect.objectContaining({ name: 'Work' }) },
      )
    })
  })

  it('does not add a restored tab that the restoration coordinator handled', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    const tab = {
      id: 10,
      windowId: 20,
      index: 0,
      active: true,
      discarded: false,
      pinned: false,
      title: 'Restored',
      url: 'https://example.test/restored',
    } as browser.tabs.Tab
    mocks.handleCreatedTab.mockResolvedValueOnce(true)
    initializeListeners()

    fakeBrowser.tabs.onCreated.emit(tab)

    await vi.waitFor(() => {
      expect(mocks.handleCreatedTab).toHaveBeenCalledWith(tab)
    })
    expect(mocks.addTab).not.toHaveBeenCalled()
  })

  it('ignores attach, detach, and move events claimed by restoration', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.isTabRelocating.mockReturnValue(true)
    mocks.Items.push({
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      id: 20,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [
        {
          type: TreeItemType.TAB,
          uid: 'tab-1' as UID,
          id: 10,
          title: 'Restored',
          url: 'https://example.test/restored',
          windowUid: 'window-1' as UID,
          selected: false,
          state: State.OPEN,
          indentLevel: 1,
          pinned: false,
        },
      ],
    })
    initializeListeners()

    fakeBrowser.tabs.onDetached.emit(10, { oldWindowId: 20, oldPosition: 0 })
    fakeBrowser.tabs.onAttached.emit(10, { newWindowId: 20, newPosition: 0 })
    fakeBrowser.tabs.onMoved.emit(10, {
      windowId: 20,
      fromIndex: 0,
      toIndex: 1,
    })
    await Promise.resolve()

    expect(mocks.removeTab).not.toHaveBeenCalled()
    expect(browser.tabs.get).not.toHaveBeenCalled()
    expect(browser.tabs.query).not.toHaveBeenCalled()
  })

  it('lets the window restoration coordinator own a restored window', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    const restoredWindow = { id: 30 } as browser.windows.Window
    mocks.handleCreatedWindow.mockResolvedValueOnce(true)
    initializeListeners()

    fakeBrowser.windows.onCreated.emit(restoredWindow)

    expect(mocks.beginWindowClassification).toHaveBeenCalledWith(30)
    await vi.waitFor(() => {
      expect(mocks.handleCreatedWindow).toHaveBeenCalledWith(restoredWindow)
    })
    expect(mocks.addWindow).not.toHaveBeenCalled()
    expect(mocks.finishWindowClassification).toHaveBeenCalledWith(
      30,
      'restored-window',
    )
  })

  it('does not add tab events owned by a newly classified window', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.waitForWindowClassification.mockResolvedValueOnce('new-window')
    initializeListeners()

    fakeBrowser.tabs.onCreated.emit({
      id: 10,
      windowId: 30,
      index: 0,
    } as browser.tabs.Tab)

    await vi.waitFor(() => {
      expect(mocks.waitForWindowClassification).toHaveBeenCalledWith(30)
    })
    expect(mocks.isNewTabExtensionGenerated).toHaveBeenCalledWith(10)
    expect(mocks.addTab).not.toHaveBeenCalled()
  })

  it('lets a late child of a restored window reconnect by identity', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.Items.push({
      type: TreeItemType.WINDOW,
      uid: 'window-restored' as UID,
      id: 30,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [],
    })
    mocks.waitForWindowClassification.mockResolvedValueOnce('restored-window')
    mocks.handleCreatedTab.mockResolvedValueOnce(true)
    initializeListeners()

    const tab = {
      id: 10,
      windowId: 30,
      index: 0,
      active: true,
      discarded: false,
      pinned: false,
      title: 'Restored child',
      url: 'https://example.test/restored-child',
    } as browser.tabs.Tab
    fakeBrowser.tabs.onCreated.emit(tab)

    await vi.waitFor(() => {
      expect(mocks.handleCreatedTab).toHaveBeenCalledWith(tab)
    })
    expect(mocks.addTab).not.toHaveBeenCalled()
  })

  it('acknowledges an extension-generated tab before duplicate suppression', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.Items.push({
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      id: 30,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [
        {
          type: TreeItemType.TAB,
          uid: 'tab-existing' as UID,
          id: 10,
          title: 'Existing',
          url: 'https://example.test/existing',
          windowUid: 'window-1' as UID,
          selected: false,
          state: State.OPEN,
          indentLevel: 1,
          pinned: false,
        },
      ],
    })
    mocks.isNewTabExtensionGenerated.mockResolvedValueOnce(true)
    initializeListeners()

    fakeBrowser.tabs.onCreated.emit({
      id: 10,
      windowId: 30,
      index: 0,
    } as browser.tabs.Tab)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mocks.isNewTabExtensionGenerated).toHaveBeenCalledWith(10)
    expect(mocks.addTab).not.toHaveBeenCalled()
  })

  it('adds a late child tab omitted from a newly classified window snapshot', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.Items.push({
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      id: 30,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [],
    })
    mocks.addTab.mockReturnValue('tab-late' as UID)
    mocks.waitForWindowClassification.mockResolvedValueOnce('new-window')
    vi.mocked(browser.tabs.get).mockResolvedValue({
      id: 10,
      windowId: 30,
      index: 1,
      active: false,
      discarded: false,
      pinned: false,
      groupId: 7,
      title: 'Late child',
      url: 'https://example.test/late',
    } as browser.tabs.Tab)
    initializeListeners()

    fakeBrowser.tabs.onCreated.emit({
      id: 10,
      windowId: 30,
      index: 1,
      active: false,
      discarded: false,
      pinned: false,
      groupId: -1,
      title: 'Late child',
      url: 'https://example.test/late',
    } as browser.tabs.Tab)

    await vi.waitFor(() => {
      expect(mocks.addTab).toHaveBeenCalledWith(
        false,
        'window-1',
        10,
        false,
        State.OPEN,
        'Late child',
        'https://example.test/late',
        false,
        undefined,
      )
    })
    await vi.waitFor(() => {
      expect(mocks.tabGroupMembershipChanged).toHaveBeenCalledWith(10, 7)
    })
    expect(mocks.handleCreatedTab).not.toHaveBeenCalled()
  })

  it('inserts a late first browser tab at the first tree position', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.Items.push({
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      id: 30,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [
        {
          type: TreeItemType.TAB,
          uid: 'tab-second' as UID,
          id: 11,
          title: 'Second',
          url: 'https://example.test/second',
          windowUid: 'window-1' as UID,
          selected: false,
          state: State.OPEN,
          indentLevel: 1,
          pinned: false,
        },
      ],
    })
    mocks.addTab.mockReturnValue('tab-first' as UID)
    mocks.waitForWindowClassification.mockResolvedValueOnce('new-window')
    vi.mocked(browser.tabs.get).mockResolvedValue({
      id: 10,
      windowId: 30,
      index: 0,
      active: true,
      discarded: false,
      pinned: false,
      title: 'First',
      url: 'https://example.test/first',
    } as browser.tabs.Tab)
    initializeListeners()

    fakeBrowser.tabs.onCreated.emit({
      id: 10,
      windowId: 30,
      index: 0,
    } as browser.tabs.Tab)

    await vi.waitFor(() => {
      expect(mocks.addTab).toHaveBeenCalledWith(
        true,
        'window-1',
        10,
        false,
        State.OPEN,
        'First',
        'https://example.test/first',
        false,
        0,
      )
    })
  })

  it('ignores a delayed created event for a tab already captured in its window snapshot', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.Items.push({
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      id: 30,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [
        {
          type: TreeItemType.TAB,
          uid: 'tab-existing' as UID,
          id: 10,
          title: 'Navigated title',
          url: 'https://example.test/navigated',
          windowUid: 'window-1' as UID,
          selected: false,
          state: State.OPEN,
          indentLevel: 1,
          pinned: false,
        },
      ],
    })
    initializeListeners()

    fakeBrowser.tabs.onCreated.emit({
      id: 10,
      windowId: 30,
      index: 0,
      active: true,
      discarded: false,
      pinned: false,
      title: 'New Tab',
      url: 'about:blank',
    } as browser.tabs.Tab)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mocks.addTab).not.toHaveBeenCalled()
    expect(mocks.handleCreatedTab).not.toHaveBeenCalled()
  })

  it('rechecks for a captured tab after refreshing a late created event', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    const window = {
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      id: 30,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [] as SessionTab[],
    }
    mocks.Items.push(window)
    mocks.waitForWindowClassification.mockResolvedValueOnce('new-window')
    let finishRefresh: ((tab: browser.tabs.Tab) => void) | undefined
    vi.mocked(browser.tabs.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve
        }),
    )
    initializeListeners()

    fakeBrowser.tabs.onCreated.emit({
      id: 10,
      windowId: 30,
      index: 0,
      active: true,
      discarded: false,
      pinned: false,
      title: 'New Tab',
      url: 'about:blank',
    } as browser.tabs.Tab)
    await vi.waitFor(() => {
      expect(browser.tabs.get).toHaveBeenCalledWith(10)
    })

    window.children.push({
      type: TreeItemType.TAB,
      uid: 'tab-existing' as UID,
      id: 10,
      title: 'Navigated title',
      url: 'https://example.test/navigated',
      windowUid: window.uid,
      selected: false,
      state: State.OPEN,
      indentLevel: 1,
      pinned: false,
    })
    finishRefresh?.({
      id: 10,
      windowId: 30,
      index: 0,
      active: true,
      discarded: false,
      pinned: false,
      title: 'New Tab',
      url: 'about:blank',
    } as browser.tabs.Tab)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mocks.addTab).not.toHaveBeenCalled()
  })

  it('starts window classification when a restored child tab event arrives first', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    let resolveClassification: ((disposition: 'new-window') => void) | undefined
    mocks.waitForWindowClassification.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveClassification = resolve
      }),
    )
    initializeListeners()

    fakeBrowser.tabs.onCreated.emit({
      id: 10,
      windowId: 30,
      index: 0,
    } as browser.tabs.Tab)
    await Promise.resolve()

    expect(mocks.beginWindowClassification).toHaveBeenCalledWith(30)
    expect(mocks.handleCreatedTab).not.toHaveBeenCalled()

    resolveClassification?.('new-window')
    await vi.waitFor(() => {
      expect(mocks.waitForWindowClassification).toHaveBeenCalledWith(30)
    })
    expect(mocks.handleCreatedTab).not.toHaveBeenCalled()
  })

  it('preserves a container snapshot when a browser move rebuilds a tab', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    const container = {
      cookieStoreId: 'firefox-container-1',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
    }
    const movedTab: SessionTab = {
      type: TreeItemType.TAB,
      uid: 'tab-work' as UID,
      id: 10,
      title: 'Work',
      url: 'https://example.test/work',
      windowUid: 'window-1' as UID,
      selected: false,
      state: State.OPEN,
      indentLevel: 1,
      pinned: false,
      container,
    }
    const otherTab: SessionTab = {
      ...movedTab,
      uid: 'tab-other' as UID,
      id: 11,
      title: 'Other',
      container: undefined,
    }
    mocks.Items.push({
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      id: 20,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [otherTab, movedTab],
    })
    vi.mocked(fakeBrowser.tabs.query).mockResolvedValueOnce([
      { id: 10, pinned: false },
      { id: 11, pinned: false },
    ] as browser.tabs.Tab[])
    initializeListeners()

    fakeBrowser.tabs.onMoved.emit(10, {
      windowId: 20,
      fromIndex: 1,
      toIndex: 0,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.addTab.mock.calls[0]?.[13]).toEqual(container)
  })

  it('routes tab activation events to the tree with the activation depth', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    initializeListeners()
    const activeInfo = { tabId: 10, windowId: 20 }

    fakeBrowser.tabs.onActivated.emit(activeInfo)

    expect(mocks.tabOnActivated).toHaveBeenCalledWith(activeInfo, 5)
  })

  it('updates tab metadata and tree pinned state from browser tab updates', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    const tab = {
      type: TreeItemType.TAB,
      uid: 'tab-1' as UID,
      id: 10,
      title: 'Old title',
      url: 'https://old.example',
      windowUid: 'window-1' as UID,
      selected: false,
      state: State.OPEN,
      indentLevel: 1,
      pinned: false,
    }
    mocks.Items.push({
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      id: 20,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [tab],
    })
    initializeListeners()

    fakeBrowser.tabs.onUpdated.emit(10, { pinned: true }, {
      id: 10,
      windowId: 20,
      discarded: false,
      pinned: true,
      status: LoadingStatus.COMPLETE,
      title: 'Loaded title',
      url: 'https://loaded.example',
    } as browser.tabs.Tab)
    fakeBrowser.tabs.onUpdated.emit(10, { pinned: false }, {
      id: 10,
      windowId: 20,
      discarded: true,
      pinned: false,
      status: LoadingStatus.LOADING,
      title: 'Ignored loading title',
      url: 'https://ignored.example',
    } as browser.tabs.Tab)

    expect(mocks.pinTabInTree).toHaveBeenCalledWith('tab-1')
    expect(mocks.unpinTabInTree).toHaveBeenCalledWith('tab-1')
    expect(mocks.updateTab).toHaveBeenNthCalledWith(
      1,
      { windowId: 20, tabId: 10 },
      {
        state: State.OPEN,
        loadingStatus: LoadingStatus.COMPLETE,
        title: 'Loaded title',
        url: 'https://loaded.example',
        pinned: true,
      },
    )
    expect(mocks.updateTab).toHaveBeenNthCalledWith(
      2,
      { windowId: 20, tabId: 10 },
      {
        state: State.DISCARDED,
        loadingStatus: LoadingStatus.LOADING,
        pinned: false,
      },
    )
  })

  it('inserts attached tabs before the browser tab to their right', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.Items.push({
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      id: 20,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [
        {
          type: TreeItemType.TAB,
          uid: 'pinned-existing' as UID,
          id: 30,
          title: 'Pinned existing',
          url: 'https://example.test/pinned-existing',
          windowUid: 'window-1' as UID,
          selected: false,
          state: State.OPEN,
          indentLevel: 1,
          pinned: true,
        },
        {
          type: TreeItemType.TAB,
          uid: 'middle-existing' as UID,
          id: 40,
          title: 'Middle existing',
          url: 'https://example.test/middle-existing',
          windowUid: 'window-1' as UID,
          selected: false,
          state: State.OPEN,
          indentLevel: 1,
          pinned: false,
        },
        {
          type: TreeItemType.TAB,
          uid: 'right-existing' as UID,
          id: 50,
          title: 'Right existing',
          url: 'https://example.test/right-existing',
          windowUid: 'window-1' as UID,
          selected: false,
          state: State.OPEN,
          indentLevel: 1,
          pinned: false,
        },
      ],
    })
    vi.mocked(fakeBrowser.tabs.get)
      .mockResolvedValueOnce({
        id: 10,
        index: 1,
        active: true,
        discarded: false,
        pinned: false,
        title: 'Attached unpinned',
        url: 'https://example.test/attached-unpinned',
      })
      .mockResolvedValueOnce({
        id: 11,
        index: 1,
        active: false,
        discarded: true,
        pinned: true,
        title: 'Attached pinned',
        url: 'https://example.test/attached-pinned',
      })
    vi.mocked(fakeBrowser.tabs.query)
      .mockResolvedValueOnce([{ id: 50 }] as browser.tabs.Tab[])
      .mockResolvedValueOnce([{ id: 50 }] as browser.tabs.Tab[])
    initializeListeners()

    fakeBrowser.tabs.onAttached.emit(10, { newWindowId: 20, newPosition: 1 })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    fakeBrowser.tabs.onAttached.emit(11, { newWindowId: 20, newPosition: 1 })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.isNewTabExtensionGenerated).toHaveBeenCalledWith(10)
    expect(mocks.isNewTabExtensionGenerated).toHaveBeenCalledWith(11)
    expect(fakeBrowser.tabs.query).toHaveBeenNthCalledWith(1, {
      windowId: 20,
      index: 2,
    })
    expect(fakeBrowser.tabs.query).toHaveBeenNthCalledWith(2, {
      windowId: 20,
      index: 2,
    })
    expect(mocks.addTab).toHaveBeenNthCalledWith(
      1,
      true,
      'window-1',
      10,
      false,
      State.OPEN,
      'Attached unpinned',
      'https://example.test/attached-unpinned',
      false,
      2,
    )
    expect(mocks.addTab).toHaveBeenNthCalledWith(
      2,
      false,
      'window-1',
      11,
      false,
      State.DISCARDED,
      'Attached pinned',
      'https://example.test/attached-pinned',
      true,
      1,
    )
  })

  it('promotes a child tab when a browser move leaves it before its parent', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    const alpha = {
      type: TreeItemType.TAB,
      uid: 'tab-alpha' as UID,
      id: 30,
      title: 'Alpha',
      url: 'https://example.test/alpha',
      windowUid: 'window-1' as UID,
      selected: false,
      state: State.OPEN,
      parentUid: 'tab-initial' as UID,
      indentLevel: 2,
      pinned: false,
    }
    const beta = {
      type: TreeItemType.TAB,
      uid: 'tab-beta' as UID,
      id: 40,
      title: 'Beta',
      url: 'https://example.test/beta',
      windowUid: 'window-1' as UID,
      selected: false,
      state: State.OPEN,
      indentLevel: 1,
      pinned: false,
    }
    const initial = {
      type: TreeItemType.TAB,
      uid: 'tab-initial' as UID,
      id: 10,
      title: 'Initial',
      url: 'https://example.test/initial',
      windowUid: 'window-1' as UID,
      selected: false,
      state: State.OPEN,
      isParent: true,
      indentLevel: 1,
      pinned: false,
    }
    mocks.Items.push({
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      id: 20,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [alpha, beta, initial],
    })
    vi.mocked(fakeBrowser.tabs.query).mockResolvedValueOnce([
      { id: 30 },
      { id: 40 },
      { id: 10 },
    ] as browser.tabs.Tab[])
    initializeListeners()

    fakeBrowser.tabs.onMoved.emit(30, {
      windowId: 20,
      fromIndex: 1,
      toIndex: 0,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(alpha.parentUid).toBeUndefined()
    expect(alpha.indentLevel).toBe(1)
    expect(initial.isParent).toBe(false)
    expect(mocks.updateTab).toHaveBeenCalledWith(
      { tabUid: 'tab-alpha' },
      { parentUid: undefined, indentLevel: 1 },
    )
    expect(mocks.updateTab).toHaveBeenCalledWith(
      { tabUid: 'tab-initial' },
      { isParent: false },
    )
    expect(mocks.removeTab).not.toHaveBeenCalled()
  })

  it('recomputes collapsed visibility when repair changes hierarchy but browser tab order already matches', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    const child = {
      type: TreeItemType.TAB,
      uid: 'tab-child' as UID,
      id: 30,
      title: 'Child',
      url: 'https://example.test/child',
      windowUid: 'window-1' as UID,
      selected: false,
      state: State.OPEN,
      parentUid: 'tab-parent' as UID,
      indentLevel: 2,
      isVisible: false,
      pinned: false,
    }
    const note = {
      type: TreeItemType.NOTE,
      uid: 'note-child' as UID,
      text: 'Note child',
      selected: false,
      windowUid: 'window-1' as UID,
      parentUid: 'tab-parent' as UID,
      indentLevel: 2,
      isVisible: false,
    }
    const separator = {
      type: TreeItemType.SEPARATOR,
      uid: 'separator-child' as UID,
      selected: false,
      windowUid: 'window-1' as UID,
      parentUid: 'tab-parent' as UID,
      indentLevel: 2,
      isParent: false,
      collapsed: false,
      isVisible: false,
    }
    const parent = {
      type: TreeItemType.TAB,
      uid: 'tab-parent' as UID,
      id: 10,
      title: 'Parent',
      url: 'https://example.test/parent',
      windowUid: 'window-1' as UID,
      selected: false,
      state: State.OPEN,
      isParent: true,
      collapsed: true,
      indentLevel: 1,
      isVisible: true,
      pinned: false,
    }
    mocks.Items.push({
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      id: 20,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [child, note, separator, parent],
    })
    mocks.recomputeSessionTree.mockImplementation(() => {
      child.isVisible = child.parentUid === undefined
      note.isVisible = note.parentUid === undefined
      separator.isVisible = separator.parentUid === undefined
    })
    vi.mocked(fakeBrowser.tabs.query).mockResolvedValueOnce([
      { id: 30 },
      { id: 10 },
    ] as browser.tabs.Tab[])
    initializeListeners()

    fakeBrowser.tabs.onMoved.emit(30, {
      windowId: 20,
      fromIndex: 1,
      toIndex: 0,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(child.parentUid).toBeUndefined()
    expect(note.parentUid).toBeUndefined()
    expect(separator.parentUid).toBeUndefined()
    expect(child.indentLevel).toBe(1)
    expect(note.indentLevel).toBe(1)
    expect(separator.indentLevel).toBe(1)
    expect(parent.isParent).toBe(false)
    expect(mocks.recomputeSessionTree).toHaveBeenCalledTimes(1)
    expect(child.isVisible).toBe(true)
    expect(note.isVisible).toBe(true)
    expect(separator.isVisible).toBe(true)
    expect(mocks.removeTab).not.toHaveBeenCalled()
  })

  it('repairs multi-level tab inversions from a browser move until stable', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    const grandchild: SessionTab = {
      type: TreeItemType.TAB,
      uid: 'tab-grandchild' as UID,
      id: 30,
      title: 'Grandchild',
      url: 'https://example.test/grandchild',
      windowUid: 'window-1' as UID,
      selected: false,
      state: State.OPEN,
      parentUid: 'tab-child' as UID,
      indentLevel: 3,
      pinned: false,
    }
    const child: SessionTab = {
      type: TreeItemType.TAB,
      uid: 'tab-child' as UID,
      id: 20,
      title: 'Child',
      url: 'https://example.test/child',
      windowUid: 'window-1' as UID,
      selected: false,
      state: State.OPEN,
      parentUid: 'tab-parent' as UID,
      isParent: true,
      indentLevel: 2,
      pinned: false,
    }
    const parent: SessionTab = {
      type: TreeItemType.TAB,
      uid: 'tab-parent' as UID,
      id: 10,
      title: 'Parent',
      url: 'https://example.test/parent',
      windowUid: 'window-1' as UID,
      selected: false,
      state: State.OPEN,
      isParent: true,
      indentLevel: 1,
      pinned: false,
    }
    mocks.Items.push({
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      id: 20,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [grandchild, child, parent],
    })
    vi.mocked(fakeBrowser.tabs.query).mockResolvedValueOnce([
      { id: 30 },
      { id: 20 },
      { id: 10 },
    ] as browser.tabs.Tab[])
    initializeListeners()

    fakeBrowser.tabs.onMoved.emit(30, {
      windowId: 20,
      fromIndex: 2,
      toIndex: 0,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(grandchild.parentUid).toBeUndefined()
    expect(child.parentUid).toBeUndefined()
    expect(parent.parentUid).toBeUndefined()
    expect(grandchild.indentLevel).toBe(1)
    expect(child.indentLevel).toBe(1)
    expect(parent.indentLevel).toBe(1)
    expect(child.isParent).toBe(false)
    expect(parent.isParent).toBe(false)
  })

  it('does not spin when repairing corrupted cyclic parent links', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    const tabA: SessionTab = {
      type: TreeItemType.TAB,
      uid: 'tab-a' as UID,
      id: 10,
      title: 'A',
      url: 'https://example.test/a',
      windowUid: 'window-1' as UID,
      selected: false,
      state: State.OPEN,
      parentUid: 'tab-b' as UID,
      isParent: true,
      indentLevel: 2,
      pinned: false,
    }
    const tabB: SessionTab = {
      type: TreeItemType.TAB,
      uid: 'tab-b' as UID,
      id: 20,
      title: 'B',
      url: 'https://example.test/b',
      windowUid: 'window-1' as UID,
      selected: false,
      state: State.OPEN,
      parentUid: 'tab-a' as UID,
      isParent: true,
      indentLevel: 2,
      pinned: false,
    }
    mocks.Items.push({
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      id: 20,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [tabA, tabB],
    })
    vi.mocked(fakeBrowser.tabs.query).mockResolvedValueOnce([
      { id: 10 },
      { id: 20 },
    ] as browser.tabs.Tab[])
    mocks.updateTab.mockImplementation(() => {
      if (mocks.updateTab.mock.calls.length > 5) {
        throw new Error('repair did not converge')
      }
    })
    initializeListeners()

    fakeBrowser.tabs.onMoved.emit(10, {
      windowId: 20,
      fromIndex: 0,
      toIndex: 0,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.updateTab.mock.calls.length).toBeLessThanOrEqual(5)
    expect(tabA.parentUid).not.toBe(tabA.uid)
    expect(tabB.parentUid).not.toBe(tabB.uid)
  })

  it('repairs note and separator children placed before their parent by a browser move', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    const note = {
      type: TreeItemType.NOTE,
      uid: 'note-child' as UID,
      text: 'Note child',
      selected: false,
      windowUid: 'window-1' as UID,
      parentUid: 'tab-parent' as UID,
      indentLevel: 2,
    }
    const separator = {
      type: TreeItemType.SEPARATOR,
      uid: 'separator-child' as UID,
      selected: false,
      windowUid: 'window-1' as UID,
      parentUid: 'tab-parent' as UID,
      indentLevel: 2,
      isParent: false,
      collapsed: false,
    }
    const parent = {
      type: TreeItemType.TAB,
      uid: 'tab-parent' as UID,
      id: 10,
      title: 'Parent',
      url: 'https://example.test/parent',
      windowUid: 'window-1' as UID,
      selected: false,
      state: State.OPEN,
      isParent: true,
      indentLevel: 1,
      pinned: false,
    }
    mocks.Items.push({
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      id: 20,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [note, separator, parent],
    })
    vi.mocked(fakeBrowser.tabs.query).mockResolvedValueOnce([
      { id: 10 },
    ] as browser.tabs.Tab[])
    initializeListeners()

    fakeBrowser.tabs.onMoved.emit(10, {
      windowId: 20,
      fromIndex: 0,
      toIndex: 0,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(note.parentUid).toBeUndefined()
    expect(separator.parentUid).toBeUndefined()
    expect(note.indentLevel).toBe(1)
    expect(separator.indentLevel).toBe(1)
    expect(parent.isParent).toBe(false)
    expect(mocks.updateNote).toHaveBeenCalledWith('note-child', {
      parentUid: undefined,
      indentLevel: 1,
    })
    expect(mocks.updateSeparator).toHaveBeenCalledWith('separator-child', {
      parentUid: undefined,
      indentLevel: 1,
    })
  })

  it('routes window focus changes to the tree with the activation depth', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    initializeListeners()

    fakeBrowser.windows.onFocusChanged.emit(42)

    expect(mocks.setActiveWindow).toHaveBeenCalledWith(42, 5)
  })

  it('opens the session tree from browser action clicks', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    initializeListeners()

    fakeBrowser.browserAction.onClicked.emit()

    expect(mocks.openSessionTree).toHaveBeenCalledTimes(1)
  })

  it('logs browser action open failures without throwing', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    const error = new Error('open failed')
    mocks.openSessionTree.mockRejectedValueOnce(error)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    initializeListeners()

    try {
      expect(() => fakeBrowser.browserAction.onClicked.emit()).not.toThrow()
      await Promise.resolve()

      expect(consoleError).toHaveBeenCalledWith(
        'Error opening SessionTree:',
        error,
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  it.each([
    [
      'closeTab',
      { action: 'closeTab', tabId: 1, tabUid: 'tab-1' as UID },
      'closeTab',
      [{ action: 'closeTab', tabId: 1, tabUid: 'tab-1' as UID }],
    ],
    [
      'saveTab',
      { action: 'saveTab', tabId: 3, tabUid: 'tab-3' as UID },
      'saveTab',
      [{ action: 'saveTab', tabId: 3, tabUid: 'tab-3' as UID }],
    ],
    [
      'openTab',
      {
        action: 'openTab',
        tabUid: 'tab-4' as UID,
        windowUid: 'window-1' as UID,
      },
      'openTab',
      [
        {
          action: 'openTab',
          tabUid: 'tab-4' as UID,
          windowUid: 'window-1' as UID,
        },
      ],
    ],
    [
      'closeWindow',
      { action: 'closeWindow', windowId: 10, windowUid: 'window-10' as UID },
      'closeWindow',
      [{ action: 'closeWindow', windowId: 10, windowUid: 'window-10' as UID }],
    ],
    [
      'saveWindow',
      { action: 'saveWindow', windowId: 11, windowUid: 'window-11' as UID },
      'saveAndRemoveWindow',
      [{ action: 'saveWindow', windowId: 11, windowUid: 'window-11' as UID }],
    ],
    [
      'openWindow',
      { action: 'openWindow', windowUid: 'window-12' as UID },
      'openWindow',
      [{ action: 'openWindow', windowUid: 'window-12' as UID }],
    ],
    [
      'registerSessionTreeWindow',
      { action: 'registerSessionTreeWindow', windowId: 99 },
      'registerSessionTreeWindow',
      [99],
    ],
    [
      'deselectAllItems',
      { action: 'deselectAllItems' },
      'deselectAllItems',
      [],
    ],
    [
      'printSessionTree',
      { action: 'printSessionTree' },
      'printSessionTree',
      [],
    ],
  ] as const)(
    'routes %s commands to Tree.%s',
    async (_, message, methodName, expectedArgs) => {
      const { initializeListeners, mocks } = await loadBackgroundHandlers()
      initializeListeners()
      const dispatchCommand = getDispatchCommand(
        mocks.initializeSessionTreePort,
      )

      dispatchCommand(message)

      expect(mocks[methodName]).toHaveBeenCalledWith(...expectedArgs)
    },
  )

  it('waits for async openTab commands before resolving dispatch', async () => {
    const { initializeListeners, mocks } = await loadBackgroundHandlers()
    let resolveOpenTab: () => void = () => {}
    mocks.openTab.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveOpenTab = resolve
      }),
    )
    initializeListeners()
    const dispatchCommand = getDispatchCommand(mocks.initializeSessionTreePort)

    let resolved = false
    const dispatchPromise = Promise.resolve(
      dispatchCommand({
        action: 'openTab',
        tabUid: 'tab-4' as UID,
        windowUid: 'window-1' as UID,
      }),
    ).then(() => {
      resolved = true
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.openTab).toHaveBeenCalled()
    expect(resolved).toBe(false)

    resolveOpenTab()
    await dispatchPromise

    expect(resolved).toBe(true)
  })

  it('coalesces identical open commands for the same saved tab', async () => {
    const { initializeListeners, mocks } = await loadBackgroundHandlers()
    let resolveOpenTab: () => void = () => {}
    mocks.openTab.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveOpenTab = resolve
      }),
    )
    initializeListeners()
    const dispatchCommand = getDispatchCommand(mocks.initializeSessionTreePort)
    const message = {
      action: 'openTab' as const,
      tabUid: 'tab-4' as UID,
      windowUid: 'window-1' as UID,
    }

    const first = dispatchCommand(message)
    const second = dispatchCommand(message)
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.openTab).toHaveBeenCalledTimes(1)

    resolveOpenTab()
    await Promise.all([first, second])
  })

  it('serializes conflicting commands for the same tree item', async () => {
    const { initializeListeners, mocks } = await loadBackgroundHandlers()
    let resolveOpenTab: () => void = () => {}
    mocks.openTab.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveOpenTab = resolve
      }),
    )
    initializeListeners()
    const dispatchCommand = getDispatchCommand(mocks.initializeSessionTreePort)

    const open = dispatchCommand({
      action: 'openTab',
      tabUid: 'tab-4' as UID,
      windowUid: 'window-1' as UID,
    })
    const save = dispatchCommand({
      action: 'saveTab',
      tabId: 44,
      tabUid: 'tab-4' as UID,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.openTab).toHaveBeenCalledTimes(1)
    expect(mocks.saveTab).not.toHaveBeenCalled()

    resolveOpenTab()
    await Promise.all([open, save])

    expect(mocks.saveTab).toHaveBeenCalledTimes(1)
  })

  it('allows commands for unrelated tree items to run concurrently', async () => {
    const { initializeListeners, mocks } = await loadBackgroundHandlers()
    let resolveFirstOpen: () => void = () => {}
    mocks.openTab.mockImplementation(({ tabUid }: { tabUid: UID }) => {
      if (tabUid !== ('tab-1' as UID)) return Promise.resolve()
      return new Promise<void>((resolve) => {
        resolveFirstOpen = resolve
      })
    })
    initializeListeners()
    const dispatchCommand = getDispatchCommand(mocks.initializeSessionTreePort)

    const first = dispatchCommand({
      action: 'openTab',
      tabUid: 'tab-1' as UID,
      windowUid: 'window-1' as UID,
    })
    const second = dispatchCommand({
      action: 'openTab',
      tabUid: 'tab-2' as UID,
      windowUid: 'window-2' as UID,
    })
    await second

    expect(mocks.openTab).toHaveBeenCalledTimes(2)

    resolveFirstOpen()
    await first
  })

  it('serializes saved-tab opens in one window', async () => {
    const { initializeListeners, mocks } = await loadBackgroundHandlers()
    let resolveFirstOpen: () => void = () => {}
    mocks.openTab.mockImplementation(({ tabUid }: { tabUid: UID }) => {
      if (tabUid !== ('tab-1' as UID)) return Promise.resolve()
      return new Promise<void>((resolve) => {
        resolveFirstOpen = resolve
      })
    })
    initializeListeners()
    const dispatchCommand = getDispatchCommand(mocks.initializeSessionTreePort)

    const first = dispatchCommand({
      action: 'openTab',
      tabUid: 'tab-1' as UID,
      windowUid: 'window-1' as UID,
    })
    const second = dispatchCommand({
      action: 'openTab',
      tabUid: 'tab-2' as UID,
      windowUid: 'window-1' as UID,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.openTab).toHaveBeenCalledTimes(1)

    resolveFirstOpen()
    await Promise.all([first, second])

    expect(mocks.openTab).toHaveBeenCalledTimes(2)
  })

  it('allows saved-tab opens in different windows', async () => {
    const { initializeListeners, mocks } = await loadBackgroundHandlers()
    let resolveFirstOpen: () => void = () => {}
    mocks.openTab.mockImplementation(({ tabUid }: { tabUid: UID }) => {
      if (tabUid !== ('tab-1' as UID)) return Promise.resolve()
      return new Promise<void>((resolve) => {
        resolveFirstOpen = resolve
      })
    })
    initializeListeners()
    const dispatchCommand = getDispatchCommand(mocks.initializeSessionTreePort)

    const first = dispatchCommand({
      action: 'openTab',
      tabUid: 'tab-1' as UID,
      windowUid: 'window-1' as UID,
    })
    const second = dispatchCommand({
      action: 'openTab',
      tabUid: 'tab-2' as UID,
      windowUid: 'window-2' as UID,
    })
    await second

    expect(mocks.openTab).toHaveBeenCalledTimes(2)

    resolveFirstOpen()
    await first
  })

  it.each([
    {
      action: 'treeItemIndentIncrease' as const,
      methodName: 'treeItemIndentIncrease' as const,
    },
    {
      action: 'treeItemIndentDecrease' as const,
      methodName: 'treeItemIndentDecrease' as const,
    },
  ])(
    'waits for async $action commands before resolving dispatch',
    async ({ action, methodName }) => {
      const { initializeListeners, mocks } = await loadBackgroundHandlers()
      let resolveIndent: () => void = () => {}
      mocks[methodName].mockReturnValue(
        new Promise<void>((resolve) => {
          resolveIndent = resolve
        }),
      )
      initializeListeners()
      const dispatchCommand = getDispatchCommand(
        mocks.initializeSessionTreePort,
      )

      let resolved = false
      const dispatchPromise = Promise.resolve(
        dispatchCommand({
          action,
          itemUIDs: ['tab-1' as UID],
        }),
      ).then(() => {
        resolved = true
      })
      await Promise.resolve()
      await Promise.resolve()

      expect(mocks[methodName]).toHaveBeenCalledWith(['tab-1'])
      expect(resolved).toBe(false)

      resolveIndent()
      await dispatchPromise

      expect(resolved).toBe(true)
    },
  )

  it('routes browser-backed focus and reload commands through the browser API', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    initializeListeners()
    const dispatchCommand = getDispatchCommand(mocks.initializeSessionTreePort)

    dispatchCommand({ action: 'reloadTab', tabId: 31 })
    dispatchCommand({ action: 'focusTab', tabId: 32, windowId: 42 })
    dispatchCommand({ action: 'focusWindow', windowId: 43 })

    expect(fakeBrowser.tabs.reload).toHaveBeenCalledWith(31)
    expect(fakeBrowser.tabs.update).toHaveBeenCalledWith(32, { active: true })
    expect(fakeBrowser.windows.update).toHaveBeenCalledWith(42, {
      focused: true,
    })
    expect(fakeBrowser.windows.update).toHaveBeenCalledWith(43, {
      focused: true,
    })
  })

  it('routes note and collapse commands to tree methods with command payload fields', async () => {
    const { initializeListeners, mocks } = await loadBackgroundHandlers()
    initializeListeners()
    const dispatchCommand = getDispatchCommand(mocks.initializeSessionTreePort)

    dispatchCommand({
      action: 'createNote',
      parentUid: 'window-1' as UID,
      index: 2,
      text: 'new note',
    })
    dispatchCommand({
      action: 'updateNoteText',
      noteUid: 'note-1' as UID,
      text: 'updated',
    })
    dispatchCommand({ action: 'toggleCollapseNote', noteUid: 'note-2' as UID })
    dispatchCommand({ action: 'removeNote', noteUid: 'note-3' as UID })
    dispatchCommand({ action: 'toggleCollapseTab', tabUid: 'tab-1' as UID })
    dispatchCommand({
      action: 'toggleCollapseWindow',
      windowUid: 'window-1' as UID,
    })

    expect(mocks.createNote).toHaveBeenCalledWith('window-1', 2, 'new note')
    expect(mocks.updateNoteText).toHaveBeenCalledWith('note-1', 'updated')
    expect(mocks.toggleCollapseNote).toHaveBeenCalledWith('note-2')
    expect(mocks.removeNote).toHaveBeenCalledWith('note-3')
    expect(mocks.toggleCollapseTab).toHaveBeenCalledWith('tab-1')
    expect(mocks.toggleCollapseWindow).toHaveBeenCalledWith('window-1')
  })

  it('routes move, indent, pin, and position commands with forwarded arguments', async () => {
    const { initializeListeners, mocks } = await loadBackgroundHandlers()
    initializeListeners()
    const dispatchCommand = getDispatchCommand(mocks.initializeSessionTreePort)

    await Promise.all([
      dispatchCommand({
        action: 'moveTreeItems',
        itemUIDs: ['note-2' as UID],
        targetIndex: 4,
        parentUid: 'note-parent' as UID,
        targetWindowUid: 'window-2' as UID,
        copy: false,
        includeDescendants: true,
      }),
      dispatchCommand({
        action: 'moveWindows',
        windowUIDs: ['window-3' as UID],
        targetIndex: 5,
        copy: true,
      }),
      dispatchCommand({
        action: 'duplicateTreeItems',
        itemUIDs: ['note-1' as UID, 'window-1' as UID],
      }),
      dispatchCommand({
        action: 'treeItemIndentIncrease',
        itemUIDs: ['note-2' as UID],
      }),
      dispatchCommand({
        action: 'treeItemIndentDecrease',
        itemUIDs: ['window-2' as UID],
      }),
      dispatchCommand({ action: 'pinTab', tabUid: 'tab-4' as UID }),
      dispatchCommand({ action: 'unpinTab', tabUid: 'tab-5' as UID }),
      dispatchCommand({ action: 'openWindowsInSameLocationUpdated' }),
    ])

    expect(mocks.moveTabs).not.toHaveBeenCalled()
    expect(mocks.moveTreeItems).toHaveBeenCalledWith(
      ['note-2'],
      4,
      'note-parent',
      'window-2',
      false,
      true,
    )
    expect(mocks.moveWindows).toHaveBeenCalledWith(['window-3'], 5, true)
    expect(mocks.duplicateTreeItems).toHaveBeenCalledWith([
      'note-1',
      'window-1',
    ])
    expect(mocks.treeItemIndentIncrease).toHaveBeenCalledWith(['note-2'])
    expect(mocks.treeItemIndentDecrease).toHaveBeenCalledWith(['window-2'])
    expect(mocks.pinTab).toHaveBeenCalledWith('tab-4')
    expect(mocks.unpinTab).toHaveBeenCalledWith('tab-5')
    expect(mocks.updateWindowPositionInterval).toHaveBeenCalledTimes(1)
  })

  it('waits for duplicate state restoration before completing the command', async () => {
    const { initializeListeners, mocks } = await loadBackgroundHandlers()
    initializeListeners()
    const dispatchCommand = getDispatchCommand(mocks.initializeSessionTreePort)
    let finishDuplication: (() => void) | undefined
    mocks.duplicateTreeItems.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishDuplication = resolve
      }),
    )
    let commandCompleted = false

    const command = dispatchCommand({
      action: 'duplicateTreeItems',
      itemUIDs: ['tab-1' as UID],
    })
    void command?.then(() => {
      commandCompleted = true
    })
    await Promise.resolve()

    expect(commandCompleted).toBe(false)
    finishDuplication?.()
    await command
    expect(commandCompleted).toBe(true)
  })

  it('does not dispatch the legacy moveTabs command', async () => {
    const { initializeListeners, mocks } = await loadBackgroundHandlers()
    initializeListeners()
    const dispatchCommand = getDispatchCommand(mocks.initializeSessionTreePort)

    dispatchCommand({
      action: 'moveTabs',
      tabUIDs: ['tab-1' as UID],
      targetWindowUid: 'window-1' as UID,
      targetIndex: 3,
      parentUid: 'note-1' as UID,
      copy: true,
    } as unknown as SessionTreeMessage)

    expect(mocks.moveTabs).not.toHaveBeenCalled()
    expect(mocks.moveTreeItems).not.toHaveBeenCalled()
  })

  it('routes external URL imports through the background tree', async () => {
    const { initializeListeners, mocks } = await loadBackgroundHandlers()
    initializeListeners()
    const dispatchCommand = getDispatchCommand(mocks.initializeSessionTreePort)
    const message = {
      action: 'importExternalUrls' as const,
      items: [{ url: 'https://example.test/', title: 'Example' }],
      targetIndex: 2,
      parentUid: 'tab-parent' as UID,
      targetWindowUid: 'window-1' as UID,
    }

    await dispatchCommand(message)

    expect(mocks.importExternalUrls).toHaveBeenCalledWith(message)
  })

  it('updates window titles and custom labels only when indexed items exist', async () => {
    const { initializeListeners, mocks } = await loadBackgroundHandlers()
    initializeListeners()
    const dispatchCommand = getDispatchCommand(mocks.initializeSessionTreePort)
    mocks.windowsByUid.set('window-1' as UID, {})
    mocks.tabsByUid.set('tab-1' as UID, {})

    dispatchCommand({
      action: 'updateWindowTitle',
      windowUid: 'missing-window' as UID,
      newTitle: 'Ignored',
    })
    dispatchCommand({
      action: 'updateCustomLabel',
      uid: 'missing-tab' as UID,
      customLabel: 'Ignored',
    })
    dispatchCommand({
      action: 'updateWindowTitle',
      windowUid: 'window-1' as UID,
      newTitle: 'Project',
    })
    dispatchCommand({
      action: 'updateCustomLabel',
      uid: 'tab-1' as UID,
      customLabel: '  Project  ',
    })
    dispatchCommand({
      action: 'updateCustomLabel',
      uid: 'tab-1' as UID,
      customLabel: '   ',
    })

    expect(mocks.updateWindow).toHaveBeenCalledTimes(1)
    expect(mocks.updateWindow).toHaveBeenCalledWith('window-1', {
      title: 'Project',
    })
    expect(mocks.updateTab).toHaveBeenCalledTimes(2)
    expect(mocks.updateTab).toHaveBeenNthCalledWith(
      1,
      { tabUid: 'tab-1' },
      { customLabel: 'Project' },
    )
    expect(mocks.updateTab).toHaveBeenNthCalledWith(
      2,
      { tabUid: 'tab-1' },
      { customLabel: undefined },
    )
  })
})
