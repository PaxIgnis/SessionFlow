import { expect } from 'vitest'
import { Tree } from '@/services/background-tree'
import {
  State,
  TreeItem,
  TreeItemType,
  Window,
  WindowChild,
} from '@/types/session-tree'

export function expectTreeInvariants(): void {
  const seenUids = new Set<UID>()
  const seenTabGroupUids = new Set<UID>()
  const expectedWindows = new Map<UID, Window>()
  const expectedTabs = new Set<UID>()
  const expectedNotes = new Set<UID>()
  const expectedSeparators = new Set<UID>()
  const topLevelByUid = new Map(Tree.Items.map((item) => [item.uid, item]))
  const validatedTopLevelChains = new Set<UID>()
  const topLevelVisibility = new Map<UID, boolean>()
  const topLevelParentUids = new Set(
    Tree.Items.flatMap((item) => (item.parentUid ? [item.parentUid] : [])),
  )
  const activeWindows = Tree.Items.filter(
    (item): item is Window =>
      item.type === TreeItemType.WINDOW && item.active === true,
  )

  expect(
    activeWindows.length,
    `multiple active windows: ${activeWindows.map((window) => window.uid).join(', ')}`,
  ).toBeLessThanOrEqual(1)

  for (const item of Tree.Items) {
    expect(seenUids.has(item.uid), `duplicate uid ${item.uid}`).toBe(false)
    seenUids.add(item.uid)
    const parent = item.parentUid
      ? topLevelByUid.get(item.parentUid)
      : undefined
    if (item.parentUid) {
      expect(
        parent,
        `top-level parent ${item.parentUid} for ${item.uid}`,
      ).toBeDefined()
      expect(parent?.type, `top-level parent type for ${item.uid}`).toBe(
        TreeItemType.NOTE,
      )
    }
    expectAcyclicParentChain(item, topLevelByUid, validatedTopLevelChains)
    expect(item.indentLevel, `top-level item ${item.uid} indent`).toBe(
      parent ? (parent.indentLevel ?? 0) + 1 : 0,
    )
    expect(
      item.isVisible !== false,
      `top-level visibility for ${item.uid}`,
    ).toBe(
      expectedVisibilityFromParents(
        item,
        topLevelByUid,
        topLevelVisibility,
        true,
      ),
    )

    if (item.type === TreeItemType.WINDOW) {
      expectedWindows.set(item.uid, item)
      expect(Tree.windowsByUid.get(item.uid)).toBe(item)
      expectWindowChildrenInvariants(
        item,
        seenUids,
        seenTabGroupUids,
        expectedTabs,
        expectedNotes,
        expectedSeparators,
      )
    } else if (item.type === TreeItemType.NOTE) {
      expectedNotes.add(item.uid)
      expect(
        item.windowUid,
        `top-level note ${item.uid} has windowUid`,
      ).toBeUndefined()
      expect(Tree.notesByUid.get(item.uid)).toBe(item)
    } else {
      expectedSeparators.add(item.uid)
      expect(
        item.windowUid,
        `top-level separator ${item.uid} has windowUid`,
      ).toBeUndefined()
      expect(Tree.separatorsByUid.get(item.uid)).toBe(item)
    }
  }

  for (const item of Tree.Items) {
    if (item.type === TreeItemType.NOTE) {
      expect(Boolean(item.isParent), `top-level isParent for ${item.uid}`).toBe(
        topLevelParentUids.has(item.uid),
      )
    }
  }

  expect(new Set(Tree.windowsByUid.keys())).toEqual(
    new Set(expectedWindows.keys()),
  )
  expect(new Set(Tree.tabsByUid.keys())).toEqual(expectedTabs)
  expect(new Set(Tree.notesByUid.keys())).toEqual(expectedNotes)
  expect(new Set(Tree.separatorsByUid.keys())).toEqual(expectedSeparators)
  expect(Tree.existingUidsSet).toEqual(seenUids)
}

