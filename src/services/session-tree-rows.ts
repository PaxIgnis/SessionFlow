import {
  buildIndentGuideStates,
  countTreeItemDescendants,
  type TreeItemIndentGuideState,
} from '@/services/tree-utils'
import {
  State,
  Tab,
  TreeItem,
  TreeItemType,
  Window,
} from '@/types/session-tree'

/**
 * What a tab, note, or separator row shows about the items nested under it in
 * its flat list: the descendant count badge, whether any descendant tab is
 * open, and whether a descendant is the focused tab.
 */
export interface TreeItemDescendantSummary {
  childCount: number
  hasOpenDescendant: boolean
  hasFocusedDescendant: boolean
}

/**
 * Flattens the tree into the rows the session tree renders, skipping hidden
 * items and the children of collapsed windows.
 *
 * @param {TreeItem[]} topLevelItems - Top-level session tree items.
 * @returns {TreeItem[]} Visible rows in display order.
 */
export function collectVisibleTreeItems(topLevelItems: TreeItem[]): TreeItem[] {
  const items: TreeItem[] = []
  const appendVisibleList = (list: TreeItem[]) => {
    list.forEach((item) => {
      if (item.parentUid === undefined || item.isVisible !== false) {
        appendVisible(item)
      }
    })
  }
  const appendVisible = (item: TreeItem) => {
    if (item.isVisible !== false) {
      items.push(item)
      if (!item.collapsed && item.type === TreeItemType.WINDOW) {
        appendVisibleList(item.children)
      }
    }
  }
  appendVisibleList(topLevelItems)
  return items
}

function sameIndentGuideState(
  left: TreeItemIndentGuideState,
  right: TreeItemIndentGuideState,
): boolean {
  return (
    left.hasFollowingAtSameLevel === right.hasFollowingAtSameLevel &&
    left.hasFollowingDirectSibling === right.hasFollowingDirectSibling &&
    left.verticalLevels.length === right.verticalLevels.length &&
    left.verticalLevels.every(
      (level, index) => level === right.verticalLevels[index],
    )
  )
}

function sameDescendantSummary(
  left: TreeItemDescendantSummary,
  right: TreeItemDescendantSummary,
): boolean {
  return (
    left.childCount === right.childCount &&
    left.hasOpenDescendant === right.hasOpenDescendant &&
    left.hasFocusedDescendant === right.hasFocusedDescendant
  )
}

/**
 * Creates a stabilizer that hands back the previous value object for every key
 * whose value did not change. Rows receive these values as props, and Vue skips
 * re-rendering a child whose props are identical, so reusing the objects keeps
 * one edit from re-rendering every row in the tree.
 *
 * @param equals - Value equality used to decide whether the prior object can be reused.
 * @returns Function that replaces unchanged entries of `next` with the previously returned objects.
 */
function createMapStabilizer<T>(
  equals: (left: T, right: T) => boolean,
): (next: Map<UID, T>) => Map<UID, T> {
  let previous = new Map<UID, T>()
  return (next) => {
    for (const [uid, value] of next) {
      const prior = previous.get(uid)
      if (prior && equals(prior, value)) next.set(uid, prior)
    }
    previous = next
    return next
  }
}

/**
 * Creates a stabilizer for indent-guide state maps (see createMapStabilizer).
 */
export function createIndentGuideStateStabilizer(): (
  next: Map<UID, TreeItemIndentGuideState>,
) => Map<UID, TreeItemIndentGuideState> {
  return createMapStabilizer(sameIndentGuideState)
}

/**
 * Creates a stabilizer for descendant summary maps (see createMapStabilizer).
 */
export function createDescendantSummaryStabilizer(): (
  next: Map<UID, TreeItemDescendantSummary>,
) => Map<UID, TreeItemDescendantSummary> {
  return createMapStabilizer(sameDescendantSummary)
}

/**
 * Computes indent-guide state for every row: top-level items first, then each
 * window's children with the window's own continuation lines merged in.
 *
 * @param {TreeItem[]} topLevelItems - Top-level session tree items.
 * @returns {Map<UID, TreeItemIndentGuideState>} Guide state keyed by item uid.
 */
