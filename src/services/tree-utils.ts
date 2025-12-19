import type { Tab } from '@/types/session-tree'

/**
 * Builds a map of parentUid to child tabs for quick lookup.
 * @param tabs Complete list of tabs from a window.
 */
export function buildChildrenMap(tabs: Tab[]) {
  const map = new Map<UID, Tab[]>()
  for (const tab of tabs) {
    const uid = (tab as Tab).parentUid as UID | undefined
    if (uid !== undefined) {
      if (!map.has(uid)) map.set(uid, [])
      map.get(uid)!.push(tab)
    }
  }
  return map
}
