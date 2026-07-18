import { Settings } from '../types/settings'

export const DEFAULT_SETTINGS: Settings = {
  // General
  matchOpenedWindowsWithSavedWindowsOnStartup: true,
  openSessionTreeInSameLocation: true,
  openSessionTreeOnStartup: false,
  restorePreviousSessionOnStartup: false,
  showIndentLinesWithoutChildren: false,
  includeChildrenOfSelectedItemsWhenIndenting: 'always',

  // Windows
  focusWindowOnOpen: true,
  openWindowsInSameLocation: true,
  openWindowsInSameLocationUpdateInterval: 60,
  openWindowsInSameLocationUpdateIntervalUnit: 'seconds',
  openWindowWithTabsDiscarded: true,
  saveWindowOnClose: false,
  saveWindowOnCloseIfContainsSavedTabs: true,
  saveWindowOnCloseIfPreviouslySaved: true,
  saveWindowOnCloseIfContainsNotes: true,

  // Tabs
  focusTabOnOpen: true,
  saveTabOnClose: false,
  saveTabOnCloseIfPreviouslySaved: true,
  doubleClickOnOpenTab: 'focus',
  doubleClickOnSavedTab: 'open',
  showTabTitleOnHover: true,
  showTabUrlOnHover: true,
  tabGroupInfoOnHover: 'grouped-only',

  // Containers
  containerColorIndicator: 'soft-fade',
  containerFadeSide: 'right',
  containerIconPosition: 'left',

  // Tab Groups
  tabGroupDropBehavior: 'same-group-both-adjacent',
  tabGroupColorIndicator: 'right',
  saveTabsWhenTabGroupDeleted: true,

  // Drag and Drop
  enableDragAndDrop: true,
  enableCopyOnDragAndDrop: true,
  enableDropFromExternalSources: false,
  includeSelectedItemsWithDraggedItem: true,
  includeChildrenOfSelectedItems: 'collapsed',
  allowDropOntoDescendantItems: true,
  tryToMaintainHierarchyOfDraggedItems: true,
  tryToMaintainCollapsedStateOfDraggedItems: true,

  // Favicons
  fetchMissingFaviconsOnStartup: false,
  refreshFaviconsAfterPeriodOfTime: false,
  refreshFaviconsAfterPeriodOfTimeValue: 7,
  refreshFaviconsAfterPeriodOfTimeUnit: 'days',
  faviconRefreshTiming: 'startup-only',
}
