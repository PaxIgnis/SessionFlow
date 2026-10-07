import { i18n } from '@/services/i18n'
import type { GeneratedI18nStructure } from '#i18n'
import type {
  SessionSnapshotImportSource,
  SessionSnapshotImportWarning,
} from '@/types/session-snapshots'

const warningKeys = {
  'session-buddy': {
    'collections-as-notes':
      'collectionsWerePreservedAsNoteBranchesContainingSavedWindows',
    'history-not-imported':
      'sessionBuddyHistoryWasNotImportedOnlySavedCollectionsAre',
    'tab-group-metadata':
      'tabGroupingWasPreservedWithDefaultColorsBecauseGroupNames',
    'window-presentation':
      'browserWindowTypesAndDisplayStatesWereConvertedToOrdinary',
    'unsupported-appearance':
      'externalFaviconImagesWereNotImportedAvailableSessionFlowIcons',
    'browser-specific-urls':
      'chromespecificURLsWerePreservedButMayNotOpenInFirefox',
  },
  'tab-session-manager': {
    'sessions-as-notes':
      'sessionNamesAndTagsWerePreservedAsNoteBranchesContaining',
    'containers-not-imported':
      'containerAssignmentsWereNotImportedBecauseTheExportOnlyContains',
    'invalid-parent-links':
      'missingSelfreferencingOrCyclicTabParentLinksWereRemovedAll',
    'tab-order': 'tabsWereMovedBesideTheirParentBranchesToPreserveThe',
    'tab-group-metadata':
      'someTabGroupDetailsWereUnavailableDefaultColorsOrNames',
    'window-presentation':
      'browserWindowTypesAndDisplayStatesWereConvertedToOrdinary',
    'unsupported-appearance':
      'externalFaviconImagesWereNotImportedAvailableSessionFlowIcons',
    'browser-specific-urls':
      'chromespecificURLsWerePreservedButMayNotOpenInFirefox',
  },
  'tabs-outliner': {
    'nested-windows':
      'nestedWindowsWereMovedBelowTheirContainingWindowAsSiblings',
    'groups-as-notes': 'tabsOutlinerGroupsWereConvertedToNoteBranches',
    'tabs-without-window':
      'consecutiveSiblingTabsOutsideAWindowWerePlacedTogetherIn',
    'separator-children':
      'childrenOfSeparatorsWereMovedBelowTheSeparatorAsSiblings',
    'browser-specific-urls':
      'chromespecificURLsWerePreservedButMayNotOpenInFirefox',
    'unsupported-appearance':
      'customIconsWindowGeometryAndSeparatorStylesWereNotImported',
  },
} as const satisfies Partial<
  Record<
    SessionSnapshotImportSource,
    Partial<
      Record<SessionSnapshotImportWarning['code'], keyof GeneratedI18nStructure>
    >
  >
>

type WarningKey = {
  [Source in keyof typeof warningKeys]: (typeof warningKeys)[Source][keyof (typeof warningKeys)[Source]]
}[keyof typeof warningKeys]

export function localizedImportWarning(
  source: SessionSnapshotImportSource,
  warning: SessionSnapshotImportWarning,
): string {
  const keys:
    | Partial<Record<SessionSnapshotImportWarning['code'], WarningKey>>
    | undefined = warningKeys[source as keyof typeof warningKeys]
  const key = keys?.[warning.code]
  return key ? i18n.t(key) : warning.message
}
