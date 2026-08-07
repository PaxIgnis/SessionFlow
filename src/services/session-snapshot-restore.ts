import { countSnapshotItems } from '@/services/session-snapshot-codec'
import * as Utils from '@/services/utils'
import type {
  SessionSnapshotCounts,
  SessionSnapshotPayload,
  SessionSnapshotRestoreMode,
  SnapshotTopLevelItem,
  SnapshotTreeItem,
  SnapshotWindow,
  SnapshotWindowChild,
} from '@/types/session-snapshots'
import type {
  Note,
  Separator,
  Tab,
  TopLevelTreeItem,
  Window,
  WindowChild,
} from '@/types/session-tree'
import { State, TreeItemType } from '@/types/session-tree'

interface RestoreProjectionOptions {
  payload: SessionSnapshotPayload
  mode: SessionSnapshotRestoreMode
  selectedUids: ReadonlySet<UID>
  existingUids: ReadonlySet<UID>
}

export function projectSnapshotForRestore(options: RestoreProjectionOptions): {
  items: TopLevelTreeItem[]
  counts: SessionSnapshotCounts
} {
  const existingUids = new Set<string>(options.existingUids)
  const selected = effectiveSelection(options)
  const includedItems = collectIncludedItems(options.payload.items, selected)
  const itemUidMap = new Map<UID, UID>()
  const groupUidMap = new Map<UID, UID>()

  for (const item of includedItems) {
    itemUidMap.set(item.uid, createUid(existingUids))
    if (item.type === TreeItemType.TAB && item.tabGroup) {
      if (!groupUidMap.has(item.tabGroup.uid)) {
        groupUidMap.set(item.tabGroup.uid, createUid(existingUids))
      }
    }
  }

  const restored: TopLevelTreeItem[] = []
  for (const source of options.payload.items) {
    if (source.type === TreeItemType.WINDOW) {
      const selectedChildren = source.children.filter((child) =>
        selected.has(child.uid),
      )
      if (options.mode !== 'all' && selectedChildren.length === 0) continue
      restored.push(
        restoreWindow(
          source,
          selectedChildren,
          selected.has(source.uid),
          selected,
          itemUidMap,
          groupUidMap,
          existingUids,
        ),
      )
      continue
    }
    if (!selected.has(source.uid)) continue
    restored.push(
      restoreTopLevelNonWindow(source, selected, itemUidMap, existingUids),
    )
  }

  repairTopLevelHierarchy(restored, options.payload.items, selected, itemUidMap)
  return {
    items: restored,
    counts: countRestoredItems(restored),
  }
}

function effectiveSelection(options: RestoreProjectionOptions): Set<UID> {
  if (options.mode === 'all') {
    return new Set(
      options.payload.items.flatMap((item) =>
        item.type === TreeItemType.WINDOW
          ? [item.uid, ...item.children.map((child) => child.uid)]
          : [item.uid],
      ),
    )
  }
  const selected = new Set(options.selectedUids)
  for (const item of options.payload.items) {
    if (
      item.type === TreeItemType.WINDOW &&
      item.children.length > 0 &&
      item.children.every((child) => selected.has(child.uid))
    ) {
      selected.add(item.uid)
    }
  }
  return selected
}

function collectIncludedItems(
  items: readonly SnapshotTopLevelItem[],
  selected: ReadonlySet<UID>,
): SnapshotTreeItem[] {
  return items.flatMap((item) => {
    if (item.type !== TreeItemType.WINDOW) {
      return selected.has(item.uid) ? [item] : []
    }
    const children = item.children.filter((child) => selected.has(child.uid))
    return selected.has(item.uid) || children.length > 0
      ? [item, ...children]
      : []
  })
}

function restoreWindow(
  source: SnapshotWindow,
  selectedChildren: SnapshotWindowChild[],
  windowSelected: boolean,
  selected: ReadonlySet<UID>,
  itemUidMap: Map<UID, UID>,
  groupUidMap: Map<UID, UID>,
  existingUids: Set<string>,
): Window {
  let windowUid = itemUidMap.get(source.uid)
  if (!windowUid) {
    windowUid = createUid(existingUids)
    itemUidMap.set(source.uid, windowUid)
  }
  const sourceChildrenByUid = new Map<UID, SnapshotWindowChild>(
    source.children.map((child) => [child.uid, child]),
  )
  const sourceChildrenByRestoredUid = new Map<UID, SnapshotWindowChild>()
  for (const child of source.children) {
    const restoredUid = itemUidMap.get(child.uid)
    if (restoredUid) sourceChildrenByRestoredUid.set(restoredUid, child)
  }
  const children = selectedChildren.map((child) =>
    restoreWindowChild(
      child,
      sourceChildrenByUid,
      sourceChildrenByRestoredUid,
      selected,
      windowUid,
      itemUidMap,
      groupUidMap,
    ),
  )
  updateParentFlags(children)
  return {
    ...structuredClone(source),
    uid: windowUid,
    id: -1,
    active: false,
    activeTabId: undefined,
    savedActiveTabUid:
      source.savedActiveTabUid && selected.has(source.savedActiveTabUid)
        ? itemUidMap.get(source.savedActiveTabUid)
        : undefined,
    selected: false,
    state: State.SAVED,
    children,
    indentLevel: windowSelected ? source.indentLevel : 0,
    parentUid: windowSelected ? source.parentUid : undefined,
    isVisible: true,
    isParent: children.length > 0,
  }
}

