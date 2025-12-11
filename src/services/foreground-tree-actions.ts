import { SessionTree } from '@/services/foreground-tree'
import type { Tab } from '@/types/session-tree'

export function deselectAllItems(): void {
  SessionTree.reactiveWindowsList.value.forEach((window) => {
    window.tabs.forEach((tab) => {
      tab.selected = false
    })
    window.selected = false
  })
}

/**
 * Toggles the collapsed state of a window.
 * When collapsing, all tabs are hidden.
 * When expanding, root tabs are shown and child tab visibility respects their own collapsed states.
 */
export function toggleCollapseWindow(windowSerialId: number): void {
  const win = SessionTree.reactiveWindowsList.value.find(
    (w) => w.serialId === windowSerialId
  )
  if (!win) return

  win.collapsed = !win.collapsed

  // build parent -> children map for tabs in this window
  const childrenMap = buildChildrenMap(win.tabs)

  // root tabs are those without a parentId
  const roots = win.tabs.filter((t) => t.parentId === undefined)

  // if window is collapsed, hide all tabs; otherwise show roots and let recursion respect per-tab collapsed flags
  if (win.collapsed) {
    setVisibilityRecursively(roots, childrenMap, false)
  } else {
    setVisibilityRecursively(roots, childrenMap, true)
  }
}

/**
 * Toggles the collapsed state of a tab.
 * When collapsing, all child tabs are hidden.
 * When expanding, child tab visibility respects their own collapsed states and ancestor states.
 */
export function toggleCollapseTab(
  tabSerialId: number,
  windowSerialId: number
): void {
  console.log(
    `Toggling collapse for tab ${tabSerialId} in window ${windowSerialId}`
  )
  const window = SessionTree.reactiveWindowsList.value.find(
    (w) => w.serialId === windowSerialId
  )
  if (!window) {
    console.error(`Window with serialId ${windowSerialId} not found`)
    return
  }

  const tab = window.tabs.find((t) => t.serialId === tabSerialId)
  if (!tab) {
    console.error(
      `Tab with serialId ${tabSerialId} not found in window ${windowSerialId}`
    )
    return
  }

  tab.collapsed = !tab.collapsed
  const childrenMap = buildChildrenMap(window.tabs)
  const children = childrenMap.get(tab.serialId) || []

  if (tab.collapsed) {
    // hiding this tab's subtree
    setVisibilityRecursively(children, childrenMap, false)
  } else {
    // before showing children, ensure no ancestor is collapsed
    let ancestorCollapsed = false
    let currentParentId = tab.parentId
    while (currentParentId !== undefined) {
      const parent = window.tabs.find((t) => t.serialId === currentParentId)
      if (!parent) break
      if (parent.collapsed) {
        ancestorCollapsed = true
        break
      }
      currentParentId = parent.parentId
    }

    if (!ancestorCollapsed) {
      setVisibilityRecursively(children, childrenMap, true)
    }
  }
}

/**
 * Builds a map of parentId to child tabs for quick lookup.
 * @param tabs Complete list of tabs from a window.
 */
function buildChildrenMap(tabs: Tab[]) {
  const map = new Map<number, Tab[]>()
  for (const tab of tabs) {
    const pid = (tab as Tab).parentId as number | undefined
    if (pid !== undefined) {
      if (!map.has(pid)) map.set(pid, [])
      map.get(pid)!.push(tab)
    }
  }
  return map
}

/**
 * Sets visibility for a tab and its descendants based on collapsed states.
 */
function setVisibilityRecursively(
  nodes: Tab[],
  childrenMap: Map<number, Tab[]>,
  makeVisible: boolean
) {
  for (const node of nodes) {
    node.isVisible = makeVisible
    if (!makeVisible) {
      // hide entire subtree
      const children = childrenMap.get(node.serialId) || []
      if (children.length)
        setVisibilityRecursively(children, childrenMap, false)
    } else {
      // when showing, only show children if this node is not collapsed
      const children = childrenMap.get(node.serialId) || []
      if (children.length && node.collapsed !== true) {
        setVisibilityRecursively(children, childrenMap, true)
      } else if (children.length) {
        // if node is collapsed, ensure descendants remain hidden
        setVisibilityRecursively(children, childrenMap, false)
      }
    }
  }
}

/**
 * Increases indent level for the given tabs (and descendants), making them children of the nearest preceding sibling.
 */
export function tabIndentIncrease(tabs: Tab[]): void {
  const win = SessionTree.reactiveWindowsList.value.find(
    (w) => w.serialId === tabs[0].windowSerialId
  )
  if (!win) {
    console.error(
      `Window with serialId ${tabs[0].windowSerialId} not found for indent increase`
    )
    return
  }

  const childrenMap = buildChildrenMap(win.tabs)

  // remove any tabs from the selection that are descendants of other selected tabs
  const filteredTabs = removeDescendantTabs(tabs, childrenMap)

  for (const tab of filteredTabs) {
    if (tab.serialId === undefined) continue
    if (tab.serialId === 0) continue // skip root tabs
    if (tab.parentId && tab.parentId === tab.serialId - 1) continue // already indented under immediate previous tab
    // if tab has a sibling tab with same indent level above it, indent is possible
    if (tabHasSiblingsAbove(tab) === false) continue
    tab.indentLevel += 1

    const newParent = findParentTab(tab)

    if (newParent) {
      tab.parentId = newParent.serialId
      newParent.isParent = true
      // increase indent level for all descendants of this tab
      const children = childrenMap.get(tab.serialId) || []
      // match visibility of new parent for tab and all decendants
      tab.isVisible = newParent.collapsed ? false : true
      setVisibilityRecursively(children, childrenMap, tab.isVisible)
      if (children.length) increaseIndentRecursively(children, childrenMap)
    } else {
      console.error(
        `Failed to find new parent for tab ${tab.serialId} during indent increase`
      )
    }
  }
}

