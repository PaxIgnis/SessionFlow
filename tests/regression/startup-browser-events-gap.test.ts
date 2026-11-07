import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { State } from '@/types/session-tree'
import { installFakeBrowser } from '../helpers/fake-browser'
import { liveTab, liveWindow } from '../helpers/startup-fixtures'

/*
 * Startup reads the open windows and tabs, then keeps working (tab group sync,
 * identity stamping) before the tree is ready. The tab and window listeners
 * used to be registered only after that, so anything that happened in between
 * was never seen: a tab opened then was missing from the tree for the rest of
 * the session, and a tab closed then stayed in it as open.
 */
async function loadStartupModules() {
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
      getFavicon: vi.fn(),
    },
  }))
  vi.doMock('@/services/background-actions', () => ({
    setupBrowserActionMenu: vi.fn(),
    updateBadge: vi.fn(),
  }))

  const { Tree } = await import('@/services/background-tree')
  const { Settings } = await import('@/services/settings')
  const Handlers = await import('@/services/background-handlers')
  const fixtures = await import('../helpers/tree-fixtures')

  Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  fixtures.resetTree()
  vi.mocked(fakeBrowser.storage.local.get).mockResolvedValue({})

  return { fakeBrowser, Tree, Handlers }
}

function openTabIds(
  Tree: Awaited<ReturnType<typeof loadStartupModules>>['Tree'],
) {
  return [...Tree.tabsByUid.values()]
    .filter((tab) => tab.state === State.OPEN)
    .map((tab) => tab.id)
    .sort((a, b) => a - b)
}

describe('browser events during startup', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.doUnmock('@/services/runtime-port-service')
    vi.doUnmock('@/services/favicons')
    vi.doUnmock('@/services/background-actions')
  })

  it('applies tabs opened and closed after the startup snapshot', async () => {
    const { fakeBrowser, Tree, Handlers } = await loadStartupModules()
    vi.mocked(fakeBrowser.windows.getAll).mockResolvedValue([
      liveWindow(1, [liveTab(11, 1, 0), liveTab(12, 1, 1)]),
    ])
    const openedLate = liveTab(13, 1, 2, { title: 'Opened during startup' })
    vi.mocked(fakeBrowser.tabs.get).mockResolvedValue(openedLate)

    // The order initializeBackground uses.
    Handlers.holdBrowserEventsUntilStartup()
    await Tree.initializeWindows()
    // Firefox changes the tabs while startup is still finishing.
    fakeBrowser.tabs.onCreated.emit(openedLate)
    fakeBrowser.tabs.onRemoved.emit(12, { windowId: 1, isWindowClosing: false })
    Handlers.initializeListeners()

    expect(openTabIds(Tree)).toEqual([11, 12])

    Handlers.releaseHeldBrowserEvents()

    await vi.waitFor(() => {
      expect(openTabIds(Tree)).toEqual([11, 13])
    })
  })

  it('does not duplicate a tab whose event arrived before the snapshot', async () => {
    const { fakeBrowser, Tree, Handlers } = await loadStartupModules()
    const early = liveTab(12, 1, 1, { title: 'Opened before the snapshot' })
    let resolveWindows!: (windows: browser.windows.Window[]) => void
    vi.mocked(fakeBrowser.windows.getAll).mockReturnValue(
      new Promise((resolve) => {
        resolveWindows = resolve
      }),
    )
    vi.mocked(fakeBrowser.tabs.get).mockResolvedValue(early)

    Handlers.holdBrowserEventsUntilStartup()
    const initialization = Tree.initializeWindows()
    await vi.waitFor(() => {
      expect(fakeBrowser.windows.getAll).toHaveBeenCalled()
    })
    fakeBrowser.tabs.onCreated.emit(early)
    resolveWindows([liveWindow(1, [liveTab(11, 1, 0), early])])
    await initialization
    Handlers.initializeListeners()
    Handlers.releaseHeldBrowserEvents()

    // Let the held creation run to completion.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(openTabIds(Tree)).toEqual([11, 12])
  })

  it('handles events straight away when startup is not holding them', async () => {
    const { fakeBrowser, Tree, Handlers } = await loadStartupModules()
    vi.mocked(fakeBrowser.windows.getAll).mockResolvedValue([
      liveWindow(1, [liveTab(11, 1, 0), liveTab(12, 1, 1)]),
    ])
    await Tree.initializeWindows()
    Handlers.initializeListeners()

    fakeBrowser.tabs.onRemoved.emit(12, { windowId: 1, isWindowClosing: false })

    expect(openTabIds(Tree)).toEqual([11])
  })
})
