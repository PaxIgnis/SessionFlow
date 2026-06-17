import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeBrowser } from '../../helpers/fake-browser'
import type { SessionTreeMessage } from '@/types/messages'
import {
  LoadingStatus,
  State,
  Tab as SessionTab,
  TreeItemType,
} from '@/types/session-tree'

async function loadBackgroundHandlers() {
  vi.resetModules()
  const fakeBrowser = installFakeBrowser()

  const setupBrowserActionMenu = vi.fn()
  const updateBadge = vi.fn()
  const initializeSessionTreePort = vi.fn()
  const clearSelection = vi.fn()
  const isNewTabExtensionGenerated = vi.fn().mockResolvedValue(false)
  const tabOnActivated = vi.fn()
  const setActiveWindow = vi.fn()
  const openSessionTree = vi.fn().mockResolvedValue(undefined)
  const Items: object[] = []
  const treeMethods = {
    addTab: vi.fn(),
    closeTab: vi.fn(),
    saveTab: vi.fn(),
    openTab: vi.fn(),
    closeWindow: vi.fn(),
    saveAndRemoveWindow: vi.fn(),
    openWindow: vi.fn(),
    updateWindowPositionInterval: vi.fn(),
    registerSessionTreeWindow: vi.fn(),
    toggleCollapseTab: vi.fn(),
    toggleCollapseWindow: vi.fn(),
    updateWindow: vi.fn(),
    updateTab: vi.fn(),
    updateNote: vi.fn(),
    updateSeparator: vi.fn(),
    createNote: vi.fn(),
    updateNoteText: vi.fn(),
    toggleCollapseNote: vi.fn(),
    removeNote: vi.fn(),
    duplicateTreeItems: vi.fn(),
    deselectAllItems: vi.fn(),
    treeItemIndentIncrease: vi.fn(),
    treeItemIndentDecrease: vi.fn(),
    moveTabs: vi.fn(),
    moveTreeItems: vi.fn(),
    moveWindows: vi.fn(),
    removeTab: vi.fn(),
    recomputeSessionTree: vi.fn(),
    getTabs: vi.fn((items: Array<{ type: TreeItemType }>) =>
      items.filter((item) => item.type === TreeItemType.TAB),
    ),
    pinTab: vi.fn(),
    unpinTab: vi.fn(),
    pinTabInTree: vi.fn(),
    unpinTabInTree: vi.fn(),
    printSessionTree: vi.fn(),
  }
  const windowsByUid = new Map<UID, object>()
  const tabsByUid = new Map<UID, object>()

  vi.doMock('@/services/background-actions', () => ({
    setupBrowserActionMenu,
    updateBadge,
  }))
  vi.doMock('@/services/background-tree', () => ({
    Tree: {
      Items,
      isWindow: (item: { type: TreeItemType }) =>
        item.type === TreeItemType.WINDOW,
      tabOnActivated,
      setActiveWindow,
      openSessionTree,
      windowsByUid,
      tabsByUid,
      ...treeMethods,
    },
  }))
  vi.doMock('@/services/background-on-created-queue', () => ({
    OnCreatedQueue: {
      isNewTabExtensionGenerated,
    },
  }))
  vi.doMock('@/services/runtime-port-service', () => ({
    initializeSessionTreePort,
  }))
  vi.doMock('@/services/selection', () => ({
    Selection: {
      clearSelection,
    },
  }))

  const { initializeListeners } = await import('@/services/background-handlers')

  return {
    fakeBrowser,
    initializeListeners,
    mocks: {
      clearSelection,
      isNewTabExtensionGenerated,
      initializeSessionTreePort,
      openSessionTree,
      setActiveWindow,
      setupBrowserActionMenu,
      tabOnActivated,
      updateBadge,
      Items,
      windowsByUid,
      tabsByUid,
      ...treeMethods,
    },
  }
}

function getDispatchCommand(
  initializeSessionTreePort: ReturnType<typeof vi.fn>,
): (message: SessionTreeMessage) => void | Promise<void> {
  const config = initializeSessionTreePort.mock.calls[0]?.[0]
  expect(config).toEqual(
    expect.objectContaining({ dispatchCommand: expect.any(Function) }),
  )
  return config.dispatchCommand
}

describe('background handlers', () => {
  beforeEach(() => {
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

    dispatchCommand({
      action: 'moveTreeItems',
      itemUIDs: ['note-2' as UID],
      targetIndex: 4,
      parentUid: 'note-parent' as UID,
      targetWindowUid: 'window-2' as UID,
      copy: false,
      includeDescendants: true,
    })
    dispatchCommand({
      action: 'moveWindows',
      windowUIDs: ['window-3' as UID],
      targetIndex: 5,
      copy: true,
    })
    dispatchCommand({
      action: 'duplicateTreeItems',
      itemUIDs: ['note-1' as UID, 'window-1' as UID],
    })
    dispatchCommand({
      action: 'treeItemIndentIncrease',
      itemUIDs: ['note-2' as UID],
    })
    dispatchCommand({
      action: 'treeItemIndentDecrease',
      itemUIDs: ['window-2' as UID],
    })
    dispatchCommand({ action: 'pinTab', tabUid: 'tab-4' as UID })
    dispatchCommand({ action: 'unpinTab', tabUid: 'tab-5' as UID })
    dispatchCommand({ action: 'openWindowsInSameLocationUpdated' })

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
