import { expect } from 'vitest'
import { Tree } from '@/services/background-tree'
import {
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
    expect(item.indentLevel, `top-level item ${item.uid} indent`).toBe(
      parent ? (parent.indentLevel ?? 0) + 1 : 0,
    )
    expect(
      item.isVisible !== false,
      `top-level visibility for ${item.uid}`,
    ).toBe(expectedTopLevelVisibility(item, topLevelByUid))

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
        Tree.Items.some((child) => child.parentUid === item.uid),
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
    const parent = child.parentUid ? byUid.get(child.parentUid) : window
    expect(parent, `parent ${child.parentUid} for ${child.uid}`).toBeDefined()
    if (!parent) continue
    expect(child.indentLevel, `indent for ${child.uid}`).toBe(
      (parent.indentLevel ?? 0) + 1,
    )
    expect(child.isVisible !== false, `visibility for ${child.uid}`).toBe(
      expectedVisibility(child, window, byUid),
    )
  }

  for (const item of window.children) {
    expect(Boolean(item.isParent), `isParent for ${item.uid}`).toBe(
      hasChildren(item, window.children),
    )
  }
}

function hasChildren(item: TreeItem, children: WindowChild[]): boolean {
  if (item.type === TreeItemType.WINDOW) return children.length > 0
  return children.some((child) => child.parentUid === item.uid)
}

function expectedVisibility(
  item: WindowChild,
  window: Window,
  byUid: Map<UID, WindowChild>,
): boolean {
  let parentUid = item.parentUid
  let visible = window.isVisible !== false && !window.collapsed

  while (parentUid) {
    const parent = byUid.get(parentUid)
    if (!parent) return false
    visible = visible && parent.isVisible !== false && !parent.collapsed
    parentUid = parent.parentUid
  }

  return visible
}

function expectedTopLevelVisibility(
  item: TreeItem,
  byUid: Map<UID, TreeItem>,
): boolean {
  let parentUid = item.parentUid
  let visible = true

  while (parentUid) {
    const parent = byUid.get(parentUid)
    if (!parent) return false
    visible = visible && parent.isVisible !== false && !parent.collapsed
    parentUid = parent.parentUid
  }

  return visible
}
