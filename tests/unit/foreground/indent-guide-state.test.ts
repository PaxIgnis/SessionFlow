import { describe, expect, it } from 'vitest'
import { buildIndentGuideStates } from '@/services/tree-utils'
import {
  makeForegroundTab,
  makeForegroundWindow,
} from '../../helpers/foreground-tree-fixtures'

describe('indent guide state indexing', () => {
  it('matches ancestor continuation and terminal sibling rules in one flat list', () => {
    const firstRoot = makeForegroundTab('first-root' as UID, {
      indentLevel: 1,
      isParent: true,
    })
    const firstChild = makeForegroundTab('first-child' as UID, {
      indentLevel: 2,
      parentUid: firstRoot.uid,
    })
    const secondRoot = makeForegroundTab('second-root' as UID, {
      indentLevel: 1,
      isParent: true,
    })
    const secondChild = makeForegroundTab('second-child' as UID, {
      indentLevel: 2,
      parentUid: secondRoot.uid,
    })
    const terminalRoot = makeForegroundTab('terminal-root' as UID, {
      indentLevel: 1,
    })

    const states = buildIndentGuideStates([
      firstRoot,
      firstChild,
      secondRoot,
      secondChild,
      terminalRoot,
    ])

    expect(states.get(firstRoot.uid)).toEqual({
      verticalLevels: [],
      hasFollowingAtSameLevel: true,
      hasFollowingDirectSibling: true,
    })
    expect(states.get(firstChild.uid)).toEqual({
      verticalLevels: [1],
      hasFollowingAtSameLevel: false,
      hasFollowingDirectSibling: false,
    })
    expect(states.get(secondChild.uid)).toEqual({
      verticalLevels: [1],
      hasFollowingAtSameLevel: false,
      hasFollowingDirectSibling: false,
    })
    expect(states.get(terminalRoot.uid)).toEqual({
      verticalLevels: [],
      hasFollowingAtSameLevel: false,
      hasFollowingDirectSibling: false,
    })
  })

  it('ignores hidden items and indexes 2,000 nested rows within a bounded pass', () => {
    const window = makeForegroundWindow(
      'scale-window' as UID,
      Array.from({ length: 2_000 }, (_, index) => {
        const depth = (index % 50) + 1
        return makeForegroundTab(`scale-tab-${index}` as UID, {
          indentLevel: depth,
          parentUid:
            depth === 1 ? undefined : (`scale-tab-${index - 1}` as UID),
          isVisible: index !== 1_500,
        })
      }),
    )

    const startedAt = performance.now()
    const states = buildIndentGuideStates(window.children)
    const elapsedMs = performance.now() - startedAt

    expect(elapsedMs).toBeLessThan(500)
    expect(states.size).toBe(1_999)
    expect(states.get('scale-tab-49' as UID)?.verticalLevels).toEqual([1])
    expect(states.get('scale-tab-1999' as UID)?.verticalLevels).toEqual([])
    expect(states.has('scale-tab-1500' as UID)).toBe(false)
  })
})
