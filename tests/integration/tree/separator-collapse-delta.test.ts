import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionTree } from '@/services/foreground-tree'
import { Tree } from '@/services/background-tree'
import { SessionTreeDelta } from '@/types/runtime-port-service'
import { State } from '@/types/session-tree'
import {
  createSeparator,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { resetForegroundTree } from '../../helpers/foreground-tree-fixtures'

const emittedDeltas = vi.hoisted(() => [] as SessionTreeDelta[])

vi.mock('@/services/runtime-port-service', () => ({
  emitTreeDelta: (delta: SessionTreeDelta) => {
    emittedDeltas.push(structuredClone(delta))
  },
}))

describe('separator collapse delta visibility', () => {
  beforeEach(() => {
    emittedDeltas.length = 0
    resetTree()
    resetForegroundTree()
  })

  it.each([
    { label: 'saved', state: State.SAVED },
    { label: 'open', state: State.OPEN },
  ])(
    'hides a separator child in the foreground when collapsing a $label tab',
    ({ state }) => {
      const parent = createTab('tab-parent' as UID, {
        isParent: true,
        state,
      })
      const separator = createSeparator('separator-child' as UID, {
        parentUid: parent.uid,
        indentLevel: 2,
        isVisible: true,
      })
      createWindow('window-1' as UID, [parent, separator])
      Tree.recomputeSessionTree(false)
      SessionTree.replaceSessionTree(structuredClone(Tree.Items))

      Tree.toggleCollapseTab(parent.uid, true)
      for (const delta of emittedDeltas) {
        SessionTree.applyDelta(delta)
      }

      expect(Tree.separatorsByUid.get(separator.uid)?.isVisible).toBe(false)
      expect(SessionTree.separatorsByUid.get(separator.uid)?.isVisible).toBe(
        false,
      )
    },
  )
})
