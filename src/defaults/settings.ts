import { Settings } from '../types/settings'

export const DEFAULT_SETTINGS: Settings = {
  // General
  openSessionTreeInSameLocation: true,
  openSessionTreeOnStartup: false,

  // Windows
  focusWindowOnOpen: true,
  openWindowsInSameLocation: true,
  saveWindowOnClose: false,
  saveWindowOnCloseIfContainsSavedTabs: true,
  saveWindowOnCloseIfPreviouslySaved: false,

  // Tabs
  focusTabOnOpen: true,
  saveTabOnClose: false,
  saveTabOnCloseIfPreviouslySaved: false,
  doubleClickOnOpenTab: 'focus',
  doubleClickOnSavedTab: 'open',

  // Favicons
  fetchMissingFaviconsOnStartup: false,
  refreshFaviconsAfterPeriodOfTime: false,
  refreshFaviconsAfterPeriodOfTimeValue: 7,
  refreshFaviconsAfterPeriodOfTimeUnit: 'days',
}
