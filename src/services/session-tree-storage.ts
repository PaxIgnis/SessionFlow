import * as Utils from '@/services/utils'
import {
  ContainerMetadata,
  LoadingStatus,
  Note,
  Separator,
  State,
  Tab,
  TabGroupColor,
  TabGroupMetadata,
  TopLevelTreeItem,
  TreeItem,
  TreeItemType,
  Window,
  WindowChild,
  WindowPosition,
} from '@/types/session-tree'

export const STORED_TREE_REPAIR_POLICY = {
  duplicateItemUid: 'keep-first-and-regenerate-later',
  itemGroupUidCollision: 'regenerate-group-uid-for-all-members',
  missingParent: 'remove-parent-link',
  crossContainerParent: 'remove-parent-link',
  cycle: 'remove-the-link-that-closes-the-cycle',
} as const

export interface NormalizedStoredTree {
  items: TopLevelTreeItem[]
  startupOpenTabUids: Set<UID>
  repaired: boolean
}

interface NormalizationContext {
  existingUids: Set<UID>
  groupUids: Map<string, UID>
  itemUidValues: Set<string>
  now: () => number
  repaired: boolean
  startupOpenTabUids: Set<UID>
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

export function normalizeStoredSessionTree(
  value: unknown,
  existingUids: Set<UID>,
  now: () => number = Date.now,
): NormalizedStoredTree {
  const context: NormalizationContext = {
    existingUids,
    groupUids: new Map(),
    itemUidValues: collectItemUidValues(value),
    now,
    repaired: false,
    startupOpenTabUids: new Set(),
  }

  if (!Array.isArray(value)) {
    return {
      items: [],
      startupOpenTabUids: context.startupOpenTabUids,
      repaired: value !== undefined && value !== null,
    }
  }

  const items = value
    .map((item) => normalizeTopLevelItem(item, context))
    .filter((item): item is TopLevelTreeItem => item !== undefined)

  repairParents(items, true, context)
  updateParentFlags(items)
  for (const item of items) {
    if (item.type !== TreeItemType.WINDOW) continue
    repairParents(item.children, false, context)
    updateParentFlags(item.children)
    item.isParent = item.children.length > 0
  }

  return {
    items,
    startupOpenTabUids: context.startupOpenTabUids,
    repaired: context.repaired,
  }
}

function normalizeTopLevelItem(
  value: unknown,
  context: NormalizationContext,
): TopLevelTreeItem | undefined {
  const record = asRecord(value)
  if (!record) {
    context.repaired = true
    return undefined
  }

  if (record.type === TreeItemType.WINDOW) {
    return normalizeWindow(record, context)
  }
  if (record.type === TreeItemType.NOTE) {
    return normalizeNote(record, undefined, context)
  }
  if (record.type === TreeItemType.SEPARATOR) {
    return normalizeSeparator(record, undefined, context)
  }

  context.repaired = true
  return undefined
}

function normalizeWindow(
  record: Record<string, unknown>,
  context: NormalizationContext,
): Window {
  const uid = claimItemUid(record.uid, context)
  const children = Array.isArray(record.children)
    ? record.children
        .map((child) => normalizeWindowChild(child, uid, context))
        .filter((child): child is WindowChild => child !== undefined)
    : []
  if (!Array.isArray(record.children)) context.repaired = true

  return {
    type: TreeItemType.WINDOW,
    uid,
    id: 0,
    incognito: booleanValue(record.incognito, false, context),
    selected: false,
    state: record.state === State.OPEN ? State.OPEN : State.SAVED,
    children,
    indentLevel: finiteNumber(record.indentLevel, 0, context),
    active: false,
    activeTabId: undefined,
    savedActiveTabUid: optionalUid(record.savedActiveTabUid),
    savedTime: positiveNumber(record.savedTime, context.now(), context),
    collapsed: optionalBoolean(record.collapsed),
    windowPosition: normalizeWindowPosition(record.windowPosition, context),
    title: optionalString(record.title),
    isParent: children.length > 0,
    parentUid: optionalUid(record.parentUid),
    isVisible: optionalBoolean(record.isVisible),
  }
}

function normalizeWindowChild(
  value: unknown,
  windowUid: UID,
  context: NormalizationContext,
): WindowChild | undefined {
  const record = asRecord(value)
  if (!record) {
    context.repaired = true
    return undefined
  }

  if (record.type === TreeItemType.TAB) {
    return normalizeTab(record, windowUid, context)
  }
  if (record.type === TreeItemType.NOTE) {
    return normalizeNote(record, windowUid, context)
  }
  if (record.type === TreeItemType.SEPARATOR) {
    return normalizeSeparator(record, windowUid, context)
  }

  context.repaired = true
  return undefined
}

function normalizeTab(
  record: Record<string, unknown>,
  windowUid: UID,
  context: NormalizationContext,
): Tab {
  const uid = claimItemUid(record.uid, context)
  if (record.state === State.OPEN || record.state === State.DISCARDED) {
    context.startupOpenTabUids.add(uid)
  }

  return {
    type: TreeItemType.TAB,
    uid,
    active: false,
    id: 0,
    savedTime: positiveNumber(record.savedTime, context.now(), context),
    selected: false,
    state: State.SAVED,
    title: stringValue(record.title, 'Untitled', context),
    url: stringValue(record.url, '', context),
    windowUid,
    collapsed: optionalBoolean(record.collapsed),
    loadingStatus:
      record.loadingStatus === 'loading' || record.loadingStatus === 'complete'
        ? record.loadingStatus === 'loading'
          ? LoadingStatus.LOADING
          : LoadingStatus.COMPLETE
        : undefined,
    indentLevel: finiteNumber(record.indentLevel, 1, context),
    pinned: booleanValue(record.pinned, false, context),
    isParent: false,
    parentUid: optionalUid(record.parentUid),
    isVisible: optionalBoolean(record.isVisible),
    customLabel: optionalString(record.customLabel),
    tabGroup: normalizeTabGroup(record.tabGroup, context),
    container: normalizeContainer(record.container, context),
  }
}

function normalizeNote(
  record: Record<string, unknown>,
  windowUid: UID | undefined,
  context: NormalizationContext,
): Note {
  return {
    type: TreeItemType.NOTE,
    uid: claimItemUid(record.uid, context),
    text: stringValue(record.text, '', context),
    selected: false,
    windowUid,
    collapsed: booleanValue(record.collapsed, false, context),
    indentLevel: finiteNumber(
      record.indentLevel,
      windowUid === undefined ? 0 : 1,
      context,
    ),
    isParent: false,
    parentUid: optionalUid(record.parentUid),
    isVisible: optionalBoolean(record.isVisible),
  }
}

function normalizeSeparator(
  record: Record<string, unknown>,
  windowUid: UID | undefined,
  context: NormalizationContext,
): Separator {
  return {
    type: TreeItemType.SEPARATOR,
    uid: claimItemUid(record.uid, context),
    selected: false,
    windowUid,
    indentLevel: finiteNumber(
      record.indentLevel,
      windowUid === undefined ? 0 : 1,
      context,
    ),
    parentUid: optionalUid(record.parentUid),
    isVisible: optionalBoolean(record.isVisible),
    isParent: false,
    collapsed: false,
  }
}

function normalizeTabGroup(
  value: unknown,
  context: NormalizationContext,
): TabGroupMetadata | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  if (!TAB_GROUP_COLORS.has(record.color as TabGroupColor)) {
    context.repaired = true
    return undefined
  }

