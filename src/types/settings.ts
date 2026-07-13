export interface Settings {
  // General
  matchOpenedWindowsWithSavedWindowsOnStartup: boolean
  openSessionTreeInSameLocation: boolean
  openSessionTreeOnStartup: boolean
  restorePreviousSessionOnStartup: boolean
  showIndentLinesWithoutChildren: boolean
  includeChildrenOfSelectedItemsWhenIndenting: (typeof SETTINGS_TYPES.includeChildrenOfSelectedItemsWhenIndenting)[number]

  // Windows
  focusWindowOnOpen: boolean
  openWindowsInSameLocation: boolean
  openWindowsInSameLocationUpdateInterval: number
  openWindowsInSameLocationUpdateIntervalUnit: (typeof SETTINGS_TYPES.openWindowsInSameLocationUpdateIntervalUnit)[number]
  openWindowWithTabsDiscarded: boolean
  saveWindowOnClose: boolean
  saveWindowOnCloseIfContainsSavedTabs: boolean
  saveWindowOnCloseIfPreviouslySaved: boolean
  saveWindowOnCloseIfContainsNotes: boolean

  // Tabs
  focusTabOnOpen: boolean
  saveTabOnClose: boolean
  saveTabOnCloseIfPreviouslySaved: boolean
  doubleClickOnOpenTab: (typeof SETTINGS_TYPES.doubleClickOnOpenTab)[number]
  doubleClickOnSavedTab: (typeof SETTINGS_TYPES.doubleClickOnSavedTab)[number]
  showTabTitleOnHover: boolean
  showTabUrlOnHover: boolean
  tabGroupInfoOnHover: (typeof SETTINGS_TYPES.tabGroupInfoOnHover)[number]

  // Tab Groups
  tabGroupDropBehavior: (typeof SETTINGS_TYPES.tabGroupDropBehavior)[number]
  tabGroupColorIndicator: (typeof SETTINGS_TYPES.tabGroupColorIndicator)[number]
  saveTabsWhenTabGroupDeleted: boolean

  // Drag and Drop
  enableDragAndDrop: boolean
  enableDropFromExternalSources: boolean
  includeSelectedItemsWithDraggedItem: boolean
  includeChildrenOfSelectedItems: (typeof SETTINGS_TYPES.includeChildrenOfSelectedItems)[number]
  allowDropOntoDescendantItems: boolean
  tryToMaintainHierarchyOfDraggedItems: boolean
  tryToMaintainCollapsedStateOfDraggedItems: boolean

  // Favicons
  fetchMissingFaviconsOnStartup: boolean
  refreshFaviconsAfterPeriodOfTime: boolean
  refreshFaviconsAfterPeriodOfTimeValue: number
  refreshFaviconsAfterPeriodOfTimeUnit: (typeof SETTINGS_TYPES.refreshFaviconsAfterPeriodOfTimeUnit)[number]
}

export const SETTINGS_TYPES = {
  doubleClickOnOpenTab: ['save', 'close', 'reload', 'duplicate', 'focus'],
  doubleClickOnSavedTab: ['open', 'remove', 'duplicate'],
  includeChildrenOfSelectedItems: ['always', 'collapsed', 'never'],
  includeChildrenOfSelectedItemsWhenIndenting: ['always', 'collapsed', 'never'],
  tabGroupDropBehavior: ['same-group-both-adjacent', 'any-adjacent-group'],
  tabGroupColorIndicator: ['right', 'left', 'hidden'],
  tabGroupInfoOnHover: ['always', 'grouped-only', 'never'],
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
  tabGroupDropBehavior: [
    {
      label: 'Both Adjacent Tabs in the Same Group',
      value: 'same-group-both-adjacent',
    },
    {
      label: 'At Least One Adjacent Tab in a Group',
      value: 'any-adjacent-group',
    },
  ],
  tabGroupColorIndicator: [
    { label: 'Right Edge', value: 'right' },
    { label: 'Left Edge', value: 'left' },
    { label: 'Hidden', value: 'hidden' },
  ],
  tabGroupInfoOnHover: [
    { label: 'Always', value: 'always' },
    { label: 'Grouped Tabs Only', value: 'grouped-only' },
    { label: 'Hidden', value: 'never' },
  ],
  includeChildrenOfSelectedItems: [
    { label: 'Always', value: 'always' },
    { label: 'Only if Collapsed', value: 'collapsed' },
    { label: 'Never', value: 'never' },
  ],
  includeChildrenOfSelectedItemsWhenIndenting: [
    { label: 'Always', value: 'always' },
    { label: 'Only if Collapsed', value: 'collapsed' },
    { label: 'Never', value: 'never' },
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
