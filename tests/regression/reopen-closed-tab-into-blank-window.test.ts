import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { State } from '@/types/session-tree'
import type { Tab, Window } from '@/types/session-tree'
import { installFakeBrowser } from '../helpers/fake-browser'

/*
 * Reopening a closed tab (Ctrl+Shift+T) into a window whose only tab is a blank
 * new tab makes Firefox remove that blank tab first and create the restored tab
 * second, both with the window still open. Confirmed against Firefox 153:
 *
 *   tab-removed 3 win 35 isWindowClosing false
 *   tab-created 5 win 35 idx 0
 *
 * The removal used to take the whole window with it, because removeTab drops a
 * window once its last child goes. The restored tab then had no window to join,
 * and every later event for that window id was dropped, so the window never
 * came back.
 */
async function loadHandlersWithRealTree() {
  vi.resetModules()
  const fakeBrowser = installFakeBrowser()
  vi.doMock('@/services/runtime-port-service', () => ({
    initializeSessionTreePort: vi.fn(),
    emitTreeDelta: vi.fn(),
  }))
  vi.doMock('@/services/favicons', () => ({
    Favicons: {
      init: vi.fn().mockResolvedValue(undefined),
      updateFavicon: vi.fn().mockResolvedValue(undefined),
      saveCacheToStorage: vi.fn().mockResolvedValue(undefined),
    },
  }))
  vi.doMock('@/services/background-actions', () => ({
    setupBrowserActionMenu: vi.fn(),
    updateBadge: vi.fn(),
  }))

  const { Tree } = await import('@/services/background-tree')
  const { Settings } = await import('@/services/settings')
  const { initializeListeners } = await import('@/services/background-handlers')
  const fixtures = await import('../helpers/tree-fixtures')

  Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  fixtures.resetTree()

  return { fakeBrowser, Tree, Settings, initializeListeners, fixtures }
}

function restoredBrowserTab(overrides: Partial<browser.tabs.Tab> = {}) {
  return {
    active: true,
    discarded: false,
    highlighted: true,
    id: 11,
    incognito: false,
    index: 0,
    pinned: false,
    status: 'complete',
    title: 'Wikipedia',
    url: 'https://www.wikipedia.org/',
    windowId: 20,
    ...overrides,
  } as browser.tabs.Tab
}

async function seedWindowWithOneOpenTab(
  fixtures: Awaited<ReturnType<typeof loadHandlersWithRealTree>>['fixtures'],
) {
  const blankTab = fixtures.createTab('tab-blank' as UID, {
    id: 10,
    state: State.OPEN,
    active: true,
    title: 'New Tab',
    url: 'about:newtab',
  })
  return fixtures.createWindow('window-1' as UID, [blankTab], {
    id: 20,
    state: State.OPEN,
  })
}

describe('reopening a closed tab into a window holding one blank tab', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.doUnmock('@/services/runtime-port-service')
    vi.doUnmock('@/services/favicons')
    vi.doUnmock('@/services/background-actions')
  })

  it('keeps the window tracked and adopts the restored tab', async () => {
    const { fakeBrowser, Tree, initializeListeners, fixtures } =
      await loadHandlersWithRealTree()
    const window = await seedWindowWithOneOpenTab(fixtures)
    initializeListeners()

    const restoredTab = restoredBrowserTab()
    fakeBrowser.tabs.get.mockResolvedValue(restoredTab)
    fakeBrowser.tabs.query.mockResolvedValue([restoredTab])

    // Firefox removes the blank tab it is about to replace...
    fakeBrowser.tabs.onRemoved.emit(10, {
      windowId: 20,
      isWindowClosing: false,
    })

    // ...and the window must survive that gap.
    expect(Tree.windowsByUid.get(window.uid)?.children).toEqual([])

    // ...then it creates the restored tab in the same window.
    await fakeBrowser.tabs.onCreated.emitAsync(restoredTab)

    const trackedWindow = Tree.windowsByUid.get(window.uid)
    expect(trackedWindow).toBeDefined()
    expect(Tree.Items).toEqual([trackedWindow])
    expect(
      Tree.getTabs((trackedWindow as Window).children).map((tab: Tab) => ({
        id: tab.id,
        url: tab.url,
      })),
    ).toEqual([{ id: 11, url: 'https://www.wikipedia.org/' }])
  })

  it('removes the window when Firefox really closed it', async () => {
    const { fakeBrowser, Tree, initializeListeners, fixtures } =
      await loadHandlersWithRealTree()
    await seedWindowWithOneOpenTab(fixtures)
    initializeListeners()

    fakeBrowser.tabs.onRemoved.emit(10, {
      windowId: 20,
      isWindowClosing: false,
    })
    fakeBrowser.windows.onRemoved.emit(20)

    expect(Tree.Items).toEqual([])
  })

  it('drops an emptied window that Firefox never reported as removed', async () => {
    vi.useFakeTimers()
    const { fakeBrowser, Tree, initializeListeners, fixtures } =
      await loadHandlersWithRealTree()
    await seedWindowWithOneOpenTab(fixtures)
    initializeListeners()
    fakeBrowser.tabs.query.mockRejectedValue(new Error('No such window'))

    fakeBrowser.tabs.onRemoved.emit(10, {
      windowId: 20,
      isWindowClosing: false,
    })
    expect(Tree.Items).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1_000)

    expect(Tree.Items).toEqual([])
  })

  it('leaves an emptied window alone while Firefox still has tabs in it', async () => {
    vi.useFakeTimers()
    const { fakeBrowser, Tree, initializeListeners, fixtures } =
      await loadHandlersWithRealTree()
    const window = await seedWindowWithOneOpenTab(fixtures)
    initializeListeners()
    fakeBrowser.tabs.query.mockResolvedValue([restoredBrowserTab()])

    fakeBrowser.tabs.onRemoved.emit(10, {
      windowId: 20,
      isWindowClosing: false,
    })
    await vi.advanceTimersByTimeAsync(1_000)

    expect(Tree.windowsByUid.get(window.uid)).toBeDefined()
  })
})
