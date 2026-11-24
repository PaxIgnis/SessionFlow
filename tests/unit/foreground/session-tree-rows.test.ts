import { describe, expect, it } from 'vitest'
import {
  createDescendantSummaryStabilizer,
  createIndentGuideStateStabilizer,
} from '@/services/session-tree-rows'

describe('session tree row state stabilizers', () => {
  it('reuses indent guide state objects whose values did not change', () => {
    const stabilize = createIndentGuideStateStabilizer()
    const first = stabilize(
      new Map([
        [
          'a' as UID,
          {
            verticalLevels: [1, 2],
            hasFollowingAtSameLevel: true,
            hasFollowingDirectSibling: false,
          },
        ],
        [
          'b' as UID,
          {
            verticalLevels: [1],
            hasFollowingAtSameLevel: false,
            hasFollowingDirectSibling: false,
          },
        ],
      ]),
    )

    const second = stabilize(
      new Map([
        [
          'a' as UID,
          {
            verticalLevels: [1, 2],
            hasFollowingAtSameLevel: true,
            hasFollowingDirectSibling: false,
          },
        ],
        [
          'b' as UID,
          {
            verticalLevels: [1, 3],
            hasFollowingAtSameLevel: false,
            hasFollowingDirectSibling: false,
          },
        ],
        [
          'c' as UID,
          {
            verticalLevels: [],
            hasFollowingAtSameLevel: false,
            hasFollowingDirectSibling: false,
          },
        ],
      ]),
    )

    expect(second.get('a' as UID)).toBe(first.get('a' as UID))
    expect(second.get('b' as UID)).not.toBe(first.get('b' as UID))
    expect(second.get('b' as UID)?.verticalLevels).toEqual([1, 3])
    expect(second.get('c' as UID)).toBeDefined()
  })

  it('compares against the previous result, not the first one', () => {
    const stabilize = createDescendantSummaryStabilizer()
    const summary = (childCount: number) => ({
      childCount,
      hasOpenDescendant: false,
      hasFocusedDescendant: false,
    })
    const first = stabilize(new Map([['a' as UID, summary(1)]]))
    const second = stabilize(new Map([['a' as UID, summary(2)]]))
    const third = stabilize(new Map([['a' as UID, summary(2)]]))

    expect(second.get('a' as UID)).not.toBe(first.get('a' as UID))
    expect(third.get('a' as UID)).toBe(second.get('a' as UID))
  })
})
