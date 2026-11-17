import { defaultContainerChoices } from '@/services/container-choices'
import { i18n } from '@/services/i18n'
import {
  countSnapshotItems,
  validateSessionSnapshotPayload,
} from '@/services/session-snapshot-codec'
import { nestSnapshotTabs } from '@/services/session-snapshot-import-tab-tree'
import type {
  ParsedSessionSnapshotImport,
  SessionSnapshotImportWarning,
  SnapshotTab,
  SnapshotTabGroupMetadata,
  SnapshotTopLevelItem,
  SnapshotWindow,
} from '@/types/session-snapshots'
import {
  State,
  TreeItemType,
  type ContainerMetadata,
  type TabGroupColor,
} from '@/types/session-tree'

// Backups are the add-on's storage plus `groups[].tabs`, `pinnedTabs`, and the
// referenced `containers`. Tabs store openers as `openerOffset` relative to
// their position in the same group.
// https://github.com/drive4ik/simple-tab-groups/blob/master/addon/src/background.js
// https://github.com/drive4ik/simple-tab-groups/blob/master/addon/src/js/tabs.js
const warningMessages = {
  'groups-as-windows':
    'Each group was imported as a saved window. Group settings such as icons, catch rules, and archive status were not imported.',
  'pinned-tabs-window': 'Pinned tabs were placed in a separate saved window.',
  'containers-not-imported':
    'Some container assignments were not imported because the backup has no matching container details or uses temporary containers.',
  'invalid-parent-links':
    'Missing, self-referencing, or cyclic tab parent links were removed. All affected tabs were kept.',
  'tab-order':
    'Tabs were moved beside their parent branches to preserve the saved hierarchy.',
  'tab-group-metadata':
    'Some tab group details were unavailable. Default colors or names were used.',
  'unsupported-appearance':
    'Saved favicons and thumbnails were not imported. Available Session Flow icons will be used.',
} satisfies Partial<Record<SessionSnapshotImportWarning['code'], string>>
type WarningCode = keyof typeof warningMessages

const groupColors = new Set<string>([
  'blue',
  'cyan',
  'grey',
  'green',
  'orange',
  'pink',
  'purple',
  'red',
  'yellow',
])
const TEMPORARY_CONTAINER = 'temporary-container'

export function isSimpleTabGroupsImport(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.groups) &&
    (typeof value.version === 'string' ||
      'pinnedTabs' in value ||
      'containers' in value ||
      value.groups.some(
        (group) =>
          isRecord(group) && Array.isArray(group.tabs) && 'title' in group,
      ))
  )
}

