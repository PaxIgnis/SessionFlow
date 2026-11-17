import { normalizeSettings } from '@/services/settings-actions'
import type { Settings } from '@/types/settings'

const FAVICON_FETCH_SETTINGS = [
  'fetchMissingFaviconsOnStartup',
  'refreshFaviconsAfterPeriodOfTime',
] as const satisfies readonly (keyof Settings)[]

export interface RestoredSettings {
  settings: Settings
  /** True when favicon fetching was turned off for lack of website access. */
  faviconFetchingDisabled: boolean
}

/**
 * Prepares backed-up settings for this browser. Settings that need website
 * access are turned off when it is not granted, since a restore cannot ask
 * for the permission outside the click that enabled them.
 */
export function prepareRestoredSettings(
  backedUp: Partial<Settings>,
  hasFaviconFetchPermission: boolean,
): RestoredSettings {
  const settings = normalizeSettings(backedUp)
  let faviconFetchingDisabled = false
  if (!hasFaviconFetchPermission) {
    for (const key of FAVICON_FETCH_SETTINGS) {
      if (settings[key]) {
        settings[key] = false
        faviconFetchingDisabled = true
      }
    }
  }
  return { settings, faviconFetchingDisabled }
}
