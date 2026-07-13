import { Tree } from '@/services/background-tree'
import { Favicons, FaviconService } from '@/services/favicons'
import { Settings } from '@/services/settings'
import type { Settings as SettingsValues } from '@/types/settings'

export const FAVICON_REFRESH_ALARM_NAME = 'sessionflow-refresh-favicons'

type FaviconRefreshUnit = SettingsValues['refreshFaviconsAfterPeriodOfTimeUnit']
type FaviconRefreshTiming = SettingsValues['faviconRefreshTiming']

interface FaviconRefreshSettingsSnapshot {
  fetchMissingOnStartup: boolean
  automaticRefresh: boolean
  intervalValue: number
  intervalUnit: FaviconRefreshUnit
  timing: FaviconRefreshTiming
}

type AlarmsApi = Pick<typeof browser.alarms, 'clear' | 'create' | 'onAlarm'>

const UNIT_TO_MILLISECONDS: Record<FaviconRefreshUnit, number> = {
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
  weeks: 7 * 24 * 60 * 60 * 1000,
}

export function getFaviconRefreshIntervalMs(
  value: number,
  unit: FaviconRefreshUnit,
): number {
  const normalizedValue =
    Number.isFinite(value) && value >= 1 ? Math.min(value, 999) : 1
  return normalizedValue * UNIT_TO_MILLISECONDS[unit]
}

export class FaviconRefreshScheduler {
  private initialized = false
  private alarmListenerRegistered = false
  private missingAlarmsWarningLogged = false
  private settingsSnapshot: FaviconRefreshSettingsSnapshot | undefined
  private refreshPromise: Promise<void> | undefined

  public constructor(
    private readonly faviconService: FaviconService = Favicons,
    private readonly getTreeTabUrls: () => string[] = () =>
      Array.from(Tree.tabsByUid.values())
        .map((tab) => tab.url)
        .filter((url): url is string => typeof url === 'string' && url !== ''),
  ) {}

  public async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    this.ensureAlarmListener()

