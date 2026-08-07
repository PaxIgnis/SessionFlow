import {
  TreeItemType,
  type Note,
  type Separator,
  type Tab,
  type TreeItem,
  type Window,
} from '@/types/session-tree'

export function isWindow(item: TreeItem): item is Window {
  return item.type === TreeItemType.WINDOW
}

export function isTab(item: TreeItem): item is Tab {
  return item.type === TreeItemType.TAB
}

export function isNote(item: TreeItem): item is Note {
  return item.type === TreeItemType.NOTE
}

export function isSeparator(item: TreeItem): item is Separator {
  return item.type === TreeItemType.SEPARATOR
}

export function getChildren(item: TreeItem): TreeItem[] {
  if (item.type === TreeItemType.WINDOW) return item.children
  return []
}

export function getTabs(children: TreeItem[]): Tab[] {
  return children.filter(isTab)
}

export function walkTreeItems(
  items: TreeItem[],
  callback: (item: TreeItem) => void,
): void {
  for (const item of items) {
    callback(item)
    walkTreeItems(getChildren(item), callback)
  }
}

export function countTreeItemDescendants(
  item: TreeItem,
  containingItems?: TreeItem[],
): number {
  if (item.type === TreeItemType.WINDOW) {
    return countContainerItems(item.children as TreeItem[])
  }

  if (!containingItems) return 0
  const itemIndex = containingItems.findIndex((child) => child.uid === item.uid)
  if (itemIndex === -1) return 0

  let count = 0
  const parentIndent = item.indentLevel ?? 0
  for (let i = itemIndex + 1; i < containingItems.length; i++) {
    const child = containingItems[i]
    const indent = child.indentLevel ?? 0
    if (indent <= parentIndent) break
    count += 1
    if (child.type === TreeItemType.WINDOW) {
      count += countTreeItemDescendants(child)
    }
  }
  return count
}

function countContainerItems(items: TreeItem[]): number {
  return items.reduce((count, item) => {
    const nestedCount =
      item.type === TreeItemType.WINDOW ? countTreeItemDescendants(item) : 0
    return count + 1 + nestedCount
  }, 0)
}

/**
 * Builds a map of parentUid to child tree items for quick lookup.
 * @param items Complete list of tree items from a parent.
 */
export function buildChildrenMap<T extends TreeItem>(items: T[]) {
  const map = new Map<UID, T[]>()
  for (const item of items) {
    const uid = item.parentUid
    if (uid !== undefined) {
      if (!map.has(uid)) map.set(uid, [])
      map.get(uid)!.push(item)
    }
  }
  return map
}

export interface TreeItemIndentGuideState {
  verticalLevels: number[]
  hasFollowingAtSameLevel: boolean
  hasFollowingDirectSibling: boolean
}

interface IndentGuideItem {
  uid: UID
  parentUid?: UID
  indentLevel?: number
  isVisible?: boolean
}

/**
 * Precomputes indent-guide continuation and sibling state in one reverse pass.
 * Invisible items are skipped because they do not contribute visible guides.
 */
export function buildIndentGuideStates<T extends IndentGuideItem>(
  items: readonly T[],
): Map<UID, TreeItemIndentGuideState> {
  const states = new Map<UID, TreeItemIndentGuideState>()
  const reachableLevels = new Set<number>()
  const nextParentAtLevel = new Map<number, UID | undefined>()
  let deepestReachableLevel = 0

  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item.isVisible === false) continue

    const indentLevel = Math.max(0, item.indentLevel ?? 0)
    const verticalLevels = [...reachableLevels]
      .filter((level) => level < indentLevel)
      .sort((left, right) => left - right)
    states.set(item.uid, {
      verticalLevels,
      hasFollowingAtSameLevel: reachableLevels.has(indentLevel),
      hasFollowingDirectSibling:
        nextParentAtLevel.has(indentLevel) &&
        nextParentAtLevel.get(indentLevel) === item.parentUid,
    })

    for (let level = deepestReachableLevel; level > indentLevel; level--) {
      reachableLevels.delete(level)
      nextParentAtLevel.delete(level)
    }
    deepestReachableLevel = indentLevel
    reachableLevels.add(indentLevel)
    nextParentAtLevel.set(indentLevel, item.parentUid)
  }

  return states
}
