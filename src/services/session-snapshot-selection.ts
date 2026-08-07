import type {
  SessionSnapshotPayload,
  SnapshotTopLevelItem,
  SnapshotTreeItem,
  SnapshotWindow,
} from '@/types/session-snapshots'
import { TreeItemType } from '@/types/session-tree'

export interface SnapshotVisibleRow {
  item: SnapshotTreeItem
  containingWindowUid?: UID
}

export function flattenSnapshotItems(
  payload: SessionSnapshotPayload,
  collapsedUids: ReadonlySet<UID>,
): SnapshotVisibleRow[] {
  const rows: SnapshotVisibleRow[] = []
  appendVisible(payload.items, rows, collapsedUids)
  return rows
}

export function snapshotDescendantItems(
  payload: SessionSnapshotPayload,
  item: SnapshotTreeItem,
): SnapshotTreeItem[] {
  if (item.type === TreeItemType.WINDOW) return [...item.children]

  const items = containingSnapshotItems(payload, item)
  const index = items.findIndex((candidate) => candidate.uid === item.uid)
  if (index === -1) return []

  const descendants: SnapshotTreeItem[] = []
  const indentLevel = item.indentLevel ?? 0
  for (let current = index + 1; current < items.length; current++) {
    const candidate = items[current]
    if ((candidate.indentLevel ?? 0) <= indentLevel) break
    descendants.push(candidate)
    if (candidate.type === TreeItemType.WINDOW) {
      descendants.push(...candidate.children)
    }
  }
  return descendants
}

export function cycleSnapshotSelection(
  payload: SessionSnapshotPayload,
  current: ReadonlySet<UID>,
  uid: UID,
): Set<UID> {
  const selected = new Set(current)
  const target = findSelectionTarget(payload, uid)
  if (!target) return selected
  if (target.isWindow) {
    const state = snapshotSelectionState(payload, current, uid)
    selected.delete(uid)
    if (state.checked) {
      target.descendantUids.forEach((descendantUid) =>
        selected.delete(descendantUid),
      )
    } else {
      target.descendantUids.forEach((descendantUid) =>
        selected.add(descendantUid),
      )
    }
    return selected
  }
  if (target.descendantUids.length === 0) {
    if (selected.has(uid)) selected.delete(uid)
    else selected.add(uid)
    return selected
  }

  const state = snapshotSelectionState(payload, current, uid)
  if (state.checked) {
    selected.delete(uid)
    target.descendantUids.forEach((descendantUid) =>
      selected.delete(descendantUid),
    )
  } else if (state.indeterminate) {
    selected.add(uid)
    target.descendantUids.forEach((descendantUid) =>
      selected.add(descendantUid),
    )
  } else {
    selected.add(uid)
  }
  return selected
}

export function snapshotSelectionState(
  payload: SessionSnapshotPayload,
  selected: ReadonlySet<UID>,
  uid: UID,
): { checked: boolean; indeterminate: boolean } {
  const target = findSelectionTarget(payload, uid)
  if (!target || target.descendantUids.length === 0) {
    return { checked: selected.has(uid), indeterminate: false }
  }
  const selfSelected = selected.has(uid)
  const selectedDescendants = target.descendantUids.filter((descendantUid) =>
    selected.has(descendantUid),
  ).length
  if (target.isWindow) {
    const hasDescendants = target.descendantUids.length > 0
    return {
      checked:
        hasDescendants && selectedDescendants === target.descendantUids.length,
      indeterminate:
        selectedDescendants > 0 &&
        selectedDescendants < target.descendantUids.length,
    }
  }
  if (!target.aggregateDescendantSelection && !selfSelected) {
    return { checked: false, indeterminate: false }
  }
  const fullySelected =
    selfSelected && selectedDescendants === target.descendantUids.length
  return {
    checked: fullySelected,
    indeterminate: !fullySelected && (selfSelected || selectedDescendants > 0),
  }
}

interface SelectionTarget {
  descendantUids: UID[]
  aggregateDescendantSelection: boolean
  isWindow: boolean
}

function findSelectionTarget(
  payload: SessionSnapshotPayload,
  uid: UID,
): SelectionTarget | undefined {
  const topLevelIndex = payload.items.findIndex((item) => item.uid === uid)
  if (topLevelIndex !== -1) {
    const item = payload.items[topLevelIndex]
    if (item.type === TreeItemType.WINDOW) {
      return {
        descendantUids: item.children.map((child) => child.uid),
        aggregateDescendantSelection: true,
        isWindow: true,
      }
    }
    return {
      descendantUids: descendantUidsInContainer(payload.items, topLevelIndex),
      aggregateDescendantSelection: false,
      isWindow: false,
    }
  }

  for (const item of payload.items) {
    if (item.type !== TreeItemType.WINDOW) continue
    const childIndex = item.children.findIndex((child) => child.uid === uid)
    if (childIndex === -1) continue
    return {
      descendantUids: descendantUidsInContainer(item.children, childIndex),
      aggregateDescendantSelection: false,
      isWindow: false,
    }
  }
  return undefined
}

function descendantUidsInContainer<T extends SnapshotTreeItem>(
  items: readonly T[],
  itemIndex: number,
): UID[] {
  const item = items[itemIndex]
  const indentLevel = item.indentLevel ?? 0
  const descendantUids: UID[] = []
  for (let index = itemIndex + 1; index < items.length; index++) {
    const candidate = items[index]
    if ((candidate.indentLevel ?? 0) <= indentLevel) break
    descendantUids.push(candidate.uid)
    if (candidate.type === TreeItemType.WINDOW) {
      descendantUids.push(...candidate.children.map((child) => child.uid))
    }
  }
  return descendantUids
}

function containingSnapshotItems(
  payload: SessionSnapshotPayload,
  item: SnapshotTreeItem,
): readonly SnapshotTreeItem[] {
  const window = payload.items.find(
    (candidate): candidate is SnapshotWindow =>
      candidate.type === TreeItemType.WINDOW &&
      candidate.children.some((child) => child.uid === item.uid),
  )
  return window?.children ?? payload.items
}

function appendVisible(
  items: readonly SnapshotTopLevelItem[],
  rows: SnapshotVisibleRow[],
  collapsedUids: ReadonlySet<UID>,
): void {
  const byUid = new Map(items.map((item) => [item.uid, item]))
  for (const item of items) {
    if (hasCollapsedAncestor(item, byUid, collapsedUids)) continue
    rows.push({ item })
    if (item.type !== TreeItemType.WINDOW || collapsedUids.has(item.uid))
      continue
    const childByUid = new Map(item.children.map((child) => [child.uid, child]))
    for (const child of item.children) {
      if (hasCollapsedAncestor(child, childByUid, collapsedUids)) continue
      rows.push({ item: child, containingWindowUid: item.uid })
    }
  }
}

function hasCollapsedAncestor<T extends { uid: UID; parentUid?: UID }>(
  item: T,
  byUid: ReadonlyMap<UID, T>,
  collapsedUids: ReadonlySet<UID>,
): boolean {
  const visited = new Set<UID>()
  let parentUid = item.parentUid
  while (parentUid && !visited.has(parentUid)) {
    if (collapsedUids.has(parentUid)) return true
    visited.add(parentUid)
    parentUid = byUid.get(parentUid)?.parentUid
  }
  return false
}
