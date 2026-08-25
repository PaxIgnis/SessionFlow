import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY } from '@/defaults/constants'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import * as BackgroundActions from '@/services/background-actions'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import { State } from '@/types/session-tree'
import { flushMicrotasks, installFakeBrowser } from '../../helpers/fake-browser'
import { liveTab, liveWindow } from '../../helpers/startup-fixtures'
import {
  createNote,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
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

  it('does not append restored items over a concurrent tree mutation', async () => {
    const original = createNote('persist-original' as UID, { indentLevel: 0 })
    const restored = createNote('persist-restored' as UID, { indentLevel: 0 })
    Tree.Items.push(original)
    const expectedItems = structuredClone(Tree.Items)
    const storageWrite = deferred<void>()
    vi.mocked(browser.storage.local.set).mockReturnValue(storageWrite.promise)

    const append = Tree.appendTreeItemsAfterPersist([restored], expectedItems)
    await vi.waitFor(() => {
      expect(browser.storage.local.set).toHaveBeenCalledTimes(1)
    })

    Tree.Items.push(
      createNote('live-during-persist' as UID, { indentLevel: 0 }),
    )
    storageWrite.resolve()

    await expect(append).rejects.toMatchObject({
      name: 'SessionTreeChangedDuringPersistError',
    })
    expect(Tree.Items.map((item) => item.uid)).toEqual([
      'persist-original',
      'live-during-persist',
    ])
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
    const restoreStartupTabs = vi.fn().mockResolvedValue(undefined)
    const initializeSnapshots = vi.fn().mockResolvedValue(undefined)
    const capturePersistedStartupTree = vi.fn().mockResolvedValue(undefined)
    const stampOpenTreeIdentities = vi.fn().mockResolvedValue(undefined)
    const initializeListeners = vi.fn()
    const scheduleSessionTreeOpenOnStartup = vi.fn()
    const snapshotSettingsUpdated = vi.fn().mockResolvedValue(undefined)
    const faviconSettingsUpdated = vi
      .fn()
      .mockRejectedValue(new Error('favicon refresh failed'))
    const setupSettingsUpdatedListener = vi.fn()

    vi.doMock('@/services/background-actions', () => ({
      initializeSettings,
      scheduleSessionTreeOpenOnStartup,
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
    vi.doMock('@/services/background-session-snapshots', () => ({
      SessionSnapshots: {
        initialize: initializeSnapshots,
        capturePersistedStartupTree,
        handleSettingsUpdated: snapshotSettingsUpdated,
      },
    }))
    vi.doMock('@/services/background-tree', () => ({
      Tree: {
        initializeContainers,
        initializeWindows,
        restoreStartupTabs,
        saveSessionTreeToStorage: vi.fn(),
      },
    }))
    vi.doMock('@/services/favicon-refresh', () => ({
      FaviconRefresh: {
        handleSettingsUpdated: faviconSettingsUpdated,
        initialize: vi.fn().mockResolvedValue(undefined),
      },
    }))
    vi.doMock('@/services/settings', () => ({
      Settings: {
        values: { automaticSessionSnapshots: true },
        setupSettingsUpdatedListener,
        setupFaviconPermissionRemovalListener: vi.fn(),
      },
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
      initializeSnapshots.mock.invocationCallOrder[0],
    )
    expect(initializeSnapshots.mock.invocationCallOrder[0]).toBeLessThan(
      capturePersistedStartupTree.mock.invocationCallOrder[0],
    )
    expect(
      capturePersistedStartupTree.mock.invocationCallOrder[0],
    ).toBeLessThan(initializeContainers.mock.invocationCallOrder[0])
    expect(initializeContainers.mock.invocationCallOrder[0]).toBeLessThan(
      initializeWindows.mock.invocationCallOrder[0],
    )
    expect(initializeWindows.mock.invocationCallOrder[0]).toBeLessThan(
      stampOpenTreeIdentities.mock.invocationCallOrder[0],
    )
    expect(stampOpenTreeIdentities.mock.invocationCallOrder[0]).toBeLessThan(
      initializeListeners.mock.invocationCallOrder[0],
    )
    // Startup restoration creates browser windows, and that creation handshake
    // only completes once the listeners are live, so it has to run after them.
    expect(initializeListeners.mock.invocationCallOrder[0]).toBeLessThan(
      restoreStartupTabs.mock.invocationCallOrder[0],
    )
    expect(restoreStartupTabs.mock.invocationCallOrder[0]).toBeLessThan(
      scheduleSessionTreeOpenOnStartup.mock.invocationCallOrder[0],
    )

    const settingsUpdated = setupSettingsUpdatedListener.mock.calls[0]?.[0] as
      | (() => Promise<void>)
      | undefined
    expect(settingsUpdated).toBeTypeOf('function')
    await settingsUpdated?.().catch(() => undefined)
    expect(snapshotSettingsUpdated).toHaveBeenCalledOnce()
  })

  it('does not capture the persisted startup tree when automatic snapshots are disabled', async () => {
    vi.resetModules()
    installFakeBrowser()
    const initializeSettings = vi.fn().mockResolvedValue(undefined)
    const initializeSnapshots = vi.fn().mockResolvedValue(undefined)
    const capturePersistedStartupTree = vi.fn().mockResolvedValue(undefined)
    const initializeContainers = vi.fn().mockResolvedValue(undefined)
    const initializeWindows = vi.fn().mockResolvedValue(undefined)
    const restoreStartupTabs = vi.fn().mockResolvedValue(undefined)
    const stampOpenTreeIdentities = vi.fn().mockResolvedValue(undefined)
    const initializeListeners = vi.fn()
    const scheduleSessionTreeOpenOnStartup = vi.fn()
    const setupSettingsUpdatedListener = vi.fn()
    const settingsValues = { automaticSessionSnapshots: false }

    vi.doMock('@/services/background-actions', () => ({
      initializeSettings,
      scheduleSessionTreeOpenOnStartup,
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
    vi.doMock('@/services/background-session-snapshots', () => ({
      SessionSnapshots: {
        initialize: initializeSnapshots,
        capturePersistedStartupTree,
        handleSettingsUpdated: vi.fn().mockResolvedValue(undefined),
      },
    }))
    vi.doMock('@/services/background-tree', () => ({
      Tree: {
        initializeContainers,
        initializeWindows,
        restoreStartupTabs,
        saveSessionTreeToStorage: vi.fn(),
      },
    }))
    vi.doMock('@/services/favicon-refresh', () => ({
      FaviconRefresh: {
        handleSettingsUpdated: vi.fn().mockResolvedValue(undefined),
        initialize: vi.fn().mockResolvedValue(undefined),
      },
    }))
    vi.doMock('@/services/settings', () => ({
      Settings: {
        values: settingsValues,
        setupSettingsUpdatedListener,
        setupFaviconPermissionRemovalListener: vi.fn(),
      },
    }))
    vi.stubGlobal('defineBackground', (setup: () => void) => setup())

    await import('@/entrypoints/background')
    await vi.waitFor(() => {
      expect(initializeListeners).toHaveBeenCalledTimes(1)
    })

    expect(initializeSettings).toHaveBeenCalledOnce()
    expect(initializeSnapshots).toHaveBeenCalledOnce()
    expect(capturePersistedStartupTree).not.toHaveBeenCalled()
    expect(initializeContainers).toHaveBeenCalledOnce()
    expect(initializeWindows).toHaveBeenCalledOnce()
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
