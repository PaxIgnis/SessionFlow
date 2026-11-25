import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Tree } from '@/services/background-tree'
import { collectDescendantUids } from '@/services/drag-and-drop-actions'
import { SessionTree } from '@/services/foreground-tree'
import { TreeItem, TreeItemType } from '@/types/session-tree'
import { resetTree } from '../helpers/tree-fixtures'
import {
  materializeTree,
  richTreeSpecArbitrary,
} from './background-tree-generators'

const PROPERTY_RUNS = 100

function logicalItems(): TreeItem[] {
  return (SessionTree.reactiveItems.value as TreeItem[]).flatMap((item) =>
    item.type === TreeItemType.WINDOW ? [item, ...item.children] : [item],
  )
}

function containingList(uid: UID): TreeItem[] {
  const top = SessionTree.reactiveItems.value as TreeItem[]
  if (top.some((item) => item.uid === uid)) return top
  for (const item of top) {
    if (
      item.type === TreeItemType.WINDOW &&
      item.children.some((child) => child.uid === uid)
    ) {
      return item.children as TreeItem[]
    }
  }
  return []
}

/*
 * Reference: the per-item lookup the drag code used before, which located each
 * dragged item in the tree and walked its deeper-indented followers.
 */
function referenceDescendants(
  item: TreeItem,
  includeNestedWindowChildren: boolean,
): Set<UID> {
  const result = new Set<UID>()
  if (includeNestedWindowChildren && item.type === TreeItemType.WINDOW) {
    item.children.forEach((child) => result.add(child.uid))
  }
  const list = containingList(item.uid)
  const index = list.findIndex((candidate) => candidate.uid === item.uid)
  if (index === -1) return result
  const indent = item.indentLevel ?? 0
  for (let i = index + 1; i < list.length; i++) {
    const candidate = list[i]
    if ((candidate.indentLevel ?? 0) <= indent) break
    result.add(candidate.uid)
    if (includeNestedWindowChildren && candidate.type === TreeItemType.WINDOW) {
      candidate.children.forEach((child) => result.add(child.uid))
    }
  }
  return result
}

function referenceUnion(
  roots: TreeItem[],
  includeNestedWindowChildren: boolean,
): Set<UID> {
  const union = new Set<UID>()
  for (const root of roots) {
    referenceDescendants(root, includeNestedWindowChildren).forEach((uid) =>
      union.add(uid),
    )
  }
  return union
}

const scenarioArbitrary = fc.record({
  spec: richTreeSpecArbitrary,
  picks: fc.array(fc.boolean(), { maxLength: 60 }),
})

describe('drag descendant collection properties', () => {
  it('matches looking up every dragged item separately', () => {
    fc.assert(
      fc.property(scenarioArbitrary, ({ spec, picks }) => {
        resetTree()
        materializeTree(spec)
        SessionTree.replaceSessionTree(structuredClone(Tree.Items))

        const items = logicalItems()
        const roots = items.filter((_, index) => picks[index] === true)
        const noteRoots = roots.filter(
          (item) => item.type === TreeItemType.NOTE,
        )

        expect(collectDescendantUids(roots, true)).toEqual(
          referenceUnion(roots, true),
        )
        expect(collectDescendantUids(noteRoots, false)).toEqual(
          referenceUnion(noteRoots, false),
        )
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})
