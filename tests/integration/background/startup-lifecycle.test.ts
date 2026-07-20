import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY } from '@/defaults/constants'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import * as BackgroundActions from '@/services/background-actions'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import { State } from '@/types/session-tree'
import { flushMicrotasks, installFakeBrowser } from '../../helpers/fake-browser'
import { liveTab, liveWindow } from '../../helpers/startup-fixtures'
import { createTab, createWindow, resetTree } from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

describe('startup lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    installFakeBrowser()
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('ST-20 includes browser state created while stored data is loading', async () => {
    const storageRead = deferred<Record<string, unknown>>()
    vi.mocked(browser.storage.local.get).mockReturnValue(storageRead.promise)
    vi.mocked(browser.windows.getAll).mockResolvedValue([])

    const initialization = Tree.initializeWindows()
    await flushMicrotasks()
    vi.mocked(browser.windows.getAll).mockResolvedValue([
      liveWindow(500, [
        liveTab(501, 500, 0, {
          title: 'Created during storage load',
          url: 'https://example.test/during-storage-load',
        }),
      ]),
    ])
    storageRead.resolve({})

    await initialization

    expect(Tree.Items.filter(Tree.isWindow)).toHaveLength(1)
    expect([...Tree.tabsByUid.values()]).toEqual([
      expect.objectContaining({
        id: 501,
        title: 'Created during storage load',
        state: State.OPEN,
      }),
    ])
    expectTreeInvariants()
  })

  it('ST-20 uses the final Firefox snapshot returned by a pending window query', async () => {
    const windowsRead = deferred<browser.windows.Window[]>()
    vi.mocked(browser.storage.local.get).mockResolvedValue({})
    vi.mocked(browser.windows.getAll).mockReturnValue(windowsRead.promise)

    const initialization = Tree.initializeWindows()
    await vi.waitFor(() => {
      expect(browser.windows.getAll).toHaveBeenCalledWith({ populate: true })
    })
    windowsRead.resolve([
      liveWindow(510, [
        liveTab(511, 510, 0, {
          title: 'Final pending snapshot',
          url: 'https://example.test/final-pending-snapshot',
        }),
      ]),
    ])

    await initialization

    expect(Tree.Items.filter(Tree.isWindow)).toHaveLength(1)
    expect([...Tree.tabsByUid.values()][0]).toMatchObject({
      id: 511,
      title: 'Final pending snapshot',
    })
    expectTreeInvariants()
  })

  it('ST-22 persists the latest tree on each one-minute background tick', async () => {
    vi.useFakeTimers()
    const startSessionTreePersistence = (
      BackgroundActions as typeof BackgroundActions & {
        startSessionTreePersistence?: () => NodeJS.Timeout
      }
    ).startSessionTreePersistence
    expect(startSessionTreePersistence).toBeTypeOf('function')

    const tab = createTab('tab-periodic' as UID, {
      state: State.SAVED,
      title: 'Before timer',
    })
    createWindow('window-periodic' as UID, [tab])
    const timer = startSessionTreePersistence!()

    await vi.advanceTimersByTimeAsync(59_999)
    expect(browser.storage.local.set).not.toHaveBeenCalled()

    tab.title = 'Latest before timer'
    await vi.advanceTimersByTimeAsync(1)
    expect(browser.storage.local.set).toHaveBeenCalledTimes(1)
    expect(browser.storage.local.set).toHaveBeenLastCalledWith({
      [STORAGE_KEY]: expect.arrayContaining([
        expect.objectContaining({
          uid: 'window-periodic',
          children: expect.arrayContaining([
            expect.objectContaining({
              uid: 'tab-periodic',
              title: 'Latest before timer',
            }),
          ]),
        }),
      ]),
    })

    clearInterval(timer)
  })

  it('ST-22 logs a failed tick and retries on the next interval', async () => {
    vi.useFakeTimers()
    const startSessionTreePersistence = (
      BackgroundActions as typeof BackgroundActions & {
        startSessionTreePersistence?: () => NodeJS.Timeout
      }
    ).startSessionTreePersistence
    expect(startSessionTreePersistence).toBeTypeOf('function')
    createWindow('window-periodic-retry' as UID, [
      createTab('tab-periodic-retry' as UID),
    ])
    const writeError = new Error('periodic quota error')
    vi.mocked(browser.storage.local.set)
      .mockRejectedValueOnce(writeError)
      .mockResolvedValueOnce(undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const timer = startSessionTreePersistence!()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to persist session tree:',
      writeError,
    )
    await vi.advanceTimersByTimeAsync(60_000)
    expect(browser.storage.local.set).toHaveBeenCalledTimes(2)

    clearInterval(timer)
  })

  it('ST-21 finishes settings and container setup before tree reconciliation', async () => {
    vi.resetModules()
    installFakeBrowser()
    const settingsReady = deferred<void>()
    const initializeSettings = vi.fn(() => settingsReady.promise)
    const initializeContainers = vi.fn().mockResolvedValue(undefined)
    const initializeWindows = vi.fn().mockResolvedValue(undefined)
    const stampOpenTreeIdentities = vi.fn().mockResolvedValue(undefined)
    const initializeListeners = vi.fn()

    vi.doMock('@/services/background-actions', () => ({
      initializeSettings,
      setupBrowserActionMenu: vi.fn(),
      startSessionTreePersistence: vi.fn(),
      updateBadgeOnStartup: vi.fn(),
    }))
    vi.doMock('@/services/background-deferred-events-queue', () => ({
      DeferredEventsQueue: { initializeDeferredEventsQueue: vi.fn() },
    }))
    vi.doMock('@/services/background-handlers', () => ({
      initializeContainerListeners: vi.fn(),
      initializeListeners,
    }))
    vi.doMock('@/services/background-private-window-onboarding', () => ({
      initializePrivateWindowOnboarding: vi.fn(),
    }))
    vi.doMock('@/services/background-session-restore', () => ({
      stampOpenTreeIdentities,
    }))
    vi.doMock('@/services/background-tree', () => ({
      Tree: {
        initializeContainers,
        initializeWindows,
        saveSessionTreeToStorage: vi.fn(),
      },
    }))
    vi.doMock('@/services/favicon-refresh', () => ({
      FaviconRefresh: {
        handleSettingsUpdated: vi.fn(),
        initialize: vi.fn().mockResolvedValue(undefined),
      },
    }))
    vi.doMock('@/services/settings', () => ({
      Settings: { setupSettingsUpdatedListener: vi.fn() },
    }))
    vi.stubGlobal('defineBackground', (setup: () => void) => setup())

    await import('@/entrypoints/background')
    expect(initializeSettings).toHaveBeenCalledTimes(1)
    expect(initializeContainers).not.toHaveBeenCalled()
    expect(initializeWindows).not.toHaveBeenCalled()

    settingsReady.resolve()
    await vi.waitFor(() => {
      expect(initializeListeners).toHaveBeenCalledTimes(1)
    })

    expect(initializeSettings.mock.invocationCallOrder[0]).toBeLessThan(
      initializeContainers.mock.invocationCallOrder[0],
    )
    expect(initializeContainers.mock.invocationCallOrder[0]).toBeLessThan(
      initializeWindows.mock.invocationCallOrder[0],
    )
    expect(initializeWindows.mock.invocationCallOrder[0]).toBeLessThan(
      stampOpenTreeIdentities.mock.invocationCallOrder[0],
    )
    expect(stampOpenTreeIdentities.mock.invocationCallOrder[0]).toBeLessThan(
      initializeListeners.mock.invocationCallOrder[0],
    )
  })
})

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}