export function parseSimpleTabGroupsImport(
  value: unknown,
): ParsedSessionSnapshotImport {
  const backup = record(value)
  if (!Array.isArray(backup.groups)) invalid()
  optionalString(backup, 'version')
  const containers =
    backup.containers === undefined ? {} : record(backup.containers)
  if (backup.pinnedTabs !== undefined && !Array.isArray(backup.pinnedTabs))
    invalid()

  const items: SnapshotTopLevelItem[] = []
  const warnings = new Map<WarningCode, number>()
  const warn = (code: WarningCode, count = 1) =>
    warnings.set(code, (warnings.get(code) ?? 0) + count)
  let nextId = 0
  const uid = () => `simple-tab-groups-${++nextId}` as UID
  const importedContainers = new Map<string, ContainerMetadata | undefined>()

  const createWindow = (title: string): SnapshotWindow => ({
    type: TreeItemType.WINDOW,
    uid: uid(),
    state: State.SAVED,
    title,
    incognito: false,
    indentLevel: 0,
    collapsed: false,
    isParent: false,
    children: [],
  })

  const createTab = (
    rawTab: unknown,
    window: SnapshotWindow,
    pinned: boolean,
  ): { source: Record<string, unknown>; tab: SnapshotTab } => {
    const source = record(rawTab)
    if (typeof source.url !== 'string') invalid()
    const title = optionalString(source, 'title')
    const lastAccessed =
      source.lastAccessed === undefined
        ? undefined
        : timestamp(source.lastAccessed)
    const tab: SnapshotTab = {
      type: TreeItemType.TAB,
      uid: uid(),
      windowUid: window.uid,
      state: State.SAVED,
      url: source.url,
      title: title || source.url,
      pinned,
      indentLevel: window.indentLevel + 1,
      collapsed: false,
      isParent: false,
      ...(lastAccessed !== undefined ? { savedTime: lastAccessed } : {}),
    }
    const container = containerFor(optionalString(source, 'cookieStoreId'))
    if (container) tab.container = { ...container }
    if (
      optionalString(source, 'favIconUrl') ||
      optionalString(source, 'thumbnail')
    )
      warn('unsupported-appearance')
    if (lastAccessed !== undefined)
      window.savedTime = Math.max(window.savedTime ?? 0, lastAccessed)
    return { source, tab }
  }

  const containerFor = (
    cookieStoreId: string | undefined,
  ): ContainerMetadata | undefined => {
    // Default and private stores are written without an ID or as *-default.
    if (
      !cookieStoreId ||
      cookieStoreId.includes('default') ||
      cookieStoreId === 'firefox-private'
    )
      return undefined
    if (!importedContainers.has(cookieStoreId))
      importedContainers.set(
        cookieStoreId,
        cookieStoreId === TEMPORARY_CONTAINER
          ? undefined
          : containerMetadata(cookieStoreId, containers[cookieStoreId]),
      )
    const container = importedContainers.get(cookieStoreId)
    if (!container) warn('containers-not-imported')
    return container
  }

  const finishWindow = (window: SnapshotWindow) => {
    window.isParent = window.children.length > 0
    items.push(window)
  }

  const pinnedTabs = (backup.pinnedTabs ?? []) as unknown[]
  if (pinnedTabs.length) {
    const window = createWindow(i18n.t('pinnedTabs'))
    window.children = pinnedTabs.map(
      (rawTab) => createTab(rawTab, window, true).tab,
    )
    finishWindow(window)
    warn('pinned-tabs-window')
  }

  for (const [groupIndex, rawGroup] of backup.groups.entries()) {
    const group = record(rawGroup)
    // Cloud-sync stubs carry no tabs and are skipped by the add-on as well.
    if (group.tabs === undefined && group.uploadToCloud === false) continue
    if (!Array.isArray(group.tabs)) invalid()
    optionalBoolean(group, 'isArchive')
    const window = createWindow(
      optionalString(group, 'title') || i18n.t('groupNumber', [groupIndex + 1]),
    )
    warn('groups-as-windows')

    const subGroups = new Map<string, SnapshotTabGroupMetadata>()
    const sourceSubGroups = new Map<string, Record<string, unknown>>()
    if (group.subGroups !== undefined && !Array.isArray(group.subGroups))
      invalid()
    for (const rawSubGroup of (group.subGroups ?? []) as unknown[]) {
      const subGroup = record(rawSubGroup)
      if (typeof subGroup.id !== 'string' || sourceSubGroups.has(subGroup.id))
        invalid()
      optionalString(subGroup, 'title')
      optionalString(subGroup, 'color')
      optionalBoolean(subGroup, 'collapsed')
      sourceSubGroups.set(subGroup.id, subGroup)
    }

    const tabs: SnapshotTab[] = []
    const parents = new Map<number, number>()
    for (const [index, rawTab] of group.tabs.entries()) {
      const { source, tab } = createTab(rawTab, window, false)
      if (source.openerOffset !== undefined)
        parents.set(index, index + integer(source.openerOffset))
      const subGroupId = optionalString(source, 'subGroupId')
      if (subGroupId) {
        if (!subGroups.has(subGroupId)) {
          const subGroup = sourceSubGroups.get(subGroupId)
          const color = subGroup?.color
          const known = typeof color === 'string' && groupColors.has(color)
          if (!known) warn('tab-group-metadata')
          subGroups.set(subGroupId, {
            uid: uid(),
            title: subGroup?.title as string | undefined,
            color: known ? (color as TabGroupColor) : 'grey',
            collapsed: subGroup?.collapsed === true,
          })
        }
        tab.tabGroup = { ...subGroups.get(subGroupId)! }
      }
      tabs.push(tab)
    }
    window.children = nestSnapshotTabs(tabs, parents, warn)
    finishWindow(window)
  }

  const payload = validateSessionSnapshotPayload({ schemaVersion: 1, items })
  return {
    payload,
    summary: {
      source: 'simple-tab-groups',
      counts: countSnapshotItems(items),
      warnings: Array.from(warnings, ([code, count]) => ({
        code,
        count,
        message: warningMessages[code],
      })),
    },
  }
}

// Container entries are copies of Firefox contextual identities from the
// profile that created the backup. Restore recreates missing ones by name.
function containerMetadata(
  cookieStoreId: string,
  value: unknown,
): ContainerMetadata | undefined {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    typeof value.color !== 'string' ||
    typeof value.icon !== 'string'
  )
    return undefined
  const colorCode =
    typeof value.colorCode === 'string'
      ? value.colorCode
      : defaultContainerChoices().colors.find(
          (choice) => choice.color === value.color,
        )?.colorCode
  if (!colorCode) return undefined
  return {
    cookieStoreId,
    name: value.name,
    color: value.color,
    colorCode,
    icon: value.icon,
    ...(typeof value.iconUrl === 'string' ? { iconUrl: value.iconUrl } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) invalid()
  return value
}
function optionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key]
  if (field !== undefined && field !== null && typeof field !== 'string')
    invalid()
  return (field ?? undefined) as string | undefined
}
function optionalBoolean(value: Record<string, unknown>, key: string): void {
  if (value[key] !== undefined && typeof value[key] !== 'boolean') invalid()
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid()
  return value
}
function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(new Date(value).getTime()))
    invalid()
  return value
}
function invalid(): never {
  throw new Error(i18n.t('invalidSimpleTabGroups'))
}
