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
})
