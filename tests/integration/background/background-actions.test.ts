import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import {
  initializeSettings,
  setupBrowserActionMenu,
  updateBadge,
  updateBadgeOnStartup,
} from '@/services/background-actions'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import { flushMicrotasks, installFakeBrowser } from '../../helpers/fake-browser'

const mocks = vi.hoisted(() => ({
  openSessionTree: vi.fn(),
  updateWindowPositionInterval: vi.fn(),
}))

vi.mock('@/services/background-tree-actions', () => ({
  openSessionTree: mocks.openSessionTree,
}))

vi.mock('@/services/background-tree-window-actions', () => ({
  updateWindowPositionInterval: mocks.updateWindowPositionInterval,
}))

describe('background actions', () => {
  beforeEach(() => {
    installFakeBrowser()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
    mocks.openSessionTree.mockReset()
    mocks.openSessionTree.mockResolvedValue(undefined)
    mocks.updateWindowPositionInterval.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('updates the badge text and title from current tab and window counts', async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ] as browser.tabs.Tab[])
    vi.mocked(browser.windows.getAll).mockResolvedValue([
      { id: 10 },
      { id: 11 },
    ] as browser.windows.Window[])

    await updateBadge()

    expect(browser.tabs.query).toHaveBeenCalledWith({})
    expect(browser.windows.getAll).toHaveBeenCalledWith()
    expect(browser.browserAction.setBadgeText).toHaveBeenCalledWith({
      text: '3',
    })
    expect(browser.browserAction.setTitle).toHaveBeenCalledWith({
      title: '2 windows / 3 tabs',
    })
  })

  it('updates the badge ten times on startup on one-second timer ticks', async () => {
    vi.useFakeTimers()

    const startup = updateBadgeOnStartup()
    await flushMicrotasks()

    expect(browser.tabs.query).toHaveBeenCalledTimes(1)
    expect(browser.browserAction.setTitle).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(999)

    expect(browser.tabs.query).toHaveBeenCalledTimes(1)
    expect(browser.browserAction.setTitle).toHaveBeenCalledTimes(1)

    for (let expectedCalls = 2; expectedCalls <= 10; expectedCalls++) {
      await vi.advanceTimersByTimeAsync(1)
      await flushMicrotasks()

      expect(browser.tabs.query).toHaveBeenCalledTimes(expectedCalls)
      expect(browser.windows.getAll).toHaveBeenCalledTimes(expectedCalls)

      if (expectedCalls < 10) {
        await vi.advanceTimersByTimeAsync(999)
      }
    }

    const finished = vi.fn()
    startup.then(finished)
    await flushMicrotasks()

    expect(finished).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    await startup

    expect(finished).toHaveBeenCalledTimes(1)
    expect(browser.browserAction.setBadgeText).toHaveBeenCalledTimes(10)
    expect(browser.browserAction.setTitle).toHaveBeenCalledTimes(10)
  })

  it('loads settings, opens the session tree after one second when enabled, and starts the window position interval', async () => {
    vi.useFakeTimers()
    Settings.values.openSessionTreeOnStartup = true
    const loadSettings = vi
      .spyOn(Settings, 'loadSettingsFromStorage')
      .mockResolvedValue(undefined)

    await initializeSettings()

    expect(loadSettings).toHaveBeenCalledTimes(1)
    expect(mocks.updateWindowPositionInterval).toHaveBeenCalledTimes(1)
    expect(mocks.openSessionTree).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(999)

    expect(mocks.openSessionTree).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(mocks.openSessionTree).toHaveBeenCalledTimes(1)
  })

  it('logs startup session tree open errors from the delayed callback', async () => {
    vi.useFakeTimers()
    Settings.values.openSessionTreeOnStartup = true
    const openError = new Error('open failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(Settings, 'loadSettingsFromStorage').mockResolvedValue(undefined)
    mocks.openSessionTree.mockRejectedValue(openError)

    await initializeSettings()
    await vi.advanceTimersByTimeAsync(1000)

    expect(consoleError).toHaveBeenCalledWith(
      'Failed to open session tree on startup:',
      openError,
    )
    expect(mocks.updateWindowPositionInterval).toHaveBeenCalledTimes(1)
  })

  it('loads settings without scheduling the session tree to open when startup opening is disabled', async () => {
    vi.useFakeTimers()
    Settings.values.openSessionTreeOnStartup = false
    const loadSettings = vi
      .spyOn(Settings, 'loadSettingsFromStorage')
      .mockResolvedValue(undefined)

    await initializeSettings()

    expect(loadSettings).toHaveBeenCalledTimes(1)
    expect(mocks.updateWindowPositionInterval).toHaveBeenCalledTimes(1)
    expect(mocks.openSessionTree).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('logs settings load errors without starting the window position interval', async () => {
    vi.useFakeTimers()
    const loadError = new Error('settings failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(Settings, 'loadSettingsFromStorage').mockRejectedValue(loadError)

    await initializeSettings()

    expect(consoleError).toHaveBeenCalledWith(
      'Failed to initialize settings:',
      loadError,
    )
    expect(mocks.updateWindowPositionInterval).not.toHaveBeenCalled()
    expect(mocks.openSessionTree).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('registers browser action menu items that open the session tree and settings', () => {
    const openOptionsPage = vi.fn()
    const openSessionTree = vi
      .spyOn(Tree, 'openSessionTree')
      .mockResolvedValue(undefined)
    ;(
      browser.runtime as typeof browser.runtime & {
        openOptionsPage: typeof openOptionsPage
      }
    ).openOptionsPage = openOptionsPage

    setupBrowserActionMenu()

    expect(browser.menus.create).toHaveBeenCalledTimes(2)
    const createdMenus = vi
      .mocked(browser.menus.create)
      .mock.calls.map(([menu]) => menu)
    const openSessionTreeMenu = createdMenus.find(
      (menu) => menu.id === 'open-sessiontree',
    )
    const openSettingsMenu = createdMenus.find(
      (menu) => menu.id === 'open-settings',
    )

    expect(openSessionTreeMenu).toEqual(
      expect.objectContaining({
        id: 'open-sessiontree',
        title: 'Open SessionTree',
        contexts: ['browser_action'],
      }),
    )
    expect(openSettingsMenu).toEqual(
      expect.objectContaining({
        id: 'open-settings',
        title: 'Settings',
        contexts: ['browser_action'],
      }),
    )

    const clickInfo = {} as browser.menus.OnClickData
    const clickedTab = { id: 1 } as browser.tabs.Tab

    openSessionTreeMenu?.onclick?.(clickInfo, clickedTab)
    openSettingsMenu?.onclick?.(clickInfo, clickedTab)

    expect(openSessionTree).toHaveBeenCalledTimes(1)
    expect(openOptionsPage).toHaveBeenCalledTimes(1)
  })
})