function expectWindowChildrenInvariants(
  window: Window,
  seenUids: Set<UID>,
  seenTabGroupUids: Set<UID>,
  expectedTabs: Set<UID>,
  expectedNotes: Set<UID>,
  expectedSeparators: Set<UID>,
): void {
  const byUid = new Map<UID, WindowChild>()
  const validatedParentChains = new Set<UID>()
  const visibilityByUid = new Map<UID, boolean>()
  for (const child of window.children) {
    expect(seenUids.has(child.uid), `duplicate uid ${child.uid}`).toBe(false)
    seenUids.add(child.uid)
    byUid.set(child.uid, child)

    expect(child.windowUid, `child ${child.uid} windowUid`).toBe(window.uid)
    if (child.type === TreeItemType.TAB) {
      expectedTabs.add(child.uid)
      expect(Tree.tabsByUid.get(child.uid)).toBe(child)
      if (child.tabGroup && !seenTabGroupUids.has(child.tabGroup.uid)) {
        expect(
          seenUids.has(child.tabGroup.uid),
          `tab group uid collides with tree item ${child.tabGroup.uid}`,
        ).toBe(false)
        seenTabGroupUids.add(child.tabGroup.uid)
        seenUids.add(child.tabGroup.uid)
      }
    } else if (child.type === TreeItemType.NOTE) {
      expectedNotes.add(child.uid)
      expect(Tree.notesByUid.get(child.uid)).toBe(child)
    } else {
      expectedSeparators.add(child.uid)
      expect(Tree.separatorsByUid.get(child.uid)).toBe(child)
    }
  }

  for (const child of window.children) {
    expectAcyclicParentChain(child, byUid, validatedParentChains)
    const parent = child.parentUid ? byUid.get(child.parentUid) : window
    expect(parent, `parent ${child.parentUid} for ${child.uid}`).toBeDefined()
    if (!parent) continue
    expect(child.indentLevel, `indent for ${child.uid}`).toBe(
      (parent.indentLevel ?? 0) + 1,
    )
    expect(child.isVisible !== false, `visibility for ${child.uid}`).toBe(
      expectedVisibilityFromParents(
        child,
        byUid,
        visibilityByUid,
        window.isVisible !== false && !window.collapsed,
      ),
    )
  }

  for (const item of window.children) {
    expect(Boolean(item.isParent), `isParent for ${item.uid}`).toBe(
      hasChildren(item, window.children),
    )
  }

  const activeTabs = window.children.filter(
    (child): child is WindowChild & { type: TreeItemType.TAB } =>
      child.type === TreeItemType.TAB && child.active === true,
  )
  expect(
    activeTabs.length,
    `multiple active tabs in ${window.uid}: ${activeTabs.map((tab) => tab.uid).join(', ')}`,
  ).toBeLessThanOrEqual(1)

  if (window.activeTabId !== undefined) {
    const activeTab = window.children.find(
      (child) =>
        child.type === TreeItemType.TAB &&
        child.id === window.activeTabId &&
        child.state === State.OPEN,
    )
    expect(
      activeTab,
      `activeTabId ${window.activeTabId} does not identify an open child in ${window.uid}`,
    ).toBeDefined()
  }

  if (window.savedActiveTabUid !== undefined) {
    const savedActiveTab = window.children.find(
      (child) =>
        child.type === TreeItemType.TAB &&
        child.uid === window.savedActiveTabUid,
    )
    expect(
      savedActiveTab,
      `savedActiveTabUid ${window.savedActiveTabUid} does not identify a saved child in ${window.uid}`,
    ).toBeDefined()
    if (window.state === State.SAVED) {
      expect(
        savedActiveTab?.type === TreeItemType.TAB
          ? savedActiveTab.state
          : undefined,
        `savedActiveTabUid ${window.savedActiveTabUid} identifies an open child in saved window ${window.uid}`,
      ).not.toBe(State.OPEN)
    }
  }
}

function expectAcyclicParentChain(
  item: TreeItem,
  byUid: Map<UID, TreeItem>,
  validatedUids: Set<UID>,
): void {
  const visited = new Set<UID>([item.uid])
  const path: UID[] = [item.uid]
  let parentUid = item.parentUid

  while (parentUid && !validatedUids.has(parentUid)) {
    expect(
      visited.has(parentUid),
      `parent cycle detected for ${item.uid} through ${parentUid}`,
    ).toBe(false)
    visited.add(parentUid)
    path.push(parentUid)
    parentUid = byUid.get(parentUid)?.parentUid
  }
  path.forEach((uid) => validatedUids.add(uid))
}

function hasChildren(item: TreeItem, children: WindowChild[]): boolean {
  if (item.type === TreeItemType.WINDOW) return children.length > 0
  return children.some((child) => child.parentUid === item.uid)
}

function expectedVisibilityFromParents<T extends TreeItem>(
  item: T,
  byUid: Map<UID, T>,
  visibilityByUid: Map<UID, boolean>,
  rootVisibility: boolean,
): boolean {
  const path: T[] = []
  let current: T | undefined = item
  while (current && !visibilityByUid.has(current.uid)) {
    path.push(current)
    current = current.parentUid ? byUid.get(current.parentUid) : undefined
  }

  while (path.length > 0) {
    const currentItem = path.pop()!
    const parent = currentItem.parentUid
      ? byUid.get(currentItem.parentUid)
      : undefined
    const visible = parent
      ? (visibilityByUid.get(parent.uid) ?? rootVisibility) && !parent.collapsed
      : rootVisibility
    visibilityByUid.set(currentItem.uid, visible)
  }

  return visibilityByUid.get(item.uid) ?? false
}
