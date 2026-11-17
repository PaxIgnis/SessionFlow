import type { SnapshotTab } from '@/types/session-snapshots'

export type TabTreeWarning = 'invalid-parent-links' | 'tab-order'

// Rebuilds a strict snapshot hierarchy from saved tab order and parent links.
// `parents` maps a tab's index in `tabs` to its parent's index. Missing,
// self-referencing, and cyclic links are dropped, and descendants are moved
// directly below their parent so every branch is contiguous.
export function nestSnapshotTabs(
  tabs: SnapshotTab[],
  parents: Map<number, number>,
  warn: (code: TabTreeWarning) => void,
): SnapshotTab[] {
  const links = new Map<number, number>()
  for (const [index, parent] of parents) {
    if (
      index === parent ||
      !Number.isInteger(parent) ||
      parent < 0 ||
      parent >= tabs.length
    )
      warn('invalid-parent-links')
    else links.set(index, parent)
  }
  const visited = new Set<number>()
  for (let index = 0; index < tabs.length; index++) {
    const path = new Set<number>()
    let current: number | undefined = index
    while (current !== undefined && !visited.has(current)) {
      path.add(current)
      const parent: number | undefined = links.get(current)
      if (parent !== undefined && path.has(parent)) {
        links.delete(current)
        warn('invalid-parent-links')
        break
      }
      current = parent
    }
    for (const ancestor of path) visited.add(ancestor)
  }

  const children = new Map<number | undefined, number[]>()
  for (let index = 0; index < tabs.length; index++) {
    const parent = links.get(index)
    const siblings = children.get(parent) ?? []
    siblings.push(index)
    children.set(parent, siblings)
  }
  const ordered: SnapshotTab[] = []
  const pending = [...(children.get(undefined) ?? [])].reverse()
  while (pending.length) {
    const index = pending.pop()!
    const tab = tabs[index]
    const parentIndex = links.get(index)
    if (parentIndex !== undefined) {
      const parent = tabs[parentIndex]
      tab.parentUid = parent.uid
      tab.indentLevel = parent.indentLevel + 1
      parent.isParent = true
    }
    ordered.push(tab)
    const descendants = children.get(index) ?? []
    for (let i = descendants.length - 1; i >= 0; i--)
      pending.push(descendants[i])
  }
  if (ordered.some((tab, index) => tab !== tabs[index])) warn('tab-order')
  return ordered
}
