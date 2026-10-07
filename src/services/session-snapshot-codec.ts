import { i18n } from '@/services/i18n'
import type {
  SessionSnapshotCounts,
  SessionSnapshotExport,
  SessionSnapshotMetadata,
  SessionSnapshotPayload,
  SnapshotNote,
  SnapshotSeparator,
  SnapshotTab,
  SnapshotTabGroupMetadata,
  SnapshotTopLevelItem,
  SnapshotTreeItem,
  SnapshotWindow,
  SnapshotWindowChild,
} from '@/types/session-snapshots'
import { SESSION_SNAPSHOT_SCHEMA_VERSION } from '@/types/session-snapshots'
import type {
  Note,
  Separator,
  Tab,
  TabGroupColor,
  TopLevelTreeItem,
  Window,
  WindowChild,
} from '@/types/session-tree'
import { State, TreeItemType } from '@/types/session-tree'

interface CaptureOptions {
  includePrivateWindows: boolean
}

export interface CapturedSessionSnapshot {
  payload: SessionSnapshotPayload
  digest: string
  counts: SessionSnapshotCounts
  sizeBytes: number
  containsPrivateWindows: boolean
}

export async function captureSessionSnapshot(
  items: readonly TopLevelTreeItem[],
  options: CaptureOptions,
): Promise<CapturedSessionSnapshot> {
  const sourceItems = options.includePrivateWindows
    ? items
    : items.filter(
        (item) => item.type !== TreeItemType.WINDOW || !item.incognito,
      )
  const payload: SessionSnapshotPayload = {
    schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
    items: sourceItems.map(snapshotTopLevelItem),
  }
  return describeSessionSnapshot(payload)
}

export async function describeSessionSnapshot(
  payload: SessionSnapshotPayload,
): Promise<CapturedSessionSnapshot> {
  const json = JSON.stringify(payload)
  return {
    payload,
    digest: await sha256(json),
    counts: countSnapshotItems(payload.items),
    sizeBytes: new TextEncoder().encode(json).byteLength,
    containsPrivateWindows: payload.items.some(
      (item) => item.type === TreeItemType.WINDOW && item.incognito,
    ),
  }
}

export function countSnapshotItems(
  items: readonly SnapshotTopLevelItem[],
): SessionSnapshotCounts {
  const counts: SessionSnapshotCounts = {
    windows: 0,
    tabs: 0,
    notes: 0,
    separators: 0,
  }
  for (const item of items) {
    if (item.type === TreeItemType.WINDOW) {
      counts.windows += 1
      for (const child of item.children) incrementCount(counts, child.type)
    } else {
      incrementCount(counts, item.type)
    }
  }
  return counts
}

export function validateSessionSnapshotPayload(
  value: unknown,
): SessionSnapshotPayload {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error(i18n.t('unsupportedSnapshotVersion'))
  }
  if (!Array.isArray(value.items)) {
    throw new Error(i18n.t('invalidSessionSnapshotItems'))
  }
  const items = value.items.map(validateTopLevelItem)
  validateSnapshotRelationships(items)
  return { schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION, items }
}

export function createSessionSnapshotExport(
  metadata: SessionSnapshotMetadata,
  payload: SessionSnapshotPayload,
): SessionSnapshotExport {
  return {
    format: 'session-flow-snapshot',
    schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
    metadata: structuredClone(metadata),
    payload: validateSessionSnapshotPayload(payload),
  }
}

function snapshotTopLevelItem(item: TopLevelTreeItem): SnapshotTopLevelItem {
  if (item.type === TreeItemType.WINDOW) return snapshotWindow(item)
  if (item.type === TreeItemType.NOTE) return snapshotNote(item)
  return snapshotSeparator(item)
}

function snapshotWindow(item: Window): SnapshotWindow {
  return compact({
    type: TreeItemType.WINDOW,
    uid: item.uid,
    savedActiveTabUid: item.savedActiveTabUid,
    incognito: item.incognito,
    savedTime: item.savedTime,
    state: item.state,
    collapsed: item.collapsed,
    windowPosition: item.windowPosition
      ? structuredClone(item.windowPosition)
      : undefined,
    children: item.children.map(snapshotWindowChild),
    indentLevel: item.indentLevel,
    title: item.title,
    isParent: item.isParent,
    parentUid: item.parentUid,
  }) as SnapshotWindow
}

