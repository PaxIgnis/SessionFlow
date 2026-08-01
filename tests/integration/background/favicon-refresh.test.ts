import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import {
  FAVICON_REFRESH_ALARM_NAME,
  FaviconRefreshScheduler,
  getFaviconRefreshIntervalMs,
} from '@/services/favicon-refresh'
import { FaviconService } from '@/services/favicons'
import { Settings } from '@/services/settings'
import { FakeBrowser, installFakeBrowser } from '../../helpers/fake-browser'

describe('favicon refresh scheduler', () => {
  let fakeBrowser: FakeBrowser
  let faviconService: FaviconService
  let init: ReturnType<typeof vi.spyOn>
  let hasFetchPermissions: ReturnType<typeof vi.spyOn>
  let refreshFavicons: ReturnType<typeof vi.spyOn>
  let getNextRefreshAt: ReturnType<typeof vi.spyOn>
  let removePrivateOnlyEntries: ReturnType<typeof vi.spyOn>
  let saveCacheToStorage: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fakeBrowser = installFakeBrowser()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
    faviconService = new FaviconService()
    init = vi.spyOn(faviconService, 'init').mockResolvedValue(undefined)
    hasFetchPermissions = vi
      .spyOn(faviconService, 'hasFetchPermissions')
      .mockResolvedValue(true)
    refreshFavicons = vi
      .spyOn(faviconService, 'refreshFavicons')
      .mockResolvedValue([])
    getNextRefreshAt = vi
      .spyOn(faviconService, 'getNextRefreshAt')
      .mockReturnValue(123_456)
    removePrivateOnlyEntries = vi
      .spyOn(faviconService, 'removePrivateOnlyEntries')
      .mockReturnValue([])
    saveCacheToStorage = vi
      .spyOn(faviconService, 'saveCacheToStorage')
      .mockResolvedValue(undefined)
  })

  it('converts supported refresh units to milliseconds and clamps invalid values', () => {
    expect(getFaviconRefreshIntervalMs(2, 'hours')).toBe(7_200_000)
    expect(getFaviconRefreshIntervalMs(2, 'days')).toBe(172_800_000)
    expect(getFaviconRefreshIntervalMs(2, 'weeks')).toBe(1_209_600_000)
    expect(getFaviconRefreshIntervalMs(0, 'hours')).toBe(3_600_000)
    expect(getFaviconRefreshIntervalMs(1_000, 'hours')).toBe(
      999 * 60 * 60 * 1000,
    )
  })

  it('refreshes missing or expired icons at startup without scheduling in startup-only mode', async () => {
    Settings.values.refreshFaviconsAfterPeriodOfTime = true
    Settings.values.refreshFaviconsAfterPeriodOfTimeValue = 7
    Settings.values.refreshFaviconsAfterPeriodOfTimeUnit = 'days'
    Settings.values.faviconRefreshTiming = 'startup-only'
    const openTabs = [
      {
        id: 1,
        url: 'https://example.test/live',
        favIconUrl: 'data:image/png;base64,live',
      },
    ] as browser.tabs.Tab[]
    vi.mocked(browser.tabs.query).mockResolvedValue(openTabs)
    const scheduler = new FaviconRefreshScheduler(faviconService, () => [
      'https://example.test/saved',
    ])

    await scheduler.initialize()

    expect(init).toHaveBeenCalledTimes(1)
    expect(hasFetchPermissions).toHaveBeenCalledTimes(1)
    expect(refreshFavicons).toHaveBeenCalledWith(
      ['https://example.test/saved'],
      7 * 24 * 60 * 60 * 1000,
      openTabs,
    )
    expect(browser.alarms.clear).toHaveBeenCalledWith(
      FAVICON_REFRESH_ALARM_NAME,
    )
    expect(browser.alarms.create).not.toHaveBeenCalled()
  })

  it('fetches only missing icons at startup when automatic refresh is disabled', async () => {
    Settings.values.fetchMissingFaviconsOnStartup = true
    const scheduler = new FaviconRefreshScheduler(faviconService, () => [
      'https://example.test/saved',
    ])

    await scheduler.initialize()

    expect(refreshFavicons).toHaveBeenCalledWith(
      ['https://example.test/saved'],
      Number.POSITIVE_INFINITY,
      [],
    )
    expect(browser.alarms.create).not.toHaveBeenCalled()
  })

  it('still refreshes startup favicons when Firefox does not expose the alarms API', async () => {
    Settings.values.fetchMissingFaviconsOnStartup = true
    delete (fakeBrowser as Partial<FakeBrowser>).alarms
    const scheduler = new FaviconRefreshScheduler(faviconService, () => [
      'https://example.test/saved',
    ])

    await expect(scheduler.initialize()).resolves.toBeUndefined()

    expect(refreshFavicons).toHaveBeenCalledWith(
      ['https://example.test/saved'],
      Number.POSITIVE_INFINITY,
      [],
    )
  })

  it('applies startup-only setting changes when Firefox does not expose the alarms API', async () => {
    delete (fakeBrowser as Partial<FakeBrowser>).alarms
    const scheduler = new FaviconRefreshScheduler(faviconService, () => [
      'https://example.test/saved',
    ])
    await scheduler.initialize()

    Settings.values.fetchMissingFaviconsOnStartup = true

    await expect(scheduler.handleSettingsUpdated()).resolves.toBeUndefined()

    expect(refreshFavicons).toHaveBeenCalledWith(
      ['https://example.test/saved'],
      Number.POSITIVE_INFINITY,
      [],
    )
  })

  it('skips expiry scheduling when Firefox does not expose the alarms API', async () => {
    Settings.values.refreshFaviconsAfterPeriodOfTime = true
    Settings.values.faviconRefreshTiming = 'expiration-and-startup'
    delete (fakeBrowser as Partial<FakeBrowser>).alarms
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scheduler = new FaviconRefreshScheduler(faviconService, () => [
      'https://example.test/saved',
    ])

    await expect(scheduler.initialize()).resolves.toBeUndefined()

    expect(refreshFavicons).toHaveBeenCalledTimes(1)
    expect(getNextRefreshAt).not.toHaveBeenCalled()
    expect(consoleWarn).toHaveBeenCalledOnce()
    expect(consoleWarn).toHaveBeenCalledWith(
      'Favicon expiry scheduling is unavailable because Firefox did not expose the alarms API. Reload the extension after applying the alarms permission.',
    )
  })

  it('schedules the earliest expiry in continuous mode', async () => {
    Settings.values.refreshFaviconsAfterPeriodOfTime = true
    Settings.values.faviconRefreshTiming = 'expiration-and-startup'
    const urls = ['https://example.test/saved']
    const scheduler = new FaviconRefreshScheduler(faviconService, () => urls)

    await scheduler.initialize()

    expect(getNextRefreshAt).toHaveBeenCalledWith(urls, 7 * 24 * 60 * 60 * 1000)
    expect(browser.alarms.create).toHaveBeenCalledWith(
      FAVICON_REFRESH_ALARM_NAME,
      { when: 123_456 },
    )
  })

  it('runs continuous refresh alarms and ignores unrelated alarms', async () => {
    Settings.values.refreshFaviconsAfterPeriodOfTime = true
    Settings.values.faviconRefreshTiming = 'expiration-and-startup'
    const scheduler = new FaviconRefreshScheduler(faviconService, () => [
      'https://example.test/saved',
    ])
    await scheduler.initialize()
    refreshFavicons.mockClear()
    getNextRefreshAt.mockClear()

    fakeBrowser.alarms.onAlarm.emit({
      name: 'other-alarm',
      scheduledTime: 1,
    })
    expect(refreshFavicons).not.toHaveBeenCalled()

    fakeBrowser.alarms.onAlarm.emit({
      name: FAVICON_REFRESH_ALARM_NAME,
      scheduledTime: 1,
    })

    await vi.waitFor(() => {
      expect(refreshFavicons).toHaveBeenCalledTimes(1)
      expect(getNextRefreshAt).toHaveBeenCalledTimes(1)
    })
  })

  it('registers one listener and performs one startup refresh across repeated initialization (PD-FR-01)', async () => {
    Settings.values.refreshFaviconsAfterPeriodOfTime = true
    const scheduler = new FaviconRefreshScheduler(faviconService, () => [
      'https://example.test/saved',
    ])

    await Promise.all([scheduler.initialize(), scheduler.initialize()])

    expect(fakeBrowser.alarms.onAlarm.listeners).toHaveLength(1)
    expect(refreshFavicons).toHaveBeenCalledOnce()
  })

  it('does not let an in-flight refresh restore an obsolete alarm schedule (PD-FR-02)', async () => {
    const scheduler = new FaviconRefreshScheduler(faviconService, () => [
      'https://example.test/saved',
    ])
    await scheduler.initialize()
    vi.mocked(browser.alarms.create).mockClear()
    let finishRefresh!: () => void
    refreshFavicons.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefresh = () => resolve([])
        }),
    )

    Settings.values.refreshFaviconsAfterPeriodOfTime = true
    Settings.values.faviconRefreshTiming = 'expiration-and-startup'
    const enabling = scheduler.handleSettingsUpdated()
    await vi.waitFor(() => expect(refreshFavicons).toHaveBeenCalledOnce())

    Settings.values.refreshFaviconsAfterPeriodOfTime = false
    await scheduler.handleSettingsUpdated()
    finishRefresh()
    await enabling

    expect(browser.alarms.create).not.toHaveBeenCalled()
  })

  it('rechecks permission at alarm time and resumes only after permission and settings return (PD-FR-03)', async () => {
    Settings.values.refreshFaviconsAfterPeriodOfTime = true
    Settings.values.faviconRefreshTiming = 'expiration-and-startup'
    const scheduler = new FaviconRefreshScheduler(faviconService, () => [
      'https://example.test/saved',
    ])
    await scheduler.initialize()
    refreshFavicons.mockClear()
    vi.mocked(browser.alarms.create).mockClear()
    hasFetchPermissions.mockResolvedValue(false)

    fakeBrowser.alarms.onAlarm.emit({
      name: FAVICON_REFRESH_ALARM_NAME,
      scheduledTime: 1,
    })
    await vi.waitFor(() => expect(hasFetchPermissions).toHaveBeenCalled())

    expect(refreshFavicons).not.toHaveBeenCalled()
    expect(browser.alarms.create).not.toHaveBeenCalled()

    Settings.values.refreshFaviconsAfterPeriodOfTime = false
    await scheduler.handleSettingsUpdated()
    hasFetchPermissions.mockResolvedValue(true)
    Settings.values.refreshFaviconsAfterPeriodOfTime = true
    await scheduler.handleSettingsUpdated()

    expect(refreshFavicons).toHaveBeenCalledOnce()
    expect(browser.alarms.create).toHaveBeenCalledOnce()
  })

  it('coalesces concurrent alarm refresh work into one cache update broadcast (PD-FR-04)', async () => {
    Settings.values.refreshFaviconsAfterPeriodOfTime = true
    Settings.values.faviconRefreshTiming = 'expiration-and-startup'
    const scheduler = new FaviconRefreshScheduler(faviconService, () => [
      'https://example.test/saved',
    ])
    await scheduler.initialize()
    refreshFavicons.mockClear()
    vi.mocked(browser.runtime.sendMessage).mockClear()
    let finishRefresh!: () => void
    refreshFavicons.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefresh = () =>
            resolve([
              {
                url: 'example.test',
                dataUrl: 'data:image/png;base64,new',
                timestamp: 1,
              },
            ])
        }),
    )

    fakeBrowser.alarms.onAlarm.emit({
      name: FAVICON_REFRESH_ALARM_NAME,
      scheduledTime: 1,
    })
    fakeBrowser.alarms.onAlarm.emit({
      name: FAVICON_REFRESH_ALARM_NAME,
      scheduledTime: 1,
    })
    await vi.waitFor(() => expect(refreshFavicons).toHaveBeenCalledOnce())
    finishRefresh()
    await vi.waitFor(() =>
      expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'FAVICON_CACHE_UPDATED',
      }),
    )

    expect(browser.runtime.sendMessage).toHaveBeenCalledOnce()
  })

  it('applies favicon setting changes once and reschedules immediately', async () => {
    const urls = ['https://example.test/saved']
    const scheduler = new FaviconRefreshScheduler(faviconService, () => urls)
    await scheduler.initialize()
    vi.mocked(browser.alarms.clear).mockClear()
    vi.mocked(browser.alarms.create).mockClear()

    Settings.values.refreshFaviconsAfterPeriodOfTime = true
    Settings.values.refreshFaviconsAfterPeriodOfTimeValue = 2
    Settings.values.refreshFaviconsAfterPeriodOfTimeUnit = 'hours'
    Settings.values.faviconRefreshTiming = 'expiration-and-startup'

    await scheduler.handleSettingsUpdated()

    expect(refreshFavicons).toHaveBeenCalledWith(urls, 2 * 60 * 60 * 1000, [])
    expect(browser.alarms.create).toHaveBeenCalledWith(
      FAVICON_REFRESH_ALARM_NAME,
      { when: 123_456 },
    )

    refreshFavicons.mockClear()
    vi.mocked(browser.alarms.clear).mockClear()
    await scheduler.handleSettingsUpdated()

    expect(refreshFavicons).not.toHaveBeenCalled()
    expect(browser.alarms.clear).not.toHaveBeenCalled()
  })

  it('cancels continuous refresh without changing saved timing values', async () => {
    Settings.values.refreshFaviconsAfterPeriodOfTime = true
    Settings.values.refreshFaviconsAfterPeriodOfTimeValue = 12
    Settings.values.refreshFaviconsAfterPeriodOfTimeUnit = 'hours'
    Settings.values.faviconRefreshTiming = 'expiration-and-startup'
    const scheduler = new FaviconRefreshScheduler(faviconService, () => [
      'https://example.test/saved',
    ])
    await scheduler.initialize()
    vi.mocked(browser.alarms.clear).mockClear()
    vi.mocked(browser.alarms.create).mockClear()

    Settings.values.refreshFaviconsAfterPeriodOfTime = false
    await scheduler.handleSettingsUpdated()

    expect(browser.alarms.clear).toHaveBeenCalledWith(
      FAVICON_REFRESH_ALARM_NAME,
    )
    expect(browser.alarms.create).not.toHaveBeenCalled()
    expect(Settings.values.refreshFaviconsAfterPeriodOfTimeValue).toBe(12)
    expect(Settings.values.refreshFaviconsAfterPeriodOfTimeUnit).toBe('hours')
    expect(Settings.values.faviconRefreshTiming).toBe('expiration-and-startup')
  })

  it('does no alarm work after continuous refresh is repeatedly disabled (PF-09)', async () => {
    Settings.values.refreshFaviconsAfterPeriodOfTime = true
    Settings.values.faviconRefreshTiming = 'expiration-and-startup'
    const scheduler = new FaviconRefreshScheduler(faviconService, () => [
      'https://example.test/saved',
    ])
    await scheduler.initialize()

    for (let cycle = 0; cycle < 25; cycle++) {
      Settings.values.refreshFaviconsAfterPeriodOfTime = false
      await scheduler.handleSettingsUpdated()
      Settings.values.refreshFaviconsAfterPeriodOfTime = true
      await scheduler.handleSettingsUpdated()
    }
    Settings.values.refreshFaviconsAfterPeriodOfTime = false
    await scheduler.handleSettingsUpdated()
    refreshFavicons.mockClear()
    getNextRefreshAt.mockClear()
    vi.mocked(browser.alarms.create).mockClear()

    for (let cycle = 0; cycle < 100; cycle++) {
      fakeBrowser.alarms.onAlarm.emit({
        name: FAVICON_REFRESH_ALARM_NAME,
        scheduledTime: cycle,
      })
    }
    await vi.waitFor(() => {
      expect(browser.alarms.clear).toHaveBeenCalled()
    })

    expect(refreshFavicons).not.toHaveBeenCalled()
    expect(getNextRefreshAt).not.toHaveBeenCalled()
    expect(browser.alarms.create).not.toHaveBeenCalled()
  })

  it('skips network work without website access and notifies open views after updates', async () => {
    Settings.values.refreshFaviconsAfterPeriodOfTime = true
    const scheduler = new FaviconRefreshScheduler(faviconService, () => [
      'https://example.test/saved',
    ])
    hasFetchPermissions.mockResolvedValueOnce(false)
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {})

    await scheduler.initialize()

    expect(browser.tabs.query).not.toHaveBeenCalled()
    expect(refreshFavicons).not.toHaveBeenCalled()
    expect(consoleInfo).toHaveBeenCalledWith(
      'Skipping favicon refresh: website access permission is not granted',
    )

    Settings.values.refreshFaviconsAfterPeriodOfTimeValue = 8
    refreshFavicons.mockResolvedValueOnce([
      {
        url: 'example.test',
        dataUrl: 'data:image/png;base64,new',
        timestamp: 1,
      },
    ])
    await scheduler.handleSettingsUpdated()

    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'FAVICON_CACHE_UPDATED',
    })
  })

  it('excludes private tree and browser tabs from refresh when private caching is disabled', async () => {
    Settings.values.cachePrivateTabFavicons = false
    Settings.values.refreshFaviconsAfterPeriodOfTime = true
    const normalTab = {
      id: 1,
      url: 'https://normal.test/live',
      favIconUrl: 'data:image/png;base64,bm9ybWFs',
      incognito: false,
    } as browser.tabs.Tab
    const privateTab = {
      id: 2,
      url: 'https://private.test/live',
      favIconUrl: 'data:image/png;base64,cHJpdmF0ZQ==',
      incognito: true,
    } as browser.tabs.Tab
    vi.mocked(browser.tabs.query).mockResolvedValue([normalTab, privateTab])
    const references = [
      { url: 'https://normal.test/saved', incognito: false },
      { url: 'https://private.test/saved', incognito: true },
    ]
    const scheduler = new FaviconRefreshScheduler(
      faviconService,
      () => references,
    )

    await scheduler.initialize()

    expect(refreshFavicons).toHaveBeenCalledWith(
      ['https://normal.test/saved'],
      7 * 24 * 60 * 60 * 1000,
      [normalTab],
    )
  })

  it('purges private-only entries when the private favicon setting is disabled', async () => {
    const references = [
      { url: 'https://private.test/saved', incognito: true },
      { url: 'https://shared.test/private', incognito: true },
      { url: 'https://shared.test/normal', incognito: false },
    ]
    const scheduler = new FaviconRefreshScheduler(
      faviconService,
      () => references,
    )
    await scheduler.initialize()
    removePrivateOnlyEntries.mockClear()
    removePrivateOnlyEntries.mockReturnValueOnce(['private.test'])
    saveCacheToStorage.mockClear()
    vi.mocked(browser.runtime.sendMessage).mockClear()

    Settings.values.cachePrivateTabFavicons = false
    await scheduler.handleSettingsUpdated()

    expect(removePrivateOnlyEntries).toHaveBeenCalledWith(references)
    expect(saveCacheToStorage).toHaveBeenCalledOnce()
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'FAVICON_CACHE_UPDATED',
    })
  })
})
