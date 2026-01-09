export interface Settings {
  // General
  openSessionTreeInSameLocation: boolean
  openSessionTreeOnStartup: boolean

  // Windows
  focusWindowOnOpen: boolean
  openWindowsInSameLocation: boolean
  openWindowsInSameLocationUpdateInterval: number
  openWindowsInSameLocationUpdateIntervalUnit: (typeof SETTINGS_TYPES.openWindowsInSameLocationUpdateIntervalUnit)[number]
  openWindowWithTabsDiscarded: boolean
  saveWindowOnClose: boolean
  saveWindowOnCloseIfContainsSavedTabs: boolean
  saveWindowOnCloseIfPreviouslySaved: boolean

  // Tabs
  focusTabOnOpen: boolean
  saveTabOnClose: boolean
  saveTabOnCloseIfPreviouslySaved: boolean
  doubleClickOnOpenTab: (typeof SETTINGS_TYPES.doubleClickOnOpenTab)[number]
  doubleClickOnSavedTab: (typeof SETTINGS_TYPES.doubleClickOnSavedTab)[number]

  // Drag and Drop
  enableDragAndDrop: boolean
  enableDropFromExternalSources: boolean

  // Favicons
  fetchMissingFaviconsOnStartup: boolean
  refreshFaviconsAfterPeriodOfTime: boolean
  refreshFaviconsAfterPeriodOfTimeValue: number
  refreshFaviconsAfterPeriodOfTimeUnit: (typeof SETTINGS_TYPES.refreshFaviconsAfterPeriodOfTimeUnit)[number]
}

export const SETTINGS_TYPES = {
  doubleClickOnOpenTab: ['save', 'close', 'reload', 'duplicate', 'focus'],
  doubleClickOnSavedTab: ['open', 'remove', 'duplicate'],
  refreshFaviconsAfterPeriodOfTimeUnit: [
    'seconds',
    'minutes',
    'hours',
    'days',
    'weeks',
  ],
  openWindowsInSameLocationUpdateIntervalUnit: ['seconds', 'minutes'],
}

export const OPTIONS = {
  boolean: [
    { label: 'On', value: true },
    { label: 'Off', value: false },
  ],
  doubleClickOnOpenTab: [
    { label: 'Save', value: 'save' },
    { label: 'Close', value: 'close' },
    { label: 'Reload', value: 'reload' },
    { label: 'Duplicate', value: 'duplicate' },
    { label: 'Focus', value: 'focus' },
  ],
  doubleClickOnSavedTab: [
    { label: 'Open', value: 'open' },
    { label: 'Remove', value: 'remove' },
    { label: 'Duplicate', value: 'duplicate' },
  ],
  refreshFaviconsAfterPeriodOfTimeUnit: [
    { label: 'Seconds', value: 'seconds' },
    { label: 'Minutes', value: 'minutes' },
    { label: 'Hours', value: 'hours' },
    { label: 'Days', value: 'days' },
    { label: 'Weeks', value: 'weeks' },
  ],
  openWindowsInSameLocationUpdateIntervalUnit: [
    { label: 'Seconds', value: 'seconds' },
    { label: 'Minutes', value: 'minutes' },
  ],
}