function snapshotWindowChild(item: WindowChild): SnapshotWindowChild {
  if (item.type === TreeItemType.TAB) return snapshotTab(item)
  if (item.type === TreeItemType.NOTE) return snapshotNote(item)
  return snapshotSeparator(item)
}

function snapshotTab(item: Tab): SnapshotTab {
  return compact({
    type: TreeItemType.TAB,
    uid: item.uid,
    savedTime: item.savedTime,
    state: item.state,
    title: item.title,
    url: item.url,
    windowUid: item.windowUid,
    collapsed: item.collapsed,
    indentLevel: item.indentLevel,
    pinned: item.pinned,
    isParent: item.isParent,
    parentUid: item.parentUid,
    customLabel: item.customLabel,
    tabGroup: item.tabGroup
      ? compact({
          uid: item.tabGroup.uid,
          title: item.tabGroup.title,
          color: item.tabGroup.color,
          collapsed: item.tabGroup.collapsed,
        })
      : undefined,
    container: item.container ? structuredClone(item.container) : undefined,
  }) as SnapshotTab
}

function snapshotNote(item: Note): SnapshotNote {
  return compact({
    type: TreeItemType.NOTE,
    uid: item.uid,
    text: item.text,
    windowUid: item.windowUid,
    collapsed: item.collapsed,
    indentLevel: item.indentLevel,
    isParent: item.isParent,
    parentUid: item.parentUid,
  }) as SnapshotNote
}

function snapshotSeparator(item: Separator): SnapshotSeparator {
  return compact({
    type: TreeItemType.SEPARATOR,
    uid: item.uid,
    windowUid: item.windowUid,
    indentLevel: item.indentLevel,
    parentUid: item.parentUid,
    isParent: item.isParent,
    collapsed: item.collapsed,
  }) as SnapshotSeparator
}

function incrementCount(
  counts: SessionSnapshotCounts,
  type: TreeItemType,
): void {
  if (type === TreeItemType.TAB) counts.tabs += 1
  else if (type === TreeItemType.NOTE) counts.notes += 1
  else if (type === TreeItemType.SEPARATOR) counts.separators += 1
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Partial<T>
}

function validateTopLevelItem(value: unknown): SnapshotTopLevelItem {
  const record = validateCommon(value)
  if (record.type === TreeItemType.WINDOW) {
    if (
      !Array.isArray(record.children) ||
      typeof record.incognito !== 'boolean' ||
      !isSnapshotState(record.state)
    )
      throw new Error(i18n.t('invalidSnapshotWindow'))
    validateOptionalUid(
      record,
      'savedActiveTabUid',
      i18n.t('invalidSnapshotWindow'),
    )
    validateOptionalUid(record, 'parentUid', i18n.t('invalidSnapshotWindow'))
    validateOptionalString(record, 'title', i18n.t('invalidSnapshotWindow'))
    validateOptionalBoolean(
      record,
      'collapsed',
      i18n.t('invalidSnapshotWindow'),
    )
    validateOptionalBoolean(record, 'isParent', i18n.t('invalidSnapshotWindow'))
    validateOptionalFiniteNumber(
      record,
      'savedTime',
      i18n.t('invalidSnapshotWindow'),
    )
    validateWindowPosition(record.windowPosition)
    return {
      ...structuredClone(record),
      children: record.children.map(validateWindowChild),
    } as unknown as SnapshotWindow
  }
  if (record.type === TreeItemType.NOTE) {
    if (typeof record.text !== 'string')
      throw new Error(i18n.t('invalidSnapshotNote'))
    validateOptionalUid(record, 'windowUid', i18n.t('invalidSnapshotNote'))
    validateOptionalUid(record, 'parentUid', i18n.t('invalidSnapshotNote'))
    validateOptionalBoolean(record, 'collapsed', i18n.t('invalidSnapshotNote'))
    validateOptionalBoolean(record, 'isParent', i18n.t('invalidSnapshotNote'))
    return structuredClone(record) as unknown as SnapshotNote
  }
  if (record.type === TreeItemType.SEPARATOR) {
    validateOptionalUid(record, 'windowUid', i18n.t('invalidSnapshotSeparator'))
    validateOptionalUid(record, 'parentUid', i18n.t('invalidSnapshotSeparator'))
    validateOptionalFalseBoolean(
      record,
      'collapsed',
      i18n.t('invalidSnapshotSeparator'),
    )
    validateOptionalFalseBoolean(
      record,
      'isParent',
      i18n.t('invalidSnapshotSeparator'),
    )
    return structuredClone(record) as unknown as SnapshotSeparator
  }
  throw new Error(i18n.t('invalidTopLevelSnapshotItemType'))
}

