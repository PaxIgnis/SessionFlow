import { normalizeSettings } from '@/services/settings-actions'
import type { Settings } from '@/types/settings'

const FAVICON_FETCH_SETTINGS = [
  'fetchMissingFaviconsOnStartup',
  'refreshFaviconsAfterPeriodOfTime',
] as const satisfies readonly (keyof Settings)[]

export interface GrantedPermissions {
  /** Website access, which favicon fetching needs. */
  faviconFetch: boolean
  /** Download access, which automatic backups need. */
  downloads: boolean
}

export interface RestoredSettings {
  settings: Settings
  /** True when favicon fetching was turned off for lack of website access. */
  faviconFetchingDisabled: boolean
  /** True when automatic backups were turned off for lack of download access. */
  automaticBackupsDisabled: boolean
}

/**
 * Prepares backed-up settings for this browser. Settings that need a
 * permission that is not granted are turned off, since a restore cannot
 * always ask for it.
 */
export function prepareRestoredSettings(
  backedUp: Partial<Settings>,
  granted: GrantedPermissions,
): RestoredSettings {
  const settings = normalizeSettings(backedUp)
  let faviconFetchingDisabled = false
  if (!granted.faviconFetch) {
    for (const key of FAVICON_FETCH_SETTINGS) {
      if (settings[key]) {
        settings[key] = false
        faviconFetchingDisabled = true
      }
    }
  }
  const automaticBackupsDisabled =
    settings.automaticBackups && !granted.downloads
  if (automaticBackupsDisabled) settings.automaticBackups = false
  return { settings, faviconFetchingDisabled, automaticBackupsDisabled }
}
