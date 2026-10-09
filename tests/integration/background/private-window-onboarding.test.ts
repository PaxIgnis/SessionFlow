import { initializePrivateWindowOnboarding } from '@/services/background-private-window-onboarding'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { normalizeSettings } from '@/services/settings-actions'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushMicrotasks, installFakeBrowser } from '../../helpers/fake-browser'

vi.mock('@/services/favicon-refresh', () => ({
  FaviconRefresh: {
    handleSettingsUpdated: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('@/services/background-session-snapshots', () => ({
  SessionSnapshots: {
    handleSettingsUpdated: vi.fn().mockResolvedValue(undefined),
  },
}))

describe('first-run introduction', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })

  it.each([true, false])(
    'opens a welcome tab on install with private access %s',
    async (allowed) => {
      const fake = installFakeBrowser()
      fake.extension.isAllowedIncognitoAccess!.mockResolvedValue(allowed)
      initializePrivateWindowOnboarding()
      fake.runtime.onInstalled.emit({ reason: 'install', temporary: false })
      await vi.waitFor(() => expect(fake.tabs.create).toHaveBeenCalledOnce())
      expect(fake.tabs.create).toHaveBeenCalledWith({
        url: 'moz-extension://test-id/onboarding.html',
      })
      expect(fake.storage.local.set).toHaveBeenCalledWith({
        privateWindowOnboarding: { status: 'pending', version: 1 },
      })
      expect(fake.browserAction.setPopup).toHaveBeenCalledWith({ popup: '' })
      expect(fake.browserAction.openPopup).not.toHaveBeenCalled()
    },
  )

  it('does not open a welcome tab on update or restart, even when pending', async () => {
    const fake = installFakeBrowser()
    fake.storage.local.get.mockResolvedValue({
      privateWindowOnboarding: { status: 'pending', version: 1 },
    })
    initializePrivateWindowOnboarding()
    fake.runtime.onInstalled.emit({ reason: 'update', temporary: false })
    await flushMicrotasks()
    expect(fake.tabs.create).not.toHaveBeenCalled()
    expect(fake.storage.local.set).not.toHaveBeenCalled()
    expect(fake.browserAction.setPopup).toHaveBeenCalledWith({ popup: '' })
  })

  it('still opens the welcome tab if pending-state persistence fails', async () => {
    const fake = installFakeBrowser()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fake.storage.local.set.mockRejectedValueOnce(
      new Error('storage unavailable'),
    )
    initializePrivateWindowOnboarding()
    fake.runtime.onInstalled.emit({ reason: 'install', temporary: false })
    await vi.waitFor(() => expect(fake.tabs.create).toHaveBeenCalledOnce())
  })

  it('opens the real tree without an in-tree guide after background startup', async () => {
    const fake = installFakeBrowser()
    const openTree = vi
      .spyOn(Tree, 'openSessionTree')
      .mockResolvedValue(undefined)
    let ready!: () => void
    initializePrivateWindowOnboarding(
      new Promise<void>((resolve) => {
        ready = resolve
      }),
    )
    const complete = fake.runtime.onMessage.listeners[0]({
      action: 'onboarding',
      command: 'continue',
    })
    await flushMicrotasks()
    expect(openTree).not.toHaveBeenCalled()
    ready()
    await complete
    expect(openTree).toHaveBeenCalledOnce()
    expect(fake.storage.local.set).toHaveBeenCalledWith({
      privateWindowOnboarding: { status: 'completed', version: 1 },
      sessionTreeIntroduction: { step: -1 },
    })
  })

  it('skips the introduction without opting into private retention', async () => {
    const fake = installFakeBrowser()
    vi.spyOn(Tree, 'openSessionTree').mockResolvedValue(undefined)
    initializePrivateWindowOnboarding()
    await fake.runtime.onMessage.listeners[0]({
      action: 'onboarding',
      command: 'continue',
    })
    expect(fake.storage.local.set).toHaveBeenCalledWith({
      privateWindowOnboarding: { status: 'completed', version: 1 },
      sessionTreeIntroduction: { step: -1 },
    })
    expect(Settings.values.retainPrivateWindows).toBe(false)
    expect(fake.storage.local.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ settings: expect.anything() }),
    )
  })

  it('routes import to Storage without restoring or closing browser tabs', async () => {
    const fake = installFakeBrowser()
    const openTree = vi
      .spyOn(Tree, 'openSessionTree')
      .mockResolvedValue(undefined)
    initializePrivateWindowOnboarding()
    await fake.runtime.onMessage.listeners[0]({
      action: 'onboarding',
      command: 'import',
    })
    expect(fake.tabs.create).toHaveBeenCalledWith({
      url: 'moz-extension://test-id/options.html#settings_storage',
    })
    expect(openTree).not.toHaveBeenCalled()
    expect(fake.tabs.remove).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'applies an explicit private-retention choice %s before opening the tree',
    async (retainPrivateWindows) => {
      const fake = installFakeBrowser()
      await Settings.loadSettingsFromStorage()
      const saveTree = vi
        .spyOn(Tree, 'saveSessionTreeToStorage')
        .mockResolvedValue(undefined)
      const openTree = vi
        .spyOn(Tree, 'openSessionTree')
        .mockResolvedValue(undefined)
      initializePrivateWindowOnboarding()
      await fake.runtime.onMessage.listeners[0]({
        action: 'onboarding',
        command: 'set-retention',
        retainPrivateWindows,
      })
      await fake.runtime.onMessage.listeners[0]({
        action: 'onboarding',
        command: 'continue',
      })
      expect(fake.storage.local.set).toHaveBeenCalledWith({
        settings: expect.objectContaining({
          retainPrivateWindows,
          includePrivateWindowsInSessionSnapshots: retainPrivateWindows,
          cachePrivateTabFavicons: retainPrivateWindows,
        }),
      })
      expect(saveTree).toHaveBeenCalledOnce()
      expect(saveTree.mock.invocationCallOrder[0]).toBeLessThan(
        openTree.mock.invocationCallOrder[0],
      )
    },
  )

  it('preserves existing preferences when replayed without a new retention choice', async () => {
    const fake = installFakeBrowser()
    Object.assign(
      Settings.values,
      normalizeSettings({ cachePrivateTabFavicons: false }),
    )
    const saveSettings = vi
      .spyOn(Settings, 'saveSettingsToStorage')
      .mockResolvedValue(undefined)
    vi.spyOn(Tree, 'openSessionTree').mockResolvedValue(undefined)
    initializePrivateWindowOnboarding()
    await fake.runtime.onMessage.listeners[0]({
      action: 'onboarding',
      command: 'continue',
    })
    expect(Settings.values.retainPrivateWindows).toBe(true)
    expect(Settings.values.cachePrivateTabFavicons).toBe(false)
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'saves a startup choice %s before opening the tree without altering privacy preferences',
    async (openSessionTreeOnStartup) => {
      const fake = installFakeBrowser()
      fake.storage.local.get.mockResolvedValue({
        settings: {
          ...DEFAULT_SETTINGS,
          openSessionTreeOnStartup: !openSessionTreeOnStartup,
        },
      })
      await Settings.loadSettingsFromStorage()
      const saveTree = vi
        .spyOn(Tree, 'saveSessionTreeToStorage')
        .mockResolvedValue(undefined)
      const openTree = vi
        .spyOn(Tree, 'openSessionTree')
        .mockResolvedValue(undefined)
      initializePrivateWindowOnboarding()
      await fake.runtime.onMessage.listeners[0]({
        action: 'onboarding',
        command: 'set-startup',
        openSessionTreeOnStartup,
      })
      await fake.runtime.onMessage.listeners[0]({
        action: 'onboarding',
        command: 'continue',
      })
      expect(fake.storage.local.set).toHaveBeenCalledWith({
        settings: expect.objectContaining({
          openSessionTreeOnStartup,
          retainPrivateWindows: false,
          includePrivateWindowsInSessionSnapshots: false,
          cachePrivateTabFavicons: false,
        }),
      })
      expect(fake.storage.local.set.mock.invocationCallOrder[0]).toBeLessThan(
        openTree.mock.invocationCallOrder[0],
      )
      expect(saveTree).not.toHaveBeenCalled()
    },
  )

  it('completes import when no other view receives the settings notification', async () => {
    const fake = installFakeBrowser()
    await Settings.loadSettingsFromStorage()
    vi.spyOn(Tree, 'saveSessionTreeToStorage').mockResolvedValue(undefined)
    fake.runtime.sendMessage.mockRejectedValue(
      new Error('Receiving end does not exist'),
    )
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    initializePrivateWindowOnboarding()
    await fake.runtime.onMessage.listeners[0]({
      action: 'onboarding',
      command: 'set-retention',
      retainPrivateWindows: true,
    })
    await expect(
      fake.runtime.onMessage.listeners[0]({
        action: 'onboarding',
        command: 'import',
      }),
    ).resolves.toBeUndefined()
    expect(fake.tabs.create).toHaveBeenCalledWith({
      url: 'moz-extension://test-id/options.html#settings_storage',
    })
  })

  it('completion does not save preferences or apply obsolete preference arguments', async () => {
    const fake = installFakeBrowser()
    vi.spyOn(Tree, 'openSessionTree').mockResolvedValue(undefined)
    const saveSettings = vi.spyOn(Settings, 'saveSettingsToStorage')
    initializePrivateWindowOnboarding()
    await fake.runtime.onMessage.listeners[0]({
      action: 'onboarding',
      command: 'continue',
      retainPrivateWindows: true,
      openSessionTreeOnStartup: true,
    })
    expect(saveSettings).not.toHaveBeenCalled()
    expect(Settings.values.retainPrivateWindows).toBe(false)
    expect(Settings.values.openSessionTreeOnStartup).toBe(false)
  })

  it('allows completion to be retried after failure and replayed after success', async () => {
    const fake = installFakeBrowser()
    const openTree = vi
      .spyOn(Tree, 'openSessionTree')
      .mockRejectedValueOnce(new Error('window unavailable'))
      .mockResolvedValue(undefined)
    initializePrivateWindowOnboarding()
    const message = { action: 'onboarding', command: 'continue' }
    await expect(fake.runtime.onMessage.listeners[0](message)).rejects.toThrow(
      'window unavailable',
    )
    await fake.runtime.onMessage.listeners[0](message)
    await fake.runtime.onMessage.listeners[0](message)
    expect(openTree).toHaveBeenCalledTimes(3)
  })

  it('coalesces repeated clicks and rejects malformed preferences', async () => {
    const fake = installFakeBrowser()
    const openTree = vi
      .spyOn(Tree, 'openSessionTree')
      .mockResolvedValue(undefined)
    let ready!: () => void
    initializePrivateWindowOnboarding(
      new Promise<void>((resolve) => {
        ready = resolve
      }),
    )
    const listener = fake.runtime.onMessage.listeners[0]
    expect(
      listener({
        action: 'onboarding',
        command: 'set-retention',
        retainPrivateWindows: 'yes',
      }),
    ).toBeUndefined()
    expect(
      listener({ action: 'onboarding', command: 'unknown' }),
    ).toBeUndefined()
    expect(
      listener({
        action: 'onboarding',
        command: 'set-startup',
        openSessionTreeOnStartup: 'yes',
      }),
    ).toBeUndefined()
    const first = listener({
      action: 'onboarding',
      command: 'continue',
    })
    const second = listener({
      action: 'onboarding',
      command: 'continue',
    })
    expect(first).toBe(second)
    ready()
    await first
    expect(openTree).toHaveBeenCalledOnce()
  })

  it('initializes onboarding before asynchronous background startup', async () => {
    vi.resetModules()
    installFakeBrowser()
    const initializePrivateWindowOnboarding = vi.fn()
    const initializeSettings = vi.fn(() => new Promise<void>(() => undefined))
    const initializeContainerListeners = vi.fn()

    vi.doMock('@/services/background-private-window-onboarding', () => ({
      initializePrivateWindowOnboarding,
    }))
    vi.doMock('@/services/background-actions', () => ({
      initializeSettings,
      setupBrowserActionMenu: vi.fn(),
      updateBadgeOnStartup: vi.fn(),
    }))
    vi.doMock('@/services/background-deferred-events-queue', () => ({
      DeferredEventsQueue: {
        initializeDeferredEventsQueue: vi.fn(),
      },
    }))
    vi.doMock('@/services/background-handlers', () => ({
      initializeContainerListeners,
      initializeListeners: vi.fn(),
    }))
    vi.doMock('@/services/background-tree', () => ({
      Tree: {
        initializeWindows: vi.fn(),
        saveSessionTreeToStorage: vi.fn(),
      },
    }))
    vi.doMock('@/services/favicon-refresh', () => ({
      FaviconRefresh: {
        handleSettingsUpdated: vi.fn(),
        initialize: vi.fn(),
      },
    }))
    vi.doMock('@/services/settings', () => ({
      Settings: {
        setupSettingsUpdatedListener: vi.fn(),
      },
    }))
    vi.stubGlobal('defineBackground', (setup: () => void) => setup())

    await import('@/entrypoints/background')

    expect(initializePrivateWindowOnboarding).toHaveBeenCalledTimes(1)
    expect(
      initializePrivateWindowOnboarding.mock.invocationCallOrder[0],
    ).toBeLessThan(initializeSettings.mock.invocationCallOrder[0])
    expect(
      initializeContainerListeners.mock.invocationCallOrder[0],
    ).toBeLessThan(initializeSettings.mock.invocationCallOrder[0])
  })
})