  const rawUid = optionalUid(record.uid)
  let uid = rawUid ? context.groupUids.get(rawUid) : undefined
  if (!uid) {
    if (
      rawUid &&
      !context.itemUidValues.has(rawUid) &&
      !context.existingUids.has(rawUid)
    ) {
      uid = rawUid
      context.existingUids.add(uid)
    } else {
      uid = Utils.createUid(context.existingUids) as UID
      context.repaired = true
    }
    if (rawUid) context.groupUids.set(rawUid, uid)
  }

  return {
    uid,
    id: -1,
    title: optionalString(record.title),
    color: record.color as TabGroupColor,
    collapsed: booleanValue(record.collapsed, false, context),
  }
}

function normalizeContainer(
  value: unknown,
  context: NormalizationContext,
): ContainerMetadata | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const required = [
    record.cookieStoreId,
    record.name,
    record.color,
    record.colorCode,
    record.icon,
  ]
  if (!required.every((entry) => typeof entry === 'string')) {
    context.repaired = true
    return undefined
  }

  return {
    cookieStoreId: record.cookieStoreId as string,
    name: record.name as string,
    color: record.color as string,
    colorCode: record.colorCode as string,
    icon: record.icon as string,
    iconUrl: optionalString(record.iconUrl),
  }
}

