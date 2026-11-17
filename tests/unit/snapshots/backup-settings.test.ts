import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { prepareRestoredSettings } from '@/services/backup-settings'

const allGranted = { faviconFetch: true, downloads: true }

describe('restored backup settings', () => {
  const withFaviconFetching = {
    ...DEFAULT_SETTINGS,
    fetchMissingFaviconsOnStartup: true,
    refreshFaviconsAfterPeriodOfTime: true,
  }

  it('keeps favicon fetching when website access is granted', () => {
    const restored = prepareRestoredSettings(withFaviconFetching, allGranted)

    expect(restored.faviconFetchingDisabled).toBe(false)
    expect(restored.settings.fetchMissingFaviconsOnStartup).toBe(true)
    expect(restored.settings.refreshFaviconsAfterPeriodOfTime).toBe(true)
  })

  it('turns favicon fetching off without website access', () => {
    const restored = prepareRestoredSettings(withFaviconFetching, {
      ...allGranted,
      faviconFetch: false,
    })

    expect(restored.faviconFetchingDisabled).toBe(true)
    expect(restored.settings.fetchMissingFaviconsOnStartup).toBe(false)
    expect(restored.settings.refreshFaviconsAfterPeriodOfTime).toBe(false)
  })

  it('reports nothing when favicon fetching was already off', () => {
    const restored = prepareRestoredSettings(
      {
        ...DEFAULT_SETTINGS,
        fetchMissingFaviconsOnStartup: false,
        refreshFaviconsAfterPeriodOfTime: false,
      },
      { ...allGranted, faviconFetch: false },
    )

    expect(restored.faviconFetchingDisabled).toBe(false)
  })

  it('normalizes values and fills settings missing from the backup', () => {
    const restored = prepareRestoredSettings(
      {
        ...DEFAULT_SETTINGS,
        focusTabOnOpen: false,
        sessionSnapshotKeepNewest: 1_000_000,
        doubleClickOnOpenTab: 'explode' as never,
      },
      allGranted,
    )

    expect(restored.settings.focusTabOnOpen).toBe(false)
    expect(restored.settings.sessionSnapshotKeepNewest).toBe(1000)
    expect(restored.settings.doubleClickOnOpenTab).toBe(
      DEFAULT_SETTINGS.doubleClickOnOpenTab,
    )
  })

  it('turns automatic backups off without download access', () => {
    const withBackups = { ...DEFAULT_SETTINGS, automaticBackups: true }

    const kept = prepareRestoredSettings(withBackups, allGranted)
    const turnedOff = prepareRestoredSettings(withBackups, {
      ...allGranted,
      downloads: false,
    })

    expect(kept.settings.automaticBackups).toBe(true)
    expect(kept.automaticBackupsDisabled).toBe(false)
    expect(turnedOff.settings.automaticBackups).toBe(false)
    expect(turnedOff.automaticBackupsDisabled).toBe(true)
  })
})