function validateCommon(value: unknown): Record<string, unknown> {
  if (
    !isRecord(value) ||
    typeof value.uid !== 'string' ||
    value.uid.length === 0 ||
    !Number.isInteger(value.type) ||
    typeof value.indentLevel !== 'number' ||
    !Number.isInteger(value.indentLevel) ||
    value.indentLevel < 0
  ) {
    throw new Error(i18n.t('invalidSnapshotTreeItem'))
  }
  for (const transient of [
    'id',
    'active',
    'selected',
    'loadingStatus',
    'isVisible',
  ]) {
    if (transient in value)
      throw new Error(i18n.t('invalidTransientField', [transient]))
  }
  return value
}

function validateWindowChild(value: unknown): SnapshotWindowChild {
  if (isRecord(value) && value.type === TreeItemType.TAB) {
    let record: Record<string, unknown>
    try {
      record = validateCommon(value)
    } catch {
      throw new Error(i18n.t('invalidSnapshotTab'))
    }
    if (
      typeof record.title !== 'string' ||
      typeof record.url !== 'string' ||
      typeof record.windowUid !== 'string' ||
      record.windowUid.length === 0 ||
      typeof record.pinned !== 'boolean' ||
      !isSnapshotState(record.state)
    ) {
      throw new Error(i18n.t('invalidSnapshotTab'))
    }
    validateOptionalFiniteNumber(
      record,
      'savedTime',
      i18n.t('invalidSnapshotTab'),
    )
    validateOptionalBoolean(record, 'collapsed', i18n.t('invalidSnapshotTab'))
    validateOptionalBoolean(record, 'isParent', i18n.t('invalidSnapshotTab'))
    validateOptionalUid(record, 'parentUid', i18n.t('invalidSnapshotTab'))
    validateOptionalString(record, 'customLabel', i18n.t('invalidSnapshotTab'))
    validateTabGroup(record.tabGroup)
    validateContainer(record.container)
    return structuredClone(record) as unknown as SnapshotTab
  }
  const record = validateCommon(value)
  if (record.type === TreeItemType.NOTE) {
    if (typeof record.text !== 'string')
      throw new Error(i18n.t('invalidSnapshotNote'))
    if (typeof record.windowUid !== 'string' || record.windowUid.length === 0)
      throw new Error(i18n.t('invalidSnapshotNote'))
    validateOptionalUid(record, 'parentUid', i18n.t('invalidSnapshotNote'))
    validateOptionalBoolean(record, 'collapsed', i18n.t('invalidSnapshotNote'))
    validateOptionalBoolean(record, 'isParent', i18n.t('invalidSnapshotNote'))
    return structuredClone(record) as unknown as SnapshotNote
  }
  if (record.type === TreeItemType.SEPARATOR) {
    if (typeof record.windowUid !== 'string' || record.windowUid.length === 0)
      throw new Error(i18n.t('invalidSnapshotSeparator'))
    validateOptionalUid(record, 'parentUid', i18n.t('invalidSnapshotSeparator'))
    validateOptionalFalseBoolean(
      record,
      'isParent',
      i18n.t('invalidSnapshotSeparator'),
    )
    validateOptionalFalseBoolean(
      record,
      'collapsed',
      i18n.t('invalidSnapshotSeparator'),
    )
    return structuredClone(record) as unknown as SnapshotSeparator
  }
  throw new Error(i18n.t('invalidSnapshotWindowChildType'))
}

