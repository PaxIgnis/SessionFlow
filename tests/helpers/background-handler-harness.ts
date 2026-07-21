import { expect, vi } from 'vitest'
import type { SessionTreeMessage } from '@/types/messages'
import type { Window } from '@/types/session-tree'
import { TreeItemType } from '@/types/session-tree'
import { installFakeBrowser } from './fake-browser'

export async function loadBackgroundHandlers() {
  vi.resetModules()
  const fakeBrowser = installFakeBrowser()

  const setupBrowserActionMenu = vi.fn()
  const updateBadge = vi.fn()
  const initializeSessionTreePort = vi.fn()
  const clearSelection = vi.fn()
  const isNewTabExtensionGenerated = vi.fn().mockResolvedValue(false)
  const isNewWindowExtensionGenerated = vi.fn().mockResolvedValue(false)
  const beginWindowClassification = vi.fn()
  const handleCreatedTab = vi.fn().mockResolvedValue(false)
  const handleCreatedWindow = vi.fn().mockResolvedValue(false)
  const finishWindowClassification = vi.fn()
  const isTabRelocating = vi.fn().mockReturnValue(false)
  const waitForWindowClassification = vi.fn().mockResolvedValue(undefined)
  const tabOnActivated = vi.fn()
  const setActiveWindow = vi.fn()
  const openSessionTree = vi.fn().mockResolvedValue(undefined)
  const containerMetadata = {
    cookieStoreId: 'firefox-container-1',
    name: 'Work',
    color: 'blue',
    colorCode: '#37adff',
    icon: 'briefcase',
    iconUrl: 'resource://usercontext-content/briefcase.svg',
  }
  const Items: object[] = []
  const treeMethods = {
    addWindow: vi.fn().mockResolvedValue(undefined),
    addTab: vi.fn(),
    closeTab: vi.fn(),
    saveTab: vi.fn(),
    openTab: vi.fn(),
    closeWindow: vi.fn(),
    removeWindow: vi.fn(),
    saveWindow: vi.fn(),
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
    importExternalUrls: vi.fn(),
    moveTabs: vi.fn(),
    moveTreeItems: vi.fn(),
    moveWindows: vi.fn(),
    removeTab: vi.fn(),
    removeSessionWindowId: vi.fn(),
    recomputeSessionTree: vi.fn(),
    getTabs: vi.fn((items: Array<{ type: TreeItemType }>) =>
      items.filter((item) => item.type === TreeItemType.TAB),
    ),
    pinTab: vi.fn(),
    unpinTab: vi.fn(),
    pinTabInTree: vi.fn(),
    unpinTabInTree: vi.fn(),
    setTabSaved: vi.fn(),
    syncOpenTabGroups: vi.fn(),
    tabGroupMembershipChanged: vi.fn().mockResolvedValue(undefined),
    tabGroupMoved: vi.fn(),
    tabGroupRemoved: vi.fn(),
    tabGroupWindowClosed: vi.fn(),
    tabGroupUpdated: vi.fn(),
    containerCreated: vi.fn(),
    containerRemoved: vi.fn(),
    containerUpdated: vi.fn(),
    containerForCookieStore: vi.fn((cookieStoreId?: string) =>
      cookieStoreId === containerMetadata.cookieStoreId
        ? structuredClone(containerMetadata)
        : undefined,
    ),
    printSessionTree: vi.fn(),
  }
  const windowsByUid = new Map<UID, object>()
  const tabsByUid = new Map<UID, object>()
  const browserTabsByWindow = new Map<number, browser.tabs.Tab[]>()
  const browserWindows = new Map<number, browser.windows.Window>()

  fakeBrowser.tabs.query.mockImplementation(
    async (queryInfo: browser.tabs._QueryQueryInfo = {}) => {
      const tabs =
        queryInfo.windowId === undefined
          ? [...browserTabsByWindow.values()].flat()
          : (browserTabsByWindow.get(queryInfo.windowId) ?? [])
      return tabs.filter(
        (tab) => queryInfo.index === undefined || tab.index === queryInfo.index,
      )
    },
  )
  fakeBrowser.tabs.get.mockImplementation(async (tabId: number) => {
    const tab = [...browserTabsByWindow.values()]
      .flat()
      .find((candidate) => candidate.id === tabId)
    if (!tab) throw new Error(`Unknown fake tab ${tabId}`)
    return tab
  })
  fakeBrowser.windows.get.mockImplementation(async (windowId: number) => {
    const window = browserWindows.get(windowId)
    if (!window) throw new Error(`Unknown fake window ${windowId}`)
    return window
  })

  vi.doMock('@/services/background-actions', () => ({
    setupBrowserActionMenu,
    updateBadge,
  }))
  vi.doMock('@/services/background-tree', () => ({
    Tree: {
      Items,
      isWindow: (item: { type: TreeItemType }) =>
        item.type === TreeItemType.WINDOW,
      isNote: (item: { type: TreeItemType }) => item.type === TreeItemType.NOTE,
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
      isNewWindowExtensionGenerated,
    },
  }))
  vi.doMock('@/services/runtime-port-service', () => ({
    initializeSessionTreePort,
  }))
  vi.doMock('@/services/background-session-restore', () => ({
    beginWindowClassification,
    finishWindowClassification,
    handleCreatedTab,
    handleCreatedWindow,
    isTabRelocating,
    waitForWindowClassification,
  }))
  vi.doMock('@/services/selection', () => ({
    Selection: {
      clearSelection,
    },
  }))

  const { Settings: handlerSettings } = await import('@/services/settings')
  const { initializeListeners } = await import('@/services/background-handlers')

  return {
    fakeBrowser,
    settings: handlerSettings,
    initializeListeners,
    setBrowserTabs(windowId: number, tabs: browser.tabs.Tab[]): void {
      browserTabsByWindow.set(windowId, tabs)
    },
    setBrowserWindow(window: browser.windows.Window): void {
      if (window.id === undefined) throw new Error('Fake window requires an ID')
      browserWindows.set(window.id, window)
      if (window.tabs) browserTabsByWindow.set(window.id, window.tabs)
    },
    mocks: {
      clearSelection,
      beginWindowClassification,
      finishWindowClassification,
      handleCreatedTab,
      handleCreatedWindow,
      isNewTabExtensionGenerated,
      isNewWindowExtensionGenerated,
      isTabRelocating,
      initializeSessionTreePort,
      openSessionTree,
      setActiveWindow,
      setupBrowserActionMenu,
      tabOnActivated,
      updateBadge,
      waitForWindowClassification,
      Items,
      windowsByUid,
      tabsByUid,
      ...treeMethods,
    },
  }
}

export function getDispatchCommand(
  initializeSessionTreePort: ReturnType<typeof vi.fn>,
): (message: SessionTreeMessage) => void | Promise<void> {
  const config = initializeSessionTreePort.mock.calls[0]?.[0]
  expect(config).toEqual(
    expect.objectContaining({ dispatchCommand: expect.any(Function) }),
  )
  return config.dispatchCommand
}

export function findWindow(items: object[], windowId: number): Window {
  const window = items.find(
    (item): item is Window =>
      (item as Window).type === TreeItemType.WINDOW &&
      (item as Window).id === windowId,
  )
  if (!window) throw new Error(`Missing tree window ${windowId}`)
  return window
}
