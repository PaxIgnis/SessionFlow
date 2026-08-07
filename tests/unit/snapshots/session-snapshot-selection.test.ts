import { describe, expect, it } from 'vitest'
import {
  cycleSnapshotSelection,
  flattenSnapshotItems,
  snapshotDescendantItems,
  snapshotSelectionState,
} from '@/services/session-snapshot-selection'
import { State, TreeItemType } from '@/types/session-tree'
import type { SessionSnapshotPayload } from '@/types/session-snapshots'

const payload: SessionSnapshotPayload = {
  schemaVersion: 1,
  items: [
    {
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      incognito: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [
        {
          type: TreeItemType.TAB,
          uid: 'tab-parent' as UID,
          state: State.OPEN,
          title: 'Parent',
          url: 'https://example.test/parent',
          windowUid: 'window-1' as UID,
          indentLevel: 1,
          pinned: false,
          collapsed: true,
          isParent: true,
        },
        {
          type: TreeItemType.TAB,
          uid: 'tab-child' as UID,
          state: State.SAVED,
          title: 'Child',
          url: 'https://example.test/child',
          windowUid: 'window-1' as UID,
          indentLevel: 2,
          parentUid: 'tab-parent' as UID,
          pinned: false,
          isParent: true,
        },
        {
          type: TreeItemType.NOTE,
          uid: 'note-grandchild' as UID,
          text: 'Grandchild',
          windowUid: 'window-1' as UID,
          indentLevel: 3,
          parentUid: 'tab-child' as UID,
        },
        {
          type: TreeItemType.TAB,
          uid: 'tab-leaf' as UID,
          state: State.SAVED,
          title: 'Leaf',
          url: 'https://example.test/leaf',
          windowUid: 'window-1' as UID,
          indentLevel: 1,
          pinned: false,
        },
      ],
    },
    {
      type: TreeItemType.NOTE,
      uid: 'root-note' as UID,
      text: 'Root note',
      collapsed: true,
      indentLevel: 0,
      isParent: true,
    },
    {
      type: TreeItemType.SEPARATOR,
      uid: 'root-note-child' as UID,
      indentLevel: 1,
      parentUid: 'root-note' as UID,
    },
  ],
}