function validateSnapshotRelationships(
  items: readonly SnapshotTopLevelItem[],
): void {
  const allItems: SnapshotTreeItem[] = []
  const itemByUid = new Map<UID, SnapshotTreeItem>()

  for (const item of items) {
    claimSnapshotItem(item, itemByUid, allItems)
    if (item.type !== TreeItemType.WINDOW) continue
    for (const child of item.children) {
      claimSnapshotItem(child, itemByUid, allItems)
    }
  }

  validateSnapshotTabGroups(allItems, itemByUid)

  const topLevelByUid = new Map<UID, SnapshotTopLevelItem>(
    items.map((item) => [item.uid, item]),
  )
  validateParentLinks(
    items,
    topLevelByUid,
    0,
    'top-level',
    (parent) => parent.type === TreeItemType.NOTE,
  )

  for (const item of items) {
    if (item.type !== TreeItemType.WINDOW) {
      if (item.windowUid !== undefined)
        throw new Error(i18n.t('invalidSnapshotTopLevelContainerRelationship'))
      continue
    }

    validateWindowRelationships(item)
  }
}

function claimSnapshotItem(
  item: SnapshotTreeItem,
  itemByUid: Map<UID, SnapshotTreeItem>,
  allItems: SnapshotTreeItem[],
): void {
  if (itemByUid.has(item.uid))
    throw new Error(i18n.t('duplicateSnapshotUid', [item.uid]))
  itemByUid.set(item.uid, item)
  allItems.push(item)
}

function validateSnapshotTabGroups(
  items: readonly SnapshotTreeItem[],
  itemByUid: ReadonlyMap<UID, SnapshotTreeItem>,
): void {
  const groupsByUid = new Map<UID, SnapshotTabGroupMetadata>()
  for (const item of items) {
    if (item.type !== TreeItemType.TAB || item.tabGroup === undefined) continue
    const group = item.tabGroup
    if (itemByUid.has(group.uid)) {
      throw new Error(i18n.t('snapshotGroupUidCollision', [group.uid]))
    }
    const previous = groupsByUid.get(group.uid)
    if (
      previous &&
      (previous.title !== group.title ||
        previous.color !== group.color ||
        previous.collapsed !== group.collapsed)
    ) {
      throw new Error(i18n.t('snapshotGroupConflict', [group.uid]))
    }
    groupsByUid.set(group.uid, group)
  }
}

function validateWindowRelationships(window: SnapshotWindow): void {
  const childrenByUid = new Map<UID, SnapshotWindowChild>(
    window.children.map((child) => [child.uid, child]),
  )
  for (const child of window.children) {
    if (child.windowUid !== window.uid)
      throw new Error(i18n.t('invalidSnapshotChildRelationship'))
  }
  validateParentLinks(
    window.children,
    childrenByUid,
    1,
    'window child',
    (parent) =>
      parent.type === TreeItemType.TAB || parent.type === TreeItemType.NOTE,
    window,
  )

  if (window.savedActiveTabUid === undefined) return
  const savedActiveTab = window.children.find(
    (child): child is SnapshotTab =>
      child.type === TreeItemType.TAB && child.uid === window.savedActiveTabUid,
  )
  if (!savedActiveTab)
    throw new Error(i18n.t('invalidSnapshotSavedActiveTabRelationship'))
  if (window.state === State.SAVED && savedActiveTab.state === State.OPEN) {
    throw new Error(i18n.t('invalidSnapshotSavedActiveTabRelationship'))
  }
}

