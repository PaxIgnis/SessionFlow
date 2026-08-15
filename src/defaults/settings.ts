import { Settings } from '../types/settings'

export const DEFAULT_SETTINGS: Settings = {
  // General
  matchOpenedWindowsWithSavedWindowsOnStartup: true,
  openSessionTreeInSameLocation: true,
  openSessionTreeOnStartup: false,
  restorePreviousSessionOnStartup: false,
  showIndentLinesWithoutChildren: false,
  includeChildrenOfSelectedItemsWhenIndenting: 'always',
  duplicateTreeItemDescendants: 'selected-only',
  duplicatedItemState: 'saved',
  reconnectFirefoxRestoredItems: true,

  // Context Menu
  contextMenuDeleteDescendants: 'collapsed',
  contextMenuOpenDescendants: 'collapsed',
  contextMenuReloadDescendants: 'collapsed',
  contextMenuSaveDescendants: 'collapsed',
  contextMenuPinDescendants: 'collapsed',

  // Storage
  automaticSessionSnapshots: true,
  sessionSnapshotInterval: 30,
  sessionSnapshotIntervalUnit: 'minutes',
  protectManualSessionSnapshots: true,
  includePrivateWindowsInSessionSnapshots: true,

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
  cachePrivateTabFavicons: true,
  fetchMissingFaviconsOnStartup: false,
  refreshFaviconsAfterPeriodOfTime: false,
  refreshFaviconsAfterPeriodOfTimeValue: 7,
  refreshFaviconsAfterPeriodOfTimeUnit: 'days',
  faviconRefreshTiming: 'startup-only',
}
