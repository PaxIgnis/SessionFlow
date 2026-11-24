import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Tree } from '@/services/background-tree'
import {
  buildDescendantSummaries,
  type TreeItemDescendantSummary,
} from '@/services/session-tree-rows'
import { countTreeItemDescendants } from '@/services/tree-utils'
import { State, TreeItem, TreeItemType } from '@/types/session-tree'
import { resetTree } from '../helpers/tree-fixtures'
import { expectTreeInvariants } from '../helpers/tree-invariants'
import {
  materializeTree,
  richTreeSpecArbitrary,
} from './background-tree-generators'

const PROPERTY_RUNS = 100

/*
 * Reference: what a TreeItem row computed for itself before the session tree
 * precomputed it, by locating itself in its containing list and scanning the
 * contiguous block of deeper-indented items that follows.
 */
function referenceSummary(
  item: TreeItem,
  containingList: TreeItem[],
): TreeItemDescendantSummary {
  const index = containingList.findIndex((child) => child.uid === item.uid)
  const indent = item.indentLevel ?? 0
  let hasOpenDescendant = false
  let hasFocusedDescendant = false
  for (let i = index + 1; i < containingList.length; i++) {
    const descendant = containingList[i]
    if ((descendant.indentLevel ?? 0) <= indent) break
    if (descendant.type !== TreeItemType.TAB) continue
    if (
      descendant.state === State.OPEN ||
      descendant.state === State.DISCARDED
    ) {
      hasOpenDescendant = true
    }
    if (
      descendant.active === true &&
      Tree.windowsByUid.get(descendant.windowUid)?.active === true
    ) {
      hasFocusedDescendant = true
    }
  }
  return {
    childCount: countTreeItemDescendants(item, containingList),
    hasOpenDescendant,
    hasFocusedDescendant,
  }
}

describe('session tree row summaries properties', () => {
  it('match each row scanning its own containing list', () => {
    fc.assert(
      fc.property(richTreeSpecArbitrary, (spec) => {
        resetTree()
        materializeTree(spec)
        expectTreeInvariants()

        const topLevel = Tree.Items as TreeItem[]
        const summaries = buildDescendantSummaries(topLevel, Tree.windowsByUid)

        const expected = new Map<UID, TreeItemDescendantSummary>()
        for (const item of topLevel) {
          if (item.type === TreeItemType.WINDOW) {
            for (const child of item.children as TreeItem[]) {
              expected.set(
                child.uid,
                referenceSummary(child, item.children as TreeItem[]),
              )
            }
          } else {
            expected.set(item.uid, referenceSummary(item, topLevel))
          }
        }

        expect(summaries).toEqual(expected)
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})
