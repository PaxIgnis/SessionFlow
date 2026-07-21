import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Settings } from '@/services/settings'
import { State, TreeItemType } from '@/types/session-tree'
import { loadBackgroundHandlers } from '../../helpers/background-handler-harness'

describe('background browser-event update ordering', () => {
  beforeEach(() => {
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.doUnmock('@/services/background-actions')
    vi.doUnmock('@/services/background-on-created-queue')
    vi.doUnmock('@/services/background-session-restore')
    vi.doUnmock('@/services/background-tree')
    vi.doUnmock('@/services/runtime-port-service')
    vi.doUnmock('@/services/selection')
  })

  it('does not let a delayed completed navigation overwrite the current page (EV-08)', async () => {
    const { fakeBrowser, initializeListeners, mocks, setBrowserTabs } =
      await loadBackgroundHandlers()
    mocks.Items.push(treeWindow())
    const currentTab = browserTab({
      title: 'Navigation B',
      url: 'https://example.test/b',
      status: 'complete',
    })
    setBrowserTabs(20, [currentTab])
    initializeListeners()

    await fakeBrowser.tabs.onUpdated.emitAsync(
      10,
      { status: 'complete' },
      browserTab({
        title: 'Delayed navigation A',
        url: 'https://example.test/a',
        status: 'complete',
      }),
    )

    expect(mocks.updateTab).toHaveBeenCalledWith(
      { windowId: 20, tabId: 10 },
      expect.objectContaining({
        title: 'Navigation B',
        url: 'https://example.test/b',
      }),
    )
    expect(mocks.updateTab).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ url: 'https://example.test/a' }),
    )
  })

  it('announces that the current page completed without a favicon (EV-09)', async () => {
    const { fakeBrowser, initializeListeners, mocks, setBrowserTabs } =
      await loadBackgroundHandlers()
    mocks.Items.push(treeWindow())
    fakeBrowser.extension.getViews.mockReturnValue([{}])
    const faviconlessTab = browserTab({
      title: 'No icon',
      url: 'https://example.test/no-icon',
      status: 'complete',
      favIconUrl: undefined,
    })
    setBrowserTabs(20, [faviconlessTab])
    initializeListeners()

    await fakeBrowser.tabs.onUpdated.emitAsync(
      10,
      { status: 'complete' },
      faviconlessTab,
    )

    expect(fakeBrowser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'FAVICON_CLEARED',
      pageUrl: 'https://example.test/no-icon',
    })
  })

  it('folds a navigation update sequence into one indexed tree item (EV-07)', async () => {
    const { fakeBrowser, initializeListeners, mocks, setBrowserTabs } =
      await loadBackgroundHandlers()
    mocks.Items.push(treeWindow())
    const completed = browserTab({
      title: 'Final title',
      url: 'https://example.test/final',
      favIconUrl: 'https://example.test/favicon.ico',
      status: 'complete',
    })
    setBrowserTabs(20, [completed])
    initializeListeners()

    await fakeBrowser.tabs.onUpdated.emitAsync(
      10,
      { status: 'loading' },
      browserTab(),
    )
    await fakeBrowser.tabs.onUpdated.emitAsync(
      10,
      { url: 'https://example.test/final' },
      browserTab({ url: 'https://example.test/final' }),
    )
    await fakeBrowser.tabs.onUpdated.emitAsync(
      10,
      { title: 'Final title' },
      browserTab({
        title: 'Final title',
        url: 'https://example.test/final',
      }),
    )
    await fakeBrowser.tabs.onUpdated.emitAsync(
      10,
      { favIconUrl: 'https://example.test/favicon.ico' },
      browserTab({
        title: 'Final title',
        url: 'https://example.test/final',
        favIconUrl: 'https://example.test/favicon.ico',
      }),
    )
    await fakeBrowser.tabs.onUpdated.emitAsync(
      10,
      { status: 'complete' },
      completed,
    )

    expect(mocks.addTab).not.toHaveBeenCalled()
    expect(mocks.removeTab).not.toHaveBeenCalled()
    expect(mocks.updateTab).toHaveBeenCalledTimes(5)
    expect(mocks.updateTab).toHaveBeenLastCalledWith(
      { windowId: 20, tabId: 10 },
      expect.objectContaining({
        loadingStatus: 'complete',
        title: 'Final title',
        url: 'https://example.test/final',
      }),
    )
  })

  it('changes a discarded tab back to open when it activates and reloads (EV-10)', async () => {
    const { fakeBrowser, initializeListeners, mocks, setBrowserTabs } =
      await loadBackgroundHandlers()
    mocks.Items.push(treeWindow())
    const reloaded = browserTab({
      active: true,
      discarded: false,
      status: 'complete',
      title: 'Reloaded',
    })
    setBrowserTabs(20, [reloaded])
    initializeListeners()

    await fakeBrowser.tabs.onUpdated.emitAsync(
      10,
      { discarded: true, status: 'loading' },
      browserTab({ active: false, discarded: true }),
    )
    fakeBrowser.tabs.onActivated.emit({ tabId: 10, windowId: 20 })
    await fakeBrowser.tabs.onUpdated.emitAsync(
      10,
      { discarded: false, status: 'complete' },
      reloaded,
    )

    expect(mocks.updateTab).toHaveBeenNthCalledWith(
      1,
      { windowId: 20, tabId: 10 },
      expect.objectContaining({ state: State.DISCARDED }),
    )
    expect(mocks.tabOnActivated).toHaveBeenCalledWith(
      { tabId: 10, windowId: 20 },
      5,
    )
    expect(mocks.updateTab).toHaveBeenLastCalledWith(
      { windowId: 20, tabId: 10 },
      expect.objectContaining({ state: State.OPEN, title: 'Reloaded' }),
    )
  })

  it('applies group, pin, title, and URL changes from one update sequence (EV-11)', async () => {
    const { fakeBrowser, initializeListeners, mocks, setBrowserTabs } =
      await loadBackgroundHandlers()
    mocks.Items.push(treeWindow())
    const updated = browserTab({
      pinned: true,
      groupId: 7,
      title: 'Grouped and pinned',
      url: 'https://example.test/grouped',
      status: 'complete',
    })
    setBrowserTabs(20, [updated])
    initializeListeners()

    await fakeBrowser.tabs.onUpdated.emitAsync(
      10,
      { groupId: 7, pinned: true, status: 'complete' },
      updated,
    )

    expect(mocks.pinTabInTree).toHaveBeenCalledWith('tab-10')
    expect(mocks.updateTab).toHaveBeenCalledWith(
      { windowId: 20, tabId: 10 },
      expect.objectContaining({
        pinned: true,
        title: 'Grouped and pinned',
        url: 'https://example.test/grouped',
      }),
    )
    expect(mocks.tabGroupMembershipChanged).toHaveBeenCalledWith(10, 7)
  })

  it('ignores an update for a tab that is not indexed yet (EV-12)', async () => {
    const { fakeBrowser, initializeListeners, mocks, setBrowserTabs } =
      await loadBackgroundHandlers()
    const emptyWindow = treeWindow()
    emptyWindow.children = []
    mocks.Items.push(emptyWindow)
    const unindexed = browserTab({
      id: 99,
      title: 'Too early',
      url: 'https://example.test/too-early',
      status: 'complete',
      groupId: 7,
    })
    setBrowserTabs(20, [unindexed])
    initializeListeners()

    await fakeBrowser.tabs.onUpdated.emitAsync(
      99,
      { groupId: 7, status: 'complete' },
      unindexed,
    )

    expect(mocks.updateTab).not.toHaveBeenCalled()
    expect(mocks.pinTabInTree).not.toHaveBeenCalled()
    expect(mocks.unpinTabInTree).not.toHaveBeenCalled()
    expect(mocks.tabGroupMembershipChanged).not.toHaveBeenCalled()
  })
})

function browserTab(
  overrides: Partial<browser.tabs.Tab> = {},
): browser.tabs.Tab {
  return {
    id: 10,
    windowId: 20,
    index: 0,
    active: true,
    discarded: false,
    hidden: false,
    pinned: false,
    title: 'Original',
    url: 'https://example.test/original',
    status: 'loading',
    ...overrides,
  } as browser.tabs.Tab
}

function treeWindow() {
  return {
    type: TreeItemType.WINDOW,
    uid: 'window-20' as UID,
    id: 20,
    incognito: false,
    selected: false,
    state: State.OPEN,
    indentLevel: 0,
    children: [
      {
        type: TreeItemType.TAB,
        uid: 'tab-10' as UID,
        id: 10,
        windowUid: 'window-20' as UID,
        selected: false,
        state: State.OPEN,
        indentLevel: 1,
        active: true,
        pinned: false,
        title: 'Original',
        url: 'https://example.test/original',
      },
    ],
  }
}