describe('snapshot tree selection', () => {
  it('cycles a window through complete subtree and unselected states', () => {
    let selected = cycleSnapshotSelection(payload, new Set(), 'window-1' as UID)
    expect([...selected]).toEqual([
      'tab-parent',
      'tab-child',
      'note-grandchild',
      'tab-leaf',
    ])
    expect(
      snapshotSelectionState(payload, selected, 'window-1' as UID),
    ).toEqual({
      checked: true,
      indeterminate: false,
    })

    selected = cycleSnapshotSelection(payload, selected, 'window-1' as UID)
    expect(selected.size).toBe(0)
  })

  it('does not select an empty window', () => {
    const emptyWindowPayload: SessionSnapshotPayload = {
      schemaVersion: 1,
      items: [
        {
          type: TreeItemType.WINDOW,
          uid: 'empty-window' as UID,
          incognito: false,
          state: State.SAVED,
          indentLevel: 0,
          children: [],
        },
      ],
    }

    const selected = cycleSnapshotSelection(
      emptyWindowPayload,
      new Set(),
      'empty-window' as UID,
    )

    expect(selected).toEqual(new Set())
    expect(
      snapshotSelectionState(
        emptyWindowPayload,
        selected,
        'empty-window' as UID,
      ),
    ).toEqual({ checked: false, indeterminate: false })
  })

  it('includes every hidden descendant when cycling a collapsed tab to full', () => {
    let selected = cycleSnapshotSelection(
      payload,
      new Set(),
      'tab-parent' as UID,
    )
    expect([...selected]).toEqual(['tab-parent'])
    expect(
      snapshotSelectionState(payload, selected, 'tab-parent' as UID),
    ).toEqual({
      checked: false,
      indeterminate: true,
    })

    selected = cycleSnapshotSelection(payload, selected, 'tab-parent' as UID)
    expect([...selected]).toEqual([
      'tab-parent',
      'tab-child',
      'note-grandchild',
    ])
    expect(
      snapshotSelectionState(payload, selected, 'tab-parent' as UID),
    ).toEqual({
      checked: true,
      indeterminate: false,
    })

    selected = cycleSnapshotSelection(payload, selected, 'tab-parent' as UID)
    expect(selected.size).toBe(0)
  })

  it('does not visually select an unselected non-window ancestor', () => {
    const childOnly = new Set(['root-note-child' as UID])
    expect(
      snapshotSelectionState(payload, childOnly, 'root-note' as UID),
    ).toEqual({
      checked: false,
      indeterminate: false,
    })
  })

  it('selects no intermediate ancestors but reflects the containing window', () => {
    const selected = cycleSnapshotSelection(
      payload,
      new Set(),
      'note-grandchild' as UID,
    )

    expect([...selected]).toEqual(['note-grandchild'])
    expect(
      snapshotSelectionState(payload, selected, 'tab-child' as UID),
    ).toEqual({ checked: false, indeterminate: false })
    expect(
      snapshotSelectionState(payload, selected, 'tab-parent' as UID),
    ).toEqual({ checked: false, indeterminate: false })
    expect(
      snapshotSelectionState(payload, selected, 'window-1' as UID),
    ).toEqual({ checked: false, indeterminate: true })
  })

  it('promotes an explicitly selected ancestor to full when its final descendant is selected', () => {
    let selected = cycleSnapshotSelection(
      payload,
      new Set(),
      'tab-parent' as UID,
    )
    selected = cycleSnapshotSelection(payload, selected, 'tab-child' as UID)

    expect(
      snapshotSelectionState(payload, selected, 'tab-parent' as UID),
    ).toEqual({ checked: false, indeterminate: true })

    selected = cycleSnapshotSelection(
      payload,
      selected,
      'note-grandchild' as UID,
    )
    expect(
      snapshotSelectionState(payload, selected, 'tab-parent' as UID),
    ).toEqual({ checked: true, indeterminate: false })
  })

  it('returns the containing window to unchecked after its final child is deselected', () => {
    let selected = cycleSnapshotSelection(payload, new Set(), 'tab-leaf' as UID)
    expect(
      snapshotSelectionState(payload, selected, 'window-1' as UID),
    ).toEqual({ checked: false, indeterminate: true })

    selected = cycleSnapshotSelection(payload, selected, 'tab-leaf' as UID)
    expect(
      snapshotSelectionState(payload, selected, 'window-1' as UID),
    ).toEqual({ checked: false, indeterminate: false })
  })

  it('cycles a collapsed note subtree through item-only, full, and none', () => {
    let selected = cycleSnapshotSelection(
      payload,
      new Set(),
      'root-note' as UID,
    )
    expect([...selected]).toEqual(['root-note'])
    selected = cycleSnapshotSelection(payload, selected, 'root-note' as UID)
    expect([...selected]).toEqual(['root-note', 'root-note-child'])
    selected = cycleSnapshotSelection(payload, selected, 'root-note' as UID)
    expect(selected.size).toBe(0)
  })

  it('keeps leaves two-state and never mutates the input selection or payload', () => {
    const originalPayload = structuredClone(payload)
    const originalSelection = new Set<UID>()

    const selected = cycleSnapshotSelection(
      payload,
      originalSelection,
      'tab-leaf' as UID,
    )
    const deselected = cycleSnapshotSelection(
      payload,
      selected,
      'tab-leaf' as UID,
    )

    expect([...selected]).toEqual(['tab-leaf'])
    expect(
      snapshotSelectionState(payload, selected, 'tab-leaf' as UID),
    ).toEqual({
      checked: true,
      indeterminate: false,
    })
    expect(deselected.size).toBe(0)
    expect(originalSelection.size).toBe(0)
    expect(payload).toEqual(originalPayload)
  })

  it('flattens only visible rows under locally expanded windows and parents', () => {
    expect(
      flattenSnapshotItems(payload, new Set()).map((row) => row.item.uid),
    ).toEqual([
      'window-1',
      'tab-parent',
      'tab-child',
      'note-grandchild',
      'tab-leaf',
      'root-note',
      'root-note-child',
    ])
    expect(
      flattenSnapshotItems(
        payload,
        new Set(['window-1' as UID, 'root-note' as UID]),
      ).map((row) => row.item.uid),
    ).toEqual(['window-1', 'root-note'])
  })

  it('includes children of descendant windows in a note descendant list', () => {
    const nestedWindowPayload: SessionSnapshotPayload = {
      schemaVersion: 1,
      items: [
        {
          type: TreeItemType.NOTE,
          uid: 'parent-note' as UID,
          text: 'Parent note',
          indentLevel: 0,
          isParent: true,
        },
        {
          type: TreeItemType.WINDOW,
          uid: 'nested-window' as UID,
          incognito: false,
          state: State.SAVED,
          indentLevel: 1,
          parentUid: 'parent-note' as UID,
          children: [
            {
              type: TreeItemType.TAB,
              uid: 'nested-tab' as UID,
              state: State.SAVED,
              title: 'Nested tab',
              url: 'https://example.test/nested',
              windowUid: 'nested-window' as UID,
              indentLevel: 1,
              pinned: false,
            },
          ],
        },
      ],
    }

    expect(
      snapshotDescendantItems(
        nestedWindowPayload,
        nestedWindowPayload.items[0],
      ).map((item) => item.uid),
    ).toEqual(['nested-window', 'nested-tab'])
  })
})