/**
 * Increases indent level recursively for child tabs.
 */
function increaseIndentRecursively(
  nodes: Tab[],
  childrenMap: Map<number, Tab[]>
) {
  for (const node of nodes) {
    node.indentLevel = (node.indentLevel ?? 1) + 1
    const children = childrenMap.get(node.serialId) || []
    if (children.length) increaseIndentRecursively(children, childrenMap)
  }
}

function collectDescendantIds(
  nodes: Tab[],
  childrenMap: Map<number, Tab[]>,
  set: Set<number>
) {
  for (const node of nodes) {
    if (node.serialId !== undefined) set.add(node.serialId)
    const children = childrenMap.get(node.serialId) || []
    if (children.length) collectDescendantIds(children, childrenMap, set)
  }
}

/**
 * Given a list of selected tabs and a children map for the full window,
 * return a new array containing only those tabs that are not descendants
 * of any other tab in the selected list. This prevents double-processing
 * when the input selection contains both a parent and its children.
 */
function removeDescendantTabs(
  selectedTabs: Tab[],
  childrenMap: Map<number, Tab[]>
) {
  const skip = new Set<number>()
  const result: Tab[] = []

  for (const t of selectedTabs) {
    if (t.serialId === undefined) continue
    if (skip.has(t.serialId)) continue
    result.push(t)
    // mark all descendants so they will be skipped
    const children = childrenMap.get(t.serialId) || []
    if (children.length) collectDescendantIds(children, childrenMap, skip)
  }

  return result
}

/**
 * Decreases indent level recursively for child tabs.
 */
function decreaseIndentRecursively(
  nodes: Tab[],
  childrenMap: Map<number, Tab[]>
) {
  for (const node of nodes) {
    node.indentLevel = Math.max((node.indentLevel ?? 1) - 1, 1)
    const children = childrenMap.get(node.serialId) || []
    if (children.length) decreaseIndentRecursively(children, childrenMap)
  }
}

/**
 * Decreases indent level for the given tabs (and descendants), converting previous siblings below tab into children.
 */
export function tabIndentDecrease(tabs: Tab[]): void {
  const win = SessionTree.reactiveWindowsList.value.find(
    (w) => w.serialId === tabs[0].windowSerialId
  )
  if (!win) {
    console.error(
      `Window with serialId ${tabs[0].windowSerialId} not found for indent increase`
    )
    return
  }

  const childrenMap = buildChildrenMap(win.tabs)

  // remove any tabs from the selection that are descendants of other selected tabs
  const filteredTabs = removeDescendantTabs(tabs, childrenMap)

  for (const tab of filteredTabs) {
    if (tab.serialId === undefined) continue
    if (tab.serialId === 0) continue // skip root tabs
    if (tab.indentLevel <= 1) continue // already at root level
    tab.indentLevel -= 1
    const oldParent = win.tabs.find((t) => t.serialId === tab.parentId)
    // if this was the only child or first child, clear isParent flag on old parent
    if (
      childrenMap.get(tab.parentId!)?.length === 1 ||
      tab.parentId === tab.serialId - 1
    ) {
      oldParent!.isParent = false
    }
    // siblings directly below the tab now become its children
    const siblings = childrenMap.get(tab.parentId!) || []
    const lowerSiblings = siblings.filter((s) => s.serialId > tab.serialId)
    if (lowerSiblings.length > 0) {
      tab.isParent = true // now a parent
      for (const child of lowerSiblings) child.parentId = tab.serialId
    }
    if (tab.indentLevel === 1) {
      tab.parentId = undefined
    } else {
      const newParent = findParentTab(tab)
      if (newParent) {
        tab.parentId = newParent.serialId
        newParent.isParent = true
      } else {
        console.error(
          `Failed to find new parent for tab ${tab.serialId} during indent decrease`
        )
      }
    }
    // decrease indent level for all descendants of this tab
    const children = childrenMap.get(tab.serialId) || []
    if (children.length) decreaseIndentRecursively(children, childrenMap)
  }
}

/**
 * Finds the parent tab for a given tab based on its indent level.
 */
function findParentTab(tab: Tab): Tab | undefined {
  const win = SessionTree.reactiveWindowsList.value.find(
    (w) => w.serialId === tab.windowSerialId
  )
  if (!win) return undefined

  // Find the index of the current tab in the window's tabs array and scan backwards
  const currentIndex = win.tabs.findIndex((t) => t.serialId === tab.serialId)
  if (currentIndex > 0) {
    const targetIndent = (tab.indentLevel ?? 1) - 1
    for (let i = currentIndex - 1; i >= 0; i--) {
      const candidate = win.tabs[i]
      if ((candidate.indentLevel ?? 1) === targetIndent) {
        return candidate
      }
    }
  }
  return undefined
}

/**
 * Checks if the given tab has siblings above it with the same indent level.
 */
function tabHasSiblingsAbove(tab: Tab): boolean {
  const win = SessionTree.reactiveWindowsList.value.find(
    (w) => w.serialId === tab.windowSerialId
  )
  if (!win) return false

  // Find the index of the current tab in the window's tabs array and scan backwards
  const currentIndex = win.tabs.findIndex((t) => t.serialId === tab.serialId)
  if (currentIndex > 0) {
    const targetIndent = tab.indentLevel ?? 1
    for (let i = currentIndex - 1; i >= 0; i--) {
      const candidate = win.tabs[i]
      if ((candidate.indentLevel ?? 1) === targetIndent) {
        return true
      }
    }
  }

  return false
}
