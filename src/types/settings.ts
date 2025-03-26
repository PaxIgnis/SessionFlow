export interface Settings {
  // General
  openSessionTreeInSameLocation: boolean
  openSessionTreeOnStartup: boolean

  // Windows
  focusWindowOnOpen: boolean
  openWindowsInSameLocation: boolean
  saveWindowOnClose: boolean
  saveWindowOnCloseIfContainsSavedTabs: boolean
  saveWindowOnCloseIfPreviouslySaved: boolean

  // Tabs
  focusTabOnOpen: boolean
  saveTabOnClose: boolean
  saveTabOnCloseIfPreviouslySaved: boolean
  doubleClickOnOpenTab: (typeof SETTINGS_TYPES.doubleClickOnOpenTab)[number]
  doubleClickOnSavedTab: (typeof SETTINGS_TYPES.doubleClickOnSavedTab)[number]

  // Favicons
  fetchMissingFaviconsOnStartup: boolean
  refreshFaviconsAfterPeriodOfTime: boolean
  refreshFaviconsAfterPeriodOfTimeValue: number
  refreshFaviconsAfterPeriodOfTimeUnit: (typeof SETTINGS_TYPES.refreshFaviconsAfterPeriodOfTimeUnit)[number]
}

export const SETTINGS_TYPES = {
  doubleClickOnOpenTab: ['save', 'close', 'reload', 'duplicate'],
  doubleClickOnSavedTab: ['open', 'remove', 'duplicate'],
  refreshFaviconsAfterPeriodOfTimeUnit: ['seconds', 'minutes', 'days', 'weeks'],
}