function restoreWindowChild(
  source: SnapshotWindowChild,
  sourceSiblingsByUid: ReadonlyMap<UID, SnapshotWindowChild>,
  sourceChildrenByRestoredUid: ReadonlyMap<UID, SnapshotWindowChild>,
  selected: ReadonlySet<UID>,
  windowUid: UID,
  itemUidMap: ReadonlyMap<UID, UID>,
  groupUidMap: ReadonlyMap<UID, UID>,
): WindowChild {
  const parentUid = nearestSelectedParent(
    source,
    sourceSiblingsByUid,
    selected,
    itemUidMap,
  )
  const parentIndent = parentUid
    ? restoredIndent(
        parentUid,
        sourceChildrenByRestoredUid,
        sourceSiblingsByUid,
        selected,
        itemUidMap,
        1,
      )
    : 0
  const common = {
    ...structuredClone(source),
    uid: itemUidMap.get(source.uid)!,
    windowUid,
    selected: false,
    parentUid,
    indentLevel: parentIndent + 1,
    isVisible: true,
  }
  if (source.type === TreeItemType.TAB) {
    return {
      ...common,
      type: TreeItemType.TAB,
      id: -1,
      active: false,
      state: State.SAVED,
      loadingStatus: undefined,
      tabGroup: source.tabGroup
        ? {
            ...structuredClone(source.tabGroup),
            uid: groupUidMap.get(source.tabGroup.uid)!,
            id: -1,
          }
        : undefined,
    } as Tab
  }
  if (source.type === TreeItemType.NOTE) {
    return { ...common, type: TreeItemType.NOTE } as Note
  }
  return {
    ...common,
    type: TreeItemType.SEPARATOR,
    isParent: false,
    collapsed: false,
  } as Separator
}

function restoreTopLevelNonWindow(
  source: Exclude<SnapshotTopLevelItem, SnapshotWindow>,
  selected: ReadonlySet<UID>,
  itemUidMap: ReadonlyMap<UID, UID>,
  existingUids: Set<string>,
): Note | Separator {
  const uid = itemUidMap.get(source.uid) ?? createUid(existingUids)
  const common = {
    ...structuredClone(source),
    uid,
    selected: false,
    windowUid: undefined,
    isVisible: true,
  }
  if (source.type === TreeItemType.NOTE) {
    return { ...common, type: TreeItemType.NOTE } as Note
  }
  return {
    ...common,
    type: TreeItemType.SEPARATOR,
    isParent: false,
    collapsed: false,
  } as Separator
}

function repairTopLevelHierarchy(
  restored: TopLevelTreeItem[],
  sourceItems: readonly SnapshotTopLevelItem[],
  selected: ReadonlySet<UID>,
  uidMap: ReadonlyMap<UID, UID>,
): void {
  const restoredByUid = new Map(restored.map((item) => [item.uid, item]))
  const sourceByUid = new Map<UID, SnapshotTopLevelItem>(
    sourceItems.map((item) => [item.uid, item]),
  )
  const sourceByRestoredUid = new Map<UID, SnapshotTopLevelItem>()
  for (const source of sourceItems) {
    const restoredUid = uidMap.get(source.uid)
    if (restoredUid) sourceByRestoredUid.set(restoredUid, source)
  }
  for (const restoredItem of restored) {
    const source = sourceByRestoredUid.get(restoredItem.uid)
    if (!source) continue
    const parentUid = nearestSelectedParent(
      source,
      sourceByUid,
      selected,
      uidMap,
    )
    restoredItem.parentUid = parentUid
    restoredItem.indentLevel = parentUid
      ? (restoredByUid.get(parentUid)?.indentLevel ?? 0) + 1
      : 0
  }
  updateParentFlags(restored)
}

function nearestSelectedParent<T extends SnapshotTreeItem>(
  source: T,
  sourceByUid: ReadonlyMap<UID, T>,
  selected: ReadonlySet<UID>,
  uidMap: ReadonlyMap<UID, UID>,
): UID | undefined {
  let parentUid = source.parentUid
  const visited = new Set<UID>()
  while (parentUid && !visited.has(parentUid)) {
    visited.add(parentUid)
    if (selected.has(parentUid)) return uidMap.get(parentUid)
    parentUid = sourceByUid.get(parentUid)?.parentUid
  }
  return undefined
}

function restoredIndent<T extends SnapshotTreeItem>(
  restoredParentUid: UID,
  sourceByRestoredUid: ReadonlyMap<UID, T>,
  sourceByUid: ReadonlyMap<UID, T>,
  selected: ReadonlySet<UID>,
  uidMap: ReadonlyMap<UID, UID>,
  rootIndent: number,
): number {
  const source = sourceByRestoredUid.get(restoredParentUid)
  if (!source) return rootIndent
  const parent = nearestSelectedParent(source, sourceByUid, selected, uidMap)
  return parent
    ? restoredIndent(
        parent,
        sourceByRestoredUid,
        sourceByUid,
        selected,
        uidMap,
        rootIndent,
      ) + 1
    : rootIndent
}

function updateParentFlags(items: Array<TopLevelTreeItem | WindowChild>): void {
  const parentUids = new Set(
    items.flatMap((item) => (item.parentUid ? [item.parentUid] : [])),
  )
  for (const item of items) {
    if (item.type !== TreeItemType.SEPARATOR) {
      item.isParent = parentUids.has(item.uid)
      if (!item.isParent) item.collapsed = false
    }
  }
}

function countRestoredItems(
  items: readonly TopLevelTreeItem[],
): SessionSnapshotCounts {
  return countSnapshotItems(items as unknown as SnapshotTopLevelItem[])
}

function createUid(existing: Set<string>): UID {
  return Utils.createUid(existing) as UID
}
