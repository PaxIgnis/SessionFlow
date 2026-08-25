import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY } from '@/defaults/constants'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { State, TreeItemType } from '@/types/session-tree'
import { installFakeBrowser } from '../helpers/fake-browser'
import type { FakeBrowser } from '../helpers/fake-browser'

/*
 * Restoring a startup tab whose window is saved makes openTab create a browser
 * window through OnCreatedQueue.createWindowAndWait, which completes only once
 * the windows.onCreated listener acknowledges the new window.
 *
 * initializeWindows used to open those tabs itself, before initializeBackground
 * had registered any listener, so nothing could acknowledge the new window: the
 * creation handshake ran out its 15s timeout and failed with "Timed out waiting
 * for Firefox window creation event". Two pinned startup tabs meant 30s of
 * stalled startup before the session tree could open, and the restored window
 * was left unmatched at the bottom of the tree.
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
  const { initializeListeners } = await import('@/services/background-handlers')
  const fixtures = await import('../helpers/tree-fixtures')

  Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  fixtures.resetTree()

  return { fakeBrowser, Tree, Settings, initializeListeners }
}

function savedWindowWithOpenPinnedTabs() {
  return {
    [STORAGE_KEY]: [
      {
        type: TreeItemType.WINDOW,
        uid: 'window-saved',
        id: 20,
        state: State.OPEN,
        incognito: false,
        indentLevel: 0,
        children: [0, 1].map((index) => ({
          type: TreeItemType.TAB,
          uid: `tab-pinned-${index}`,
          id: 11 + index,
          state: State.OPEN,
          pinned: true,
          title: `Pinned ${index}`,
          url: `https://example.test/pinned-${index}`,
          indentLevel: 1,
        })),
      },
    ],
  }
}

/** Makes creation behave like Firefox: the event follows the call. */
function respondToCreation(fakeBrowser: FakeBrowser) {
  let nextWindowId = 30
  let nextTabId = 300
  const browserTab = (tabId: number, windowId: number, index: number) =>
    ({
      id: tabId,
      index,
      windowId,
      active: true,
      pinned: false,
      highlighted: true,
      incognito: false,
      discarded: false,
      status: 'complete',
      title: 'Restored',
      url: 'https://example.test/restored',
    }) as browser.tabs.Tab

  vi.mocked(fakeBrowser.windows.create).mockImplementation(async () => {
    const windowId = nextWindowId++
    const created = {
      id: windowId,
      focused: true,
      incognito: false,
      alwaysOnTop: false,
      type: 'normal',
      tabs: [browserTab(nextTabId++, windowId, 0)],
    } as browser.windows.Window
    queueMicrotask(() => {
      fakeBrowser.windows.onCreated.emit(created)
      fakeBrowser.tabs.onCreated.emit(created.tabs![0])
    })
    return created
  })

  vi.mocked(fakeBrowser.tabs.create).mockImplementation(
    async (properties: browser.tabs._CreateCreateProperties = {}) => {
      const windowId = properties.windowId ?? nextWindowId
      const created = browserTab(nextTabId++, windowId, properties.index ?? 0)
      queueMicrotask(() => fakeBrowser.tabs.onCreated.emit(created))
      return created
    },
  )
}

/** Drives the queue's polling intervals until the pending work settles. */
async function settle(work: Promise<unknown>): Promise<void> {
  let done = false
  void work.then(
    () => {
      done = true
    },
    () => {
      done = true
    },
  )
  for (let i = 0; i < 400 && !done; i++) {
    await vi.advanceTimersByTimeAsync(100)
  }
  await work
}

describe('startup restoration of a saved window', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.doUnmock('@/services/runtime-port-service')
    vi.doUnmock('@/services/favicons')
    vi.doUnmock('@/services/background-actions')
  })

  it('restores startup tabs without waiting out the creation timeout', async () => {
    const { fakeBrowser, Tree, Settings, initializeListeners } =
      await loadStartupModules()
    Settings.values.restorePreviousSessionOnStartup = true
    vi.mocked(fakeBrowser.storage.local.get).mockResolvedValue(
      savedWindowWithOpenPinnedTabs(),
    )
    // Firefox restored nothing, so both pinned tabs have to be reopened.
    vi.mocked(fakeBrowser.windows.getAll).mockResolvedValue([])
    respondToCreation(fakeBrowser)

    const errors: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.map(String).join(' '))
    })

    vi.useFakeTimers()
    await settle(Tree.initializeWindows())

    // The order initializeBackground uses: listeners first, restoration after.
    initializeListeners()
    await settle(Tree.restoreStartupTabs())

    expect(
      errors.filter((error) => error.includes('Timed out waiting')),
    ).toEqual([])
    expect(fakeBrowser.windows.create).toHaveBeenCalled()
  })

  it('leaves no startup tabs pending once restoration has run', async () => {
    const { fakeBrowser, Tree, Settings, initializeListeners } =
      await loadStartupModules()
    Settings.values.restorePreviousSessionOnStartup = true
    vi.mocked(fakeBrowser.storage.local.get).mockResolvedValue(
      savedWindowWithOpenPinnedTabs(),
    )
    vi.mocked(fakeBrowser.windows.getAll).mockResolvedValue([])
    respondToCreation(fakeBrowser)

    vi.useFakeTimers()
    await settle(Tree.initializeWindows())
    initializeListeners()
    await settle(Tree.restoreStartupTabs())

    const createCalls = vi.mocked(fakeBrowser.windows.create).mock.calls.length
    // A second pass has nothing left to do.
    await settle(Tree.restoreStartupTabs())

    expect(vi.mocked(fakeBrowser.windows.create).mock.calls).toHaveLength(
      createCalls,
    )
  })

  it('does not restore anything when the setting is off', async () => {
    const { fakeBrowser, Tree, Settings, initializeListeners } =
      await loadStartupModules()
    Settings.values.restorePreviousSessionOnStartup = false
    vi.mocked(fakeBrowser.storage.local.get).mockResolvedValue(
      savedWindowWithOpenPinnedTabs(),
    )
    vi.mocked(fakeBrowser.windows.getAll).mockResolvedValue([])
    respondToCreation(fakeBrowser)

    vi.useFakeTimers()
    await settle(Tree.initializeWindows())
    initializeListeners()
    await settle(Tree.restoreStartupTabs())

    expect(fakeBrowser.windows.create).not.toHaveBeenCalled()
  })
})
