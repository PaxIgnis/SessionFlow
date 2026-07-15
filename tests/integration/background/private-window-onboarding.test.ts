import { initializePrivateWindowOnboarding } from '@/services/background-private-window-onboarding'
import { Tree } from '@/services/background-tree'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushMicrotasks, installFakeBrowser } from '../../helpers/fake-browser'

describe('private-window onboarding', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('arms and opens the toolbar popup after a fresh install', async () => {
    const fakeBrowser = installFakeBrowser()
    fakeBrowser.extension.isAllowedIncognitoAccess!.mockResolvedValue(false)
    initializePrivateWindowOnboarding()

    fakeBrowser.runtime.onInstalled.emit({
      reason: 'install',
      temporary: false,
    })

    await vi.waitFor(() => {
      expect(fakeBrowser.browserAction.openPopup).toHaveBeenCalledTimes(1)
    })
    expect(fakeBrowser.storage.local.set).toHaveBeenCalledWith({
      privateWindowOnboarding: { status: 'pending' },
    })
    expect(fakeBrowser.browserAction.setPopup).toHaveBeenCalledWith({
      popup: 'private-window-onboarding.html',
    })
  })

  it('silently completes a fresh install when private access is allowed', async () => {
    const fakeBrowser = installFakeBrowser()
    const openSessionTree = vi
      .spyOn(Tree, 'openSessionTree')
      .mockResolvedValue(undefined)
    initializePrivateWindowOnboarding()

    fakeBrowser.runtime.onInstalled.emit({
      reason: 'install',
      temporary: false,
    })

    await vi.waitFor(() => {
      expect(fakeBrowser.storage.local.set).toHaveBeenLastCalledWith({
        privateWindowOnboarding: { status: 'completed' },
      })
    })
    expect(fakeBrowser.browserAction.setPopup).toHaveBeenCalledWith({
      popup: '',
    })
    expect(fakeBrowser.browserAction.openPopup).not.toHaveBeenCalled()
    expect(openSessionTree).not.toHaveBeenCalled()
  })

  it('does not prompt after an extension update', async () => {
    const fakeBrowser = installFakeBrowser()
    initializePrivateWindowOnboarding()

    fakeBrowser.runtime.onInstalled.emit({
      reason: 'update',
      previousVersion: '0.0.0',
      temporary: false,
    })
    await flushMicrotasks()

    expect(fakeBrowser.storage.local.set).not.toHaveBeenCalled()
    expect(fakeBrowser.browserAction.setPopup).not.toHaveBeenCalled()
    expect(fakeBrowser.browserAction.openPopup).not.toHaveBeenCalled()
  })

  it('restores a pending popup after background startup', async () => {
    const fakeBrowser = installFakeBrowser()
    fakeBrowser.extension.isAllowedIncognitoAccess!.mockResolvedValue(false)
    fakeBrowser.storage.local.get.mockResolvedValue({
      privateWindowOnboarding: { status: 'pending' },
    })

    initializePrivateWindowOnboarding()

    await vi.waitFor(() => {
      expect(fakeBrowser.browserAction.setPopup).toHaveBeenCalledWith({
        popup: 'private-window-onboarding.html',
      })
    })
    expect(fakeBrowser.browserAction.openPopup).not.toHaveBeenCalled()
  })

  it('silently completes restored pending onboarding when private access is allowed', async () => {
    const fakeBrowser = installFakeBrowser()
    const openSessionTree = vi
      .spyOn(Tree, 'openSessionTree')
      .mockResolvedValue(undefined)
    fakeBrowser.storage.local.get.mockResolvedValue({
      privateWindowOnboarding: { status: 'pending' },
    })

    initializePrivateWindowOnboarding()

    await vi.waitFor(() => {
      expect(fakeBrowser.storage.local.set).toHaveBeenLastCalledWith({
        privateWindowOnboarding: { status: 'completed' },
      })
    })
    expect(fakeBrowser.browserAction.setPopup).toHaveBeenCalledWith({
      popup: '',
    })
    expect(fakeBrowser.browserAction.openPopup).not.toHaveBeenCalled()
    expect(openSessionTree).not.toHaveBeenCalled()
  })

  it('does not re-arm completed onboarding when private access is denied later', async () => {
    const fakeBrowser = installFakeBrowser()
    fakeBrowser.extension.isAllowedIncognitoAccess!.mockResolvedValue(false)
    fakeBrowser.storage.local.get.mockResolvedValue({
      privateWindowOnboarding: { status: 'completed' },
    })

    initializePrivateWindowOnboarding()
    await flushMicrotasks()

    expect(fakeBrowser.storage.local.set).not.toHaveBeenCalled()
    expect(fakeBrowser.browserAction.setPopup).not.toHaveBeenCalled()
    expect(fakeBrowser.browserAction.openPopup).not.toHaveBeenCalled()
  })

  it('does not re-arm pending onboarding after concurrent completion', async () => {
    const fakeBrowser = installFakeBrowser()
    let resolveAccess: (allowed: boolean) => void = () => undefined
    fakeBrowser.extension.isAllowedIncognitoAccess!.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveAccess = resolve
        }),
    )
    fakeBrowser.storage.local.get.mockResolvedValue({
      privateWindowOnboarding: { status: 'pending' },
    })
    initializePrivateWindowOnboarding()

    await vi.waitFor(() => {
      expect(
        fakeBrowser.extension.isAllowedIncognitoAccess,
      ).toHaveBeenCalledTimes(1)
    })

    fakeBrowser.runtime.onMessage.emit({
      action: 'privateWindowOnboarding',
      command: 'dismiss',
    })
    await vi.waitFor(() => {
      expect(fakeBrowser.browserAction.setPopup).toHaveBeenLastCalledWith({
        popup: '',
      })
    })

    resolveAccess(false)
    await flushMicrotasks()

    expect(fakeBrowser.browserAction.setPopup).toHaveBeenCalledTimes(1)
    expect(fakeBrowser.browserAction.setPopup).toHaveBeenLastCalledWith({
      popup: '',
    })
  })

  it('keeps the popup armed when Firefox rejects automatic opening', async () => {
    const fakeBrowser = installFakeBrowser()
    fakeBrowser.extension.isAllowedIncognitoAccess!.mockResolvedValue(false)
    const error = new Error('openPopup requires a user gesture')
    const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    fakeBrowser.browserAction.openPopup.mockRejectedValue(error)
    initializePrivateWindowOnboarding()

    fakeBrowser.runtime.onInstalled.emit({
      reason: 'install',
      temporary: false,
    })

    await vi.waitFor(() => {
      expect(consoleDebug).toHaveBeenCalledWith(
        'Private-window onboarding will open on the first toolbar click:',
        error,
      )
    })
    expect(fakeBrowser.browserAction.setPopup).toHaveBeenCalledWith({
      popup: 'private-window-onboarding.html',
    })
  })

  it('leaves onboarding pending for an unsupported command', async () => {
    const fakeBrowser = installFakeBrowser()
    const openSessionTree = vi
      .spyOn(Tree, 'openSessionTree')
      .mockResolvedValue(undefined)
    initializePrivateWindowOnboarding()

    fakeBrowser.runtime.onMessage.emit({
      action: 'privateWindowOnboarding',
      command: 'hide',
    })
    await flushMicrotasks()

    expect(fakeBrowser.storage.local.set).not.toHaveBeenCalled()
    expect(fakeBrowser.browserAction.setPopup).not.toHaveBeenCalled()
    expect(openSessionTree).not.toHaveBeenCalled()
  })

  it('completes onboarding and opens Session Tree when continuing', async () => {
    const fakeBrowser = installFakeBrowser()
    const openSessionTree = vi
      .spyOn(Tree, 'openSessionTree')
      .mockResolvedValue(undefined)
    initializePrivateWindowOnboarding()

    fakeBrowser.runtime.onMessage.emit({
      action: 'privateWindowOnboarding',
      command: 'continue',
    })

    await vi.waitFor(() => {
      expect(openSessionTree).toHaveBeenCalledTimes(1)
    })
    expect(fakeBrowser.storage.local.set).toHaveBeenCalledWith({
      privateWindowOnboarding: { status: 'completed' },
    })
    expect(fakeBrowser.browserAction.setPopup).toHaveBeenCalledWith({
      popup: '',
    })
  })

  it('waits for background startup before opening Session Tree', async () => {
    const fakeBrowser = installFakeBrowser()
    const openSessionTree = vi
      .spyOn(Tree, 'openSessionTree')
      .mockResolvedValue(undefined)
    let markBackgroundReady: () => void = () => undefined
    const backgroundReady = new Promise<void>((resolve) => {
      markBackgroundReady = resolve
    })
    initializePrivateWindowOnboarding(backgroundReady)

    fakeBrowser.runtime.onMessage.emit({
      action: 'privateWindowOnboarding',
      command: 'continue',
    })
    await flushMicrotasks()

    expect(openSessionTree).not.toHaveBeenCalled()

    markBackgroundReady()
    await vi.waitFor(() => {
      expect(openSessionTree).toHaveBeenCalledTimes(1)
    })
  })

  it('coalesces concurrent completion messages', async () => {
    const fakeBrowser = installFakeBrowser()
    fakeBrowser.storage.local.set.mockImplementation(
      () => new Promise<void>(() => undefined),
    )
    const openSessionTree = vi
      .spyOn(Tree, 'openSessionTree')
      .mockResolvedValue(undefined)
    initializePrivateWindowOnboarding()

    fakeBrowser.runtime.onMessage.emit({
      action: 'privateWindowOnboarding',
      command: 'continue',
    })
    fakeBrowser.runtime.onMessage.emit({
      action: 'privateWindowOnboarding',
      command: 'continue',
    })
    await flushMicrotasks()

    expect(fakeBrowser.storage.local.set).toHaveBeenCalledTimes(1)
    expect(fakeBrowser.browserAction.setPopup).not.toHaveBeenCalled()
    expect(openSessionTree).not.toHaveBeenCalled()
  })

  it('dismisses onboarding without opening Session Tree', async () => {
    const fakeBrowser = installFakeBrowser()
    const openSessionTree = vi
      .spyOn(Tree, 'openSessionTree')
      .mockResolvedValue(undefined)
    initializePrivateWindowOnboarding()

    fakeBrowser.runtime.onMessage.emit({
      action: 'privateWindowOnboarding',
      command: 'dismiss',
    })

    await vi.waitFor(() => {
      expect(fakeBrowser.storage.local.set).toHaveBeenCalledWith({
        privateWindowOnboarding: { status: 'completed' },
      })
    })
    expect(fakeBrowser.browserAction.setPopup).toHaveBeenCalledWith({
      popup: '',
    })
    expect(openSessionTree).not.toHaveBeenCalled()
  })

  it('initializes onboarding before asynchronous background startup', async () => {
    vi.resetModules()
    installFakeBrowser()
    const initializePrivateWindowOnboarding = vi.fn()
    const initializeSettings = vi.fn(() => new Promise<void>(() => undefined))

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
  })
})