export function buildSessionIndentGuideStates(
  topLevelItems: TreeItem[],
): Map<UID, TreeItemIndentGuideState> {
  const topLevelStates = buildIndentGuideStates(topLevelItems)
  const states = new Map<UID, TreeItemIndentGuideState>(topLevelStates)

  for (const item of topLevelItems) {
    if (item.type !== TreeItemType.WINDOW) continue
    const windowIndent = item.indentLevel ?? 0
    const windowState = topLevelStates.get(item.uid)
    const childStates = buildIndentGuideStates(item.children)
    for (const [uid, childState] of childStates) {
      states.set(uid, {
        verticalLevels: [
          ...(windowState?.verticalLevels.filter(
            (level) => level <= windowIndent,
          ) ?? []),
          ...(windowState?.hasFollowingAtSameLevel ? [windowIndent] : []),
          ...childState.verticalLevels.filter((level) => level > windowIndent),
        ],
        hasFollowingAtSameLevel: childState.hasFollowingAtSameLevel,
        hasFollowingDirectSibling: childState.hasFollowingDirectSibling,
      })
    }
  }

  return states
}

interface PendingSummary {
  item: TreeItem
  indentLevel: number
  summary: TreeItemDescendantSummary
}

function isOpenTab(item: TreeItem): boolean {
  return (
    item.type === TreeItemType.TAB &&
    (item.state === State.OPEN || item.state === State.DISCARDED)
  )
}

function isFocusedTab(
  item: TreeItem,
  windowsByUid: ReadonlyMap<UID, Window>,
): boolean {
  return (
    item.type === TreeItemType.TAB &&
    item.active === true &&
    windowsByUid.get((item as Tab).windowUid)?.active === true
  )
}

/**
 * Summarizes the flat-list descendants of every non-window item in one pass
 * per list, matching countTreeItemDescendants and the row's own descendant
 * scans.
 *
 * @param {TreeItem[]} topLevelItems - Top-level session tree items.
 * @param {ReadonlyMap<UID, Window>} windowsByUid - Window lookup for focused-tab checks.
 * @returns {Map<UID, TreeItemDescendantSummary>} Summaries keyed by uid; windows are omitted.
 */
export function buildDescendantSummaries(
  topLevelItems: TreeItem[],
  windowsByUid: ReadonlyMap<UID, Window>,
): Map<UID, TreeItemDescendantSummary> {
  const summaries = new Map<UID, TreeItemDescendantSummary>()
  summarizeList(topLevelItems, windowsByUid, summaries)
  for (const item of topLevelItems) {
    if (item.type === TreeItemType.WINDOW) {
      summarizeList(item.children as TreeItem[], windowsByUid, summaries)
    }
  }
  return summaries
}

function summarizeList(
  items: TreeItem[],
  windowsByUid: ReadonlyMap<UID, Window>,
  summaries: Map<UID, TreeItemDescendantSummary>,
): void {
  // Strictly increasing indents: each entry is the nearest ancestor of the next.
  const stack: PendingSummary[] = []

  const close = (entry: PendingSummary) => {
    if (entry.item.type !== TreeItemType.WINDOW) {
      summaries.set(entry.item.uid, entry.summary)
    }
    const parent = stack.at(-1)
    if (!parent) return
    parent.summary.childCount += 1 + entry.summary.childCount
    parent.summary.hasOpenDescendant ||=
      entry.summary.hasOpenDescendant || isOpenTab(entry.item)
    parent.summary.hasFocusedDescendant ||=
      entry.summary.hasFocusedDescendant ||
      isFocusedTab(entry.item, windowsByUid)
  }

  for (const item of items) {
    const indentLevel = item.indentLevel ?? 0
    while (
      stack.length > 0 &&
      stack[stack.length - 1].indentLevel >= indentLevel
    ) {
      close(stack.pop()!)
    }
    stack.push({
      item,
      indentLevel,
      summary: {
        // A nested window counts its own contents; its tabs are not scanned
        // for open/focused state, matching the row's flat-list scan.
        childCount:
          item.type === TreeItemType.WINDOW
            ? countTreeItemDescendants(item)
            : 0,
        hasOpenDescendant: false,
        hasFocusedDescendant: false,
      },
    })
  }
  while (stack.length > 0) close(stack.pop()!)
}
