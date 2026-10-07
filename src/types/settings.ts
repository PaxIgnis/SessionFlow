import { i18n } from '@/services/i18n'
export interface Settings {
  // General
  matchOpenedWindowsWithSavedWindowsOnStartup: boolean
  openSessionTreeInSameLocation: boolean
  openSessionTreeOnStartup: boolean
  restorePreviousSessionOnStartup: boolean
  showIndentLinesWithoutChildren: boolean
  includeChildrenOfSelectedItemsWhenIndenting: (typeof SETTINGS_TYPES.includeChildrenOfSelectedItemsWhenIndenting)[number]
  duplicateTreeItemDescendants: (typeof SETTINGS_TYPES.duplicateTreeItemDescendants)[number]
  duplicatedItemState: (typeof SETTINGS_TYPES.duplicatedItemState)[number]
  reconnectFirefoxRestoredItems: boolean

  // Context Menu
  contextMenuDeleteDescendants: (typeof SETTINGS_TYPES.contextMenuDeleteDescendants)[number]
  contextMenuOpenDescendants: (typeof SETTINGS_TYPES.contextMenuOpenDescendants)[number]
  contextMenuReloadDescendants: (typeof SETTINGS_TYPES.contextMenuReloadDescendants)[number]
  contextMenuSaveDescendants: (typeof SETTINGS_TYPES.contextMenuSaveDescendants)[number]
  contextMenuPinDescendants: (typeof SETTINGS_TYPES.contextMenuPinDescendants)[number]

  // Storage
  automaticSessionSnapshots: boolean
  sessionSnapshotInterval: number
  sessionSnapshotIntervalUnit: (typeof SETTINGS_TYPES.sessionSnapshotIntervalUnit)[number]
  protectManualSessionSnapshots: boolean
  includePrivateWindowsInSessionSnapshots: boolean

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

  // Containers
  containerColorIndicator: (typeof SETTINGS_TYPES.containerColorIndicator)[number]
  containerFadeSide: (typeof SETTINGS_TYPES.containerFadeSide)[number]
  containerIconPosition: (typeof SETTINGS_TYPES.containerIconPosition)[number]

  // Tab Groups
  tabGroupDropBehavior: (typeof SETTINGS_TYPES.tabGroupDropBehavior)[number]
  tabGroupColorIndicator: (typeof SETTINGS_TYPES.tabGroupColorIndicator)[number]
  saveTabsWhenTabGroupDeleted: boolean

  // Drag and Drop
  enableDragAndDrop: boolean
  enableCopyOnDragAndDrop: boolean
  enableDropFromExternalSources: boolean
  includeSelectedItemsWithDraggedItem: boolean
  includeChildrenOfSelectedItems: (typeof SETTINGS_TYPES.includeChildrenOfSelectedItems)[number]
  allowDropOntoDescendantItems: boolean
  tryToMaintainHierarchyOfDraggedItems: boolean
  tryToMaintainCollapsedStateOfDraggedItems: boolean

  // Favicons
  cachePrivateTabFavicons: boolean
  fetchMissingFaviconsOnStartup: boolean
  refreshFaviconsAfterPeriodOfTime: boolean
  refreshFaviconsAfterPeriodOfTimeValue: number
  refreshFaviconsAfterPeriodOfTimeUnit: (typeof SETTINGS_TYPES.refreshFaviconsAfterPeriodOfTimeUnit)[number]
  faviconRefreshTiming: (typeof SETTINGS_TYPES.faviconRefreshTiming)[number]
  dimUnloadedAndSavedFavicons: boolean
}

export const SETTINGS_TYPES = {
  doubleClickOnOpenTab: ['save', 'close', 'reload', 'duplicate', 'focus'],
  doubleClickOnSavedTab: ['open', 'remove', 'duplicate'],
  includeChildrenOfSelectedItems: ['always', 'collapsed', 'never'],
  includeChildrenOfSelectedItemsWhenIndenting: ['always', 'collapsed', 'never'],
  duplicateTreeItemDescendants: [
    'selected-only',
    'collapsed',
    'complete-subtree',
  ],
  contextMenuDeleteDescendants: ['always', 'collapsed', 'never'],
  contextMenuOpenDescendants: ['always', 'collapsed', 'never'],
  contextMenuReloadDescendants: ['always', 'collapsed', 'never'],
  contextMenuSaveDescendants: ['always', 'collapsed', 'never'],
  contextMenuPinDescendants: ['always', 'collapsed', 'never'],
  duplicatedItemState: ['saved', 'match-original'],
  tabGroupDropBehavior: ['same-group-both-adjacent', 'any-adjacent-group'],
  tabGroupColorIndicator: ['right', 'left', 'hidden'],
  tabGroupInfoOnHover: ['always', 'grouped-only', 'never'],
  containerColorIndicator: ['soft-fade', 'strong-fade', 'off'],
  containerFadeSide: ['left', 'right'],
  containerIconPosition: ['left', 'right', 'off'],
  refreshFaviconsAfterPeriodOfTimeUnit: ['hours', 'days', 'weeks'],
  faviconRefreshTiming: ['startup-only', 'expiration-and-startup'],
  openWindowsInSameLocationUpdateIntervalUnit: ['seconds', 'minutes'],
  sessionSnapshotIntervalUnit: ['minutes', 'hours'],
} as const