    this.settingsSnapshot = this.readSettings()
    await this.refreshOnStartup(this.settingsSnapshot)
    await this.syncAlarm(this.settingsSnapshot)
  }

  /**
   * Applies favicon setting changes after Settings has reloaded storage.
   */
  public handleSettingsUpdated = async (): Promise<void> => {
    const previous = this.settingsSnapshot
    const next = this.readSettings()
    this.settingsSnapshot = next

    if (previous && this.settingsEqual(previous, next)) return

    const automaticRefreshChanged =
      next.automaticRefresh &&
      (!previous?.automaticRefresh ||
        previous.intervalValue !== next.intervalValue ||
        previous.intervalUnit !== next.intervalUnit ||
        previous.timing !== next.timing)

    if (automaticRefreshChanged) {
      await this.refreshExpiredFavicons(next)
    } else if (
      !next.automaticRefresh &&
      next.fetchMissingOnStartup &&
      !previous?.fetchMissingOnStartup
    ) {
      await this.refreshFavicons(Number.POSITIVE_INFINITY)
    }

    await this.syncAlarm(next)
  }

  private readonly onAlarm = (alarm: browser.alarms.Alarm): void => {
    if (alarm.name !== FAVICON_REFRESH_ALARM_NAME) return

    void this.handleRefreshAlarm().catch((error) => {
      console.error('Failed to refresh favicons after alarm', error)
    })
  }

  private async handleRefreshAlarm(): Promise<void> {
    const settings = this.readSettings()
    this.settingsSnapshot = settings
    if (
      !settings.automaticRefresh ||
      settings.timing !== 'expiration-and-startup'
    ) {
      await this.syncAlarm(settings)
      return
    }

    await this.refreshExpiredFavicons(settings)
    await this.syncAlarm(settings)
  }

  private async refreshOnStartup(
    settings: FaviconRefreshSettingsSnapshot,
  ): Promise<void> {
    if (settings.automaticRefresh) {
      await this.refreshExpiredFavicons(settings)
    } else if (settings.fetchMissingOnStartup) {
      await this.refreshFavicons(Number.POSITIVE_INFINITY)
    }
  }

  private async refreshExpiredFavicons(
    settings: FaviconRefreshSettingsSnapshot,
  ): Promise<void> {
    await this.refreshFavicons(
      getFaviconRefreshIntervalMs(
        settings.intervalValue,
        settings.intervalUnit,
      ),
    )
  }

  private async refreshFavicons(maxAgeMs: number): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise

    this.refreshPromise = this.performRefresh(maxAgeMs)
    try {
      await this.refreshPromise
    } finally {
      this.refreshPromise = undefined
    }
  }

  private async performRefresh(maxAgeMs: number): Promise<void> {
    const urls = this.getTreeTabUrls()
    if (urls.length === 0) return

    await this.faviconService.init()
    if (!(await this.faviconService.hasFetchPermissions())) {
      console.info(
        'Skipping favicon refresh: website access permission is not granted',
      )
      return
    }

    let openTabs: browser.tabs.Tab[] = []
    try {
      openTabs = await browser.tabs.query({})
    } catch (error) {
      console.error(
        'Failed to query open tabs while refreshing favicons',
        error,
      )
    }

    const updatedEntries = await this.faviconService.refreshFavicons(
      urls,
      maxAgeMs,
      openTabs,
    )
    if (updatedEntries.length === 0) return

    try {
      await browser.runtime.sendMessage({ type: 'FAVICON_CACHE_UPDATED' })
    } catch {
      console.debug('No open Session Tree to receive favicon cache updates')
    }
  }

  private async syncAlarm(
    settings: FaviconRefreshSettingsSnapshot,
  ): Promise<void> {
    const alarms = this.ensureAlarmListener()
    if (!alarms) {
      if (
        settings.automaticRefresh &&
        settings.timing === 'expiration-and-startup' &&
        !this.missingAlarmsWarningLogged
      ) {
        this.missingAlarmsWarningLogged = true
        console.warn(
          'Favicon expiry scheduling is unavailable because Firefox did not expose the alarms API. Reload the extension after applying the alarms permission.',
        )
      }
      return
    }

    await alarms.clear(FAVICON_REFRESH_ALARM_NAME)
    if (
      !settings.automaticRefresh ||
      settings.timing !== 'expiration-and-startup'
    ) {
      return
    }

    const urls = this.getTreeTabUrls()
    if (urls.length === 0) return

    await this.faviconService.init()
    const intervalMs = getFaviconRefreshIntervalMs(
      settings.intervalValue,
      settings.intervalUnit,
    )
    const nextRefreshAt = this.faviconService.getNextRefreshAt(urls, intervalMs)
    if (nextRefreshAt === undefined) return

    await alarms.create(FAVICON_REFRESH_ALARM_NAME, {
      when: nextRefreshAt,
    })
  }

  private ensureAlarmListener(): AlarmsApi | undefined {
    const alarms = (browser as unknown as { alarms?: AlarmsApi }).alarms
    if (!alarms || this.alarmListenerRegistered) return alarms

    alarms.onAlarm.addListener(this.onAlarm)
    this.alarmListenerRegistered = true
    return alarms
  }

  private readSettings(): FaviconRefreshSettingsSnapshot {
    return {
      fetchMissingOnStartup: Settings.values.fetchMissingFaviconsOnStartup,
      automaticRefresh: Settings.values.refreshFaviconsAfterPeriodOfTime,
      intervalValue: Settings.values.refreshFaviconsAfterPeriodOfTimeValue,
      intervalUnit: Settings.values.refreshFaviconsAfterPeriodOfTimeUnit,
      timing: Settings.values.faviconRefreshTiming,
    }
  }

  private settingsEqual(
    left: FaviconRefreshSettingsSnapshot,
    right: FaviconRefreshSettingsSnapshot,
  ): boolean {
    return (
      left.fetchMissingOnStartup === right.fetchMissingOnStartup &&
      left.automaticRefresh === right.automaticRefresh &&
      left.intervalValue === right.intervalValue &&
      left.intervalUnit === right.intervalUnit &&
      left.timing === right.timing
    )
  }
}

export const FaviconRefresh = new FaviconRefreshScheduler()
