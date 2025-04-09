import { Settings } from '../types/settings'

export const DEFAULT_SETTINGS: Settings = {
  // General
  openSessionTreeInSameLocation: true,
  openSessionTreeOnStartup: false,

  // Windows
  focusWindowOnOpen: true,
  openWindowsInSameLocation: true,
  openWindowsInSameLocationUpdateInterval: 60,
  openWindowsInSameLocationUpdateIntervalUnit: 'seconds',
  openWindowWithTabsDiscarded: true,
  saveWindowOnClose: false,
  saveWindowOnCloseIfContainsSavedTabs: true,
  saveWindowOnCloseIfPreviouslySaved: true,

  // Tabs
  focusTabOnOpen: true,
  saveTabOnClose: false,
  saveTabOnCloseIfPreviouslySaved: true,
  doubleClickOnOpenTab: 'focus',
  doubleClickOnSavedTab: 'open',

  // Favicons
  fetchMissingFaviconsOnStartup: false,
  refreshFaviconsAfterPeriodOfTime: false,
  refreshFaviconsAfterPeriodOfTimeValue: 7,
  refreshFaviconsAfterPeriodOfTimeUnit: 'days',
}