export const OPTIONS = {
  boolean: [
    { label: i18n.t('on'), value: true },
    { label: i18n.t('off'), value: false },
  ],
  doubleClickOnOpenTab: [
    { label: i18n.t('save'), value: 'save' },
    { label: i18n.t('delete'), value: 'close' },
    { label: i18n.t('reload'), value: 'reload' },
    { label: i18n.t('duplicate'), value: 'duplicate' },
    { label: i18n.t('focus'), value: 'focus' },
  ],
  doubleClickOnSavedTab: [
    { label: i18n.t('open'), value: 'open' },
    { label: i18n.t('delete'), value: 'remove' },
    { label: i18n.t('duplicate'), value: 'duplicate' },
  ],
  duplicateTreeItemDescendants: [
    { label: i18n.t('always'), value: 'complete-subtree' },
    { label: i18n.t('onlyIfCollapsed'), value: 'collapsed' },
    { label: i18n.t('never'), value: 'selected-only' },
  ],
  duplicatedItemState: [
    { label: i18n.t('alwaysSaved'), value: 'saved' },
    { label: i18n.t('matchOriginalItems'), value: 'match-original' },
  ],
  tabGroupDropBehavior: [
    { label: i18n.t('sameGroup'), value: 'same-group-both-adjacent' },
    { label: i18n.t('anyAdjacent'), value: 'any-adjacent-group' },
  ],
  tabGroupColorIndicator: [
    { label: i18n.t('leftEdge'), value: 'left' },
    { label: i18n.t('rightEdge'), value: 'right' },
    { label: i18n.t('hidden'), value: 'hidden' },
  ],
  tabGroupInfoOnHover: [
    { label: i18n.t('always'), value: 'always' },
    { label: i18n.t('groupedTabsOnly'), value: 'grouped-only' },
    { label: i18n.t('hidden'), value: 'never' },
  ],
  containerColorIndicator: [
    { label: i18n.t('softFade'), value: 'soft-fade' },
    { label: i18n.t('strongFade'), value: 'strong-fade' },
    { label: i18n.t('off'), value: 'off' },
  ],
  containerFadeSide: [
    { label: i18n.t('left'), value: 'left' },
    { label: i18n.t('right'), value: 'right' },
  ],
  containerIconPosition: [
    { label: i18n.t('left'), value: 'left' },
    { label: i18n.t('right'), value: 'right' },
    { label: i18n.t('off'), value: 'off' },
  ],
  includeChildrenOfSelectedItems: [
    { label: i18n.t('always'), value: 'always' },
    { label: i18n.t('onlyIfCollapsed'), value: 'collapsed' },
    { label: i18n.t('never'), value: 'never' },
  ],
  includeChildrenOfSelectedItemsWhenIndenting: [
    { label: i18n.t('always'), value: 'always' },
    { label: i18n.t('onlyIfCollapsed'), value: 'collapsed' },
    { label: i18n.t('never'), value: 'never' },
  ],
  refreshFaviconsAfterPeriodOfTimeUnit: [
    { label: i18n.t('hours'), value: 'hours' },
    { label: i18n.t('days'), value: 'days' },
    { label: i18n.t('weeks'), value: 'weeks' },
  ],
  faviconRefreshTiming: [
    { label: i18n.t('atFirefoxStartupOnly'), value: 'startup-only' },
    {
      label: i18n.t('whenExpiredAndAtStartup'),
      value: 'expiration-and-startup',
    },
  ],
  openWindowsInSameLocationUpdateIntervalUnit: [
    { label: i18n.t('seconds'), value: 'seconds' },
    { label: i18n.t('minutes'), value: 'minutes' },
  ],
  sessionSnapshotIntervalUnit: [
    { label: i18n.t('minutes'), value: 'minutes' },
    { label: i18n.t('hours'), value: 'hours' },
  ],
}