function validateParentLinks(
  items: readonly SnapshotTreeItem[],
  itemsByUid: ReadonlyMap<UID, SnapshotTreeItem>,
  rootIndentLevel: number,
  containerName: string,
  isValidParent: (parent: SnapshotTreeItem) => boolean,
  rootParent?: SnapshotTreeItem,
): void {
  for (const item of items) {
    if (item.parentUid !== undefined && !itemsByUid.has(item.parentUid)) {
      throw new Error(
        i18n.t('snapshotParentRelationship', [
          containerName === 'window child'
            ? i18n.t('snapshotWindowChild')
            : i18n.t('snapshotTopLevel'),
        ]),
      )
    }
  }

  for (const item of items) {
    const visited = new Set<UID>()
    let current: SnapshotTreeItem | undefined = item
    while (current.parentUid !== undefined) {
      if (visited.has(current.uid))
        throw new Error(i18n.t('cyclicSnapshotParent'))
      visited.add(current.uid)
      current = itemsByUid.get(current.parentUid)
      if (!current)
        throw new Error(
          i18n.t('snapshotParentRelationship', [
            containerName === 'window child'
              ? i18n.t('snapshotWindowChild')
              : i18n.t('snapshotTopLevel'),
          ]),
        )
    }
  }

  for (const item of items) {
    const parent =
      item.parentUid === undefined ? undefined : itemsByUid.get(item.parentUid)
    if (parent && !isValidParent(parent)) {
      throw new Error(
        i18n.t('snapshotParentRelationship', [
          containerName === 'window child'
            ? i18n.t('snapshotWindowChild')
            : i18n.t('snapshotTopLevel'),
        ]),
      )
    }
    const expectedIndentLevel = parent
      ? parent.indentLevel + 1
      : rootParent
        ? rootParent.indentLevel + 1
        : rootIndentLevel
    if (item.indentLevel !== expectedIndentLevel) {
      throw new Error(
        i18n.t('snapshotIndentRelationship', [
          containerName === 'window child'
            ? i18n.t('snapshotWindowChild')
            : i18n.t('snapshotTopLevel'),
        ]),
      )
    }
  }
}

function validateTabGroup(value: unknown): void {
  if (value === undefined) return
  if (
    !isRecord(value) ||
    typeof value.uid !== 'string' ||
    value.uid.length === 0 ||
    typeof value.color !== 'string' ||
    !TAB_GROUP_COLORS.has(value.color as TabGroupColor) ||
    typeof value.collapsed !== 'boolean'
  ) {
    throw new Error(i18n.t('invalidSnapshotTabGroup'))
  }
  validateOptionalString(value, 'title', i18n.t('invalidSnapshotTabGroup'))
  if ('id' in value) throw new Error(i18n.t('invalidSnapshotTabGroup'))
}

function validateContainer(value: unknown): void {
  if (value === undefined) return
  if (
    !isRecord(value) ||
    typeof value.cookieStoreId !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.color !== 'string' ||
    typeof value.colorCode !== 'string' ||
    typeof value.icon !== 'string'
  ) {
    throw new Error(i18n.t('invalidSnapshotContainer'))
  }
  validateOptionalString(value, 'iconUrl', i18n.t('invalidSnapshotContainer'))
}

function validateWindowPosition(value: unknown): void {
  if (value === undefined) return
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.left) ||
    !isFiniteNumber(value.top) ||
    !isFiniteNumber(value.width) ||
    !isFiniteNumber(value.height)
  ) {
    throw new Error(i18n.t('invalidSnapshotWindowPosition'))
  }
}

function validateOptionalUid(
  record: Record<string, unknown>,
  field: string,
  errorMessage: string,
): void {
  const value = record[field]
  if (value !== undefined && (typeof value !== 'string' || value.length === 0))
    throw new Error(errorMessage)
}

function validateOptionalString(
  record: Record<string, unknown>,
  field: string,
  errorMessage: string,
): void {
  if (record[field] !== undefined && typeof record[field] !== 'string')
    throw new Error(errorMessage)
}

function validateOptionalBoolean(
  record: Record<string, unknown>,
  field: string,
  errorMessage: string,
): void {
  if (record[field] !== undefined && typeof record[field] !== 'boolean')
    throw new Error(errorMessage)
}

function validateOptionalFalseBoolean(
  record: Record<string, unknown>,
  field: string,
  errorMessage: string,
): void {
  if (record[field] !== undefined && record[field] !== false)
    throw new Error(errorMessage)
}

function validateOptionalFiniteNumber(
  record: Record<string, unknown>,
  field: string,
  errorMessage: string,
): void {
  if (record[field] !== undefined && !isFiniteNumber(record[field]))
    throw new Error(errorMessage)
}

function isSnapshotState(value: unknown): value is State {
  return (
    value === State.SAVED ||
    value === State.OPEN ||
    value === State.DISCARDED ||
    value === State.OTHER
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

const TAB_GROUP_COLORS = new Set<TabGroupColor>([
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