function normalizeWindowPosition(
  value: unknown,
  context: NormalizationContext,
): WindowPosition | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const values = [record.left, record.top, record.width, record.height]
  if (!values.every(isFiniteNumber)) {
    context.repaired = true
    return undefined
  }
  return {
    left: record.left as number,
    top: record.top as number,
    width: record.width as number,
    height: record.height as number,
  }
}

function repairParents<T extends TreeItem>(
  items: T[],
  topLevel: boolean,
  context: NormalizationContext,
): void {
  const byUid = new Map(items.map((item) => [item.uid, item] as const))
  for (const item of items) {
    if (!item.parentUid) continue
    const parent = byUid.get(item.parentUid)
    const validParent =
      parent &&
      parent.uid !== item.uid &&
      (topLevel
        ? parent.type === TreeItemType.NOTE
        : parent.type === TreeItemType.TAB || parent.type === TreeItemType.NOTE)
    if (!validParent) {
      item.parentUid = undefined
      context.repaired = true
    }
  }

  for (const item of items) {
    const seen = new Set<UID>([item.uid])
    let cursor: TreeItem = item
    while (cursor.parentUid) {
      if (seen.has(cursor.parentUid)) {
        cursor.parentUid = undefined
        context.repaired = true
        break
      }
      seen.add(cursor.parentUid)
      const parent = byUid.get(cursor.parentUid)
      if (!parent) break
      cursor = parent
    }
  }
}

function updateParentFlags(items: TreeItem[]): void {
  const byUid = new Map(items.map((item) => [item.uid, item] as const))
  for (const item of items) {
    if (item.type !== TreeItemType.SEPARATOR) item.isParent = false
  }
  for (const item of items) {
    if (!item.parentUid) continue
    const parent = byUid.get(item.parentUid)
    if (parent && parent.type !== TreeItemType.SEPARATOR) parent.isParent = true
  }
}

function claimItemUid(value: unknown, context: NormalizationContext): UID {
  if (typeof value === 'string' && !context.existingUids.has(value)) {
    context.existingUids.add(value)
    return value as UID
  }
  context.repaired = true
  return Utils.createUid(context.existingUids) as UID
}

function collectItemUidValues(value: unknown): Set<string> {
  const values = new Set<string>()
  if (!Array.isArray(value)) return values
  for (const item of value) {
    const record = asRecord(item)
    if (!record) continue
    if (typeof record.uid === 'string') values.add(record.uid)
    if (!Array.isArray(record.children)) continue
    for (const child of record.children) {
      const childRecord = asRecord(child)
      if (typeof childRecord?.uid === 'string') values.add(childRecord.uid)
    }
  }
  return values
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function optionalUid(value: unknown): UID | undefined {
  return typeof value === 'string' && value.length > 0
    ? (value as UID)
    : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function stringValue(
  value: unknown,
  fallback: string,
  context: NormalizationContext,
): string {
  if (typeof value === 'string') return value
  context.repaired = true
  return fallback
}

function booleanValue(
  value: unknown,
  fallback: boolean,
  context: NormalizationContext,
): boolean {
  if (typeof value === 'boolean') return value
  if (value !== undefined) context.repaired = true
  return fallback
}

function finiteNumber(
  value: unknown,
  fallback: number,
  context: NormalizationContext,
): number {
  if (isFiniteNumber(value)) return value
  if (value !== undefined) context.repaired = true
  return fallback
}

function positiveNumber(
  value: unknown,
  fallback: number,
  context: NormalizationContext,
): number {
  if (isFiniteNumber(value) && value > 0) return value
  if (value !== undefined) context.repaired = true
  return fallback
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
