import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Tree } from '@/services/background-tree'
import {
  State,
  Tab,
  TreeItem,
  TreeItemType,
  WindowChild,
} from '@/types/session-tree'
import {
  allNotes,
  allTabs,
  allWindowChildren,
  materializeTree,
  materializeWindows,
  richTreeSpecArbitrary,
  smallWindowSpecsArbitrary,
} from './background-tree-generators'
import {
  createNote,
  createTab,
  createWindow,
  resetTree,
} from '../helpers/tree-fixtures'
import { expectTreeInvariants } from '../helpers/tree-invariants'

const PROPERTY_RUNS = 75

describe('background tree properties', () => {
  describe('invariant oracle', () => {
    it('rejects cyclic top-level parent chains', () => {
      resetTree()
      const first = createNote('note-first' as UID, {
        parentUid: 'note-second' as UID,
        indentLevel: 1,
      })
      const second = createNote('note-second' as UID, {
        parentUid: first.uid,
        indentLevel: 0,
      })
      Tree.Items.push(first, second)
      Tree.notesByUid.set(first.uid, first)
      Tree.notesByUid.set(second.uid, second)
      Tree.existingUidsSet.add(first.uid)
      Tree.existingUidsSet.add(second.uid)

      expect(() => expectTreeInvariants()).toThrow(/parent cycle.*note-first/i)
    })

    it('rejects more than one active window', () => {
      resetTree()
      createWindow('window-first' as UID, [], { active: true })
      createWindow('window-second' as UID, [], { active: true })

      expect(() => expectTreeInvariants()).toThrow(/multiple active windows/i)
    })

    it('rejects more than one active tab in a window', () => {
      resetTree()
      const first = createTab('tab-first' as UID, {
        active: true,
        state: State.OPEN,
      })
      const second = createTab('tab-second' as UID, {
        active: true,
        state: State.OPEN,
      })
      createWindow('window-1' as UID, [first, second], {
        state: State.OPEN,
        activeTabId: first.id,
      })

      expect(() => expectTreeInvariants()).toThrow(
        /multiple active tabs.*window-1/i,
      )
    })

    it('rejects an activeTabId that does not identify an open child', () => {
      resetTree()
      const tab = createTab('tab-1' as UID, { state: State.OPEN })
      createWindow('window-1' as UID, [tab], {
        state: State.OPEN,
        activeTabId: tab.id + 100,
      })

      expect(() => expectTreeInvariants()).toThrow(/activeTabId.*window-1/i)
    })

    it('rejects a savedActiveTabUid that does not identify a saved child', () => {
      resetTree()
      createWindow('window-1' as UID, [createTab('tab-1' as UID)], {
        savedActiveTabUid: 'missing-tab' as UID,
      })

      expect(() => expectTreeInvariants()).toThrow(
        /savedActiveTabUid.*window-1/i,
      )
    })

    it('rejects a tab-group UID that collides with an item UID', () => {
      resetTree()
      const tab = createTab('tab-1' as UID, {
        tabGroup: {
          uid: 'window-1' as UID,
          id: -1,
          color: 'blue',
          collapsed: false,
        },
      })
      createWindow('window-1' as UID, [tab])

      expect(() => expectTreeInvariants()).toThrow(/tab group uid collides/i)
    })
  })

  it('materializes generated windows that satisfy background invariants', () => {
    fc.assert(
      fc.property(smallWindowSpecsArbitrary, (specs) => {
        resetTree()
        materializeWindows(specs)

        expectTreeInvariants()
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('materializes rich mixed trees that satisfy background invariants', () => {
    fc.assert(
      fc.property(richTreeSpecArbitrary, (spec) => {
        resetTree()
        materializeTree(spec)

        expectTreeInvariants()
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('covers all supported item and tab state variants in a rich tree', () => {
    resetTree()
    materializeTree({
      activeWindowIndex: 0,
      activeTabIndex: 0,
      topLevel: [
        {
          kind: 'note',
          state: State.SAVED,
          collapsed: true,
          children: [],
        },
        {
          kind: 'window',
          parentOffset: 1,
          state: State.OPEN,
          collapsed: false,
          children: [
            richTab(State.OPEN, { pinned: true, grouped: true }),
            richTab(State.SAVED),
            richTab(State.DISCARDED),
            richTab(State.OTHER),
            {
              kind: 'note',
              parentOffset: 1,
              state: State.SAVED,
              pinned: false,
              collapsed: true,
              grouped: false,
            },
            {
              kind: 'separator',
              state: State.SAVED,
              pinned: false,
              collapsed: false,
              grouped: false,
            },
          ],
        },
        {
          kind: 'separator',
          state: State.SAVED,
          collapsed: false,
          children: [],
        },
      ],
    })

    expect(new Set(Tree.Items.map((item) => item.type))).toEqual(
      new Set([TreeItemType.WINDOW, TreeItemType.NOTE, TreeItemType.SEPARATOR]),
    )
    expect(new Set(allTabs().map((tab) => tab.state))).toEqual(
      new Set([State.OPEN, State.SAVED, State.DISCARDED, State.OTHER]),
    )
    expect(allTabs().some((tab) => tab.pinned)).toBe(true)
    expect(allTabs().some((tab) => tab.tabGroup)).toBe(true)
    expect([...Tree.notesByUid.values()].some((note) => note.collapsed)).toBe(
      true,
    )
    expectTreeInvariants()
  })

  it('preserves invariants across generated rich-tree commands', async () => {
    await fc.assert(
      fc.asyncProperty(
        richTreeSpecArbitrary,
        fc.array(
          fc.record({
            command: fc.constantFrom(
              'remove',
              'move-note-to-window-root',
              'toggle-collapse',
              'decrease-indent',
            ),
            selectedIndex: fc.nat(),
            targetIndex: fc.nat(),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        async (spec, commands) => {
          resetTree()
          materializeTree(spec)

          for (const command of commands) {
            await applyRichTreeCommand(command)
            Tree.recomputeSessionTree(false)
            expectTreeInvariants()
          }
        },
      ),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('preserves invariants after removing a selected generated tab', () => {
    fc.assert(
      fc.property(
        smallWindowSpecsArbitrary.filter((specs) =>
          specs.some((window) =>
            window.children.some((child) => child.kind === 'tab'),
          ),
        ),
        fc.nat(),
        (specs, selectedIndex) => {
          resetTree()
          materializeWindows(specs)
          const tabs = allTabs()
          const tab = tabs[selectedIndex % tabs.length]

          Tree.removeTab(tab.uid, false)

          expect(Tree.tabsByUid.has(tab.uid)).toBe(false)
          expectTreeInvariants()
        },
      ),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('preserves invariants after removing a selected generated note', () => {
    fc.assert(
      fc.property(
        smallWindowSpecsArbitrary.filter((specs) =>
          specs.some((window) =>
            window.children.some((child) => child.kind === 'note'),
          ),
        ),
        fc.nat(),
        (specs, selectedIndex) => {
          resetTree()
          materializeWindows(specs)
          const notes = allNotes()
          const note = notes[selectedIndex % notes.length]

          Tree.removeNote(note.uid)

          expect(Tree.notesByUid.has(note.uid)).toBe(false)
          expectTreeInvariants()
        },
      ),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('moves a selected generated window-child note to a window root', () => {
    fc.assert(
      fc.property(
        smallWindowSpecsArbitrary.filter((specs) =>
          specs.some((window) =>
            window.children.some((child) => child.kind === 'note'),
          ),
        ),
        fc.nat(),
        fc.nat(),
        (specs, selectedIndex, rawTargetIndex) => {
          resetTree()
          const windows = materializeWindows(specs)
          const notes = allNotes()
          const note = notes[selectedIndex % notes.length]
          const targetWindow = windows[selectedIndex % windows.length]
          const targetIndex = Math.min(
            rawTargetIndex,
            targetWindow.children.length,
          )

          Tree.moveTreeItems(
            [note.uid],
            targetIndex,
            undefined,
            targetWindow.uid,
            false,
          )

          expect(allWindowChildren().map((item) => item.uid)).toContain(
            note.uid,
          )
          expect(note.windowUid).toBe(targetWindow.uid)
          expect(note.parentUid).toBeUndefined()
          expectTreeInvariants()
        },
      ),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('keeps a tab parent flag when decreasing a tab child while a note child remains', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (pinnedParent, noteBeforeTab) => {
        resetTree()
        const parent = createTab('tab-parent' as UID, {
          isParent: true,
          pinned: pinnedParent,
        })
        const noteChild = createNote('note-child' as UID, {
          parentUid: parent.uid,
          indentLevel: 2,
        })
        const tabChild = createTab('tab-child' as UID, {
          parentUid: parent.uid,
          indentLevel: 2,
        })
        const children = noteBeforeTab
          ? [parent, noteChild, tabChild]
          : [parent, tabChild, noteChild]
        const window = createWindow('window-1' as UID, children)
        Tree.recomputeSessionTree(false)

        Tree.tabIndentDecrease([tabChild.uid])

        expect(window.children.map((item) => item.uid)).toEqual(
          children.map((item) => item.uid),
        )
        expect(parent.isParent).toBe(true)
        expect(noteChild.parentUid).toBe(parent.uid)
        expect(tabChild.parentUid).toBeUndefined()
        expect(tabChild.indentLevel).toBe(1)
        expectTreeInvariants()
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('preserves invariants across short sequential in-memory operations', () => {
    fc.assert(
      fc.property(
        smallWindowSpecsArbitrary,
        fc.array(
          fc.record({
            command: fc.constantFrom(
              'remove-tab',
              'remove-note',
              'decrease-tab-indent',
            ),
            selectedIndex: fc.nat(),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        (specs, commands) => {
          resetTree()
          materializeWindows(specs)

          for (const command of commands) {
            applySequentialCommand(command)
            expectTreeInvariants()
          }
        },
      ),
      { numRuns: PROPERTY_RUNS },
    )
  })
})

function applySequentialCommand(command: SequentialCommand): void {
  if (command.command === 'remove-tab') {
    const tabs = allTabs()
    const tab = selectByIndex(tabs, command.selectedIndex)
    if (tab) Tree.removeTab(tab.uid, false)
    return
  }

  if (command.command === 'remove-note') {
    const notes = allNotes()
    const note = selectByIndex(notes, command.selectedIndex)
    if (note) Tree.removeNote(note.uid)
    return
  }

  const candidates = allTabs().filter(isSupportedIndentDecreaseCandidate)
  const tab = selectByIndex(candidates, command.selectedIndex)
  if (tab) Tree.tabIndentDecrease([tab.uid])
}

function isSupportedIndentDecreaseCandidate(tab: Tab): boolean {
  if (!tab.parentUid || tab.indentLevel <= 1) return false
  const window = Tree.windowsByUid.get(tab.windowUid)
  if (!window) return false

  const parentChildren = window.children.filter(
    (child) => child.parentUid === tab.parentUid,
  )
  if (parentChildren.some((child) => Tree.isNote(child))) return false
  return !hasNoteDescendant(tab, window.children)
}

function hasNoteDescendant(tab: Tab, children: WindowChild[]): boolean {
  const directChildren = children.filter((child) => child.parentUid === tab.uid)
  if (directChildren.some((child) => Tree.isNote(child))) return true
  return directChildren
    .filter((child): child is Tab => Tree.isTab(child))
    .some((child) => hasNoteDescendant(child, children))
}

function selectByIndex<T>(items: T[], selectedIndex: number): T | undefined {
  if (items.length === 0) return undefined
  return items[selectedIndex % items.length]
}

interface SequentialCommand {
  command: 'remove-tab' | 'remove-note' | 'decrease-tab-indent'
  selectedIndex: number
}

interface RichTreeCommand {
  command:
    | 'remove'
    | 'move-note-to-window-root'
    | 'toggle-collapse'
    | 'decrease-indent'
  selectedIndex: number
  targetIndex: number
}

async function applyRichTreeCommand(command: RichTreeCommand): Promise<void> {
  if (command.command === 'remove') {
    const candidates = allMutableTreeItems().filter(
      (item) =>
        item.type !== TreeItemType.WINDOW &&
        (item.type !== TreeItemType.TAB || item.active !== true),
    )
    const item = selectByIndex(candidates, command.selectedIndex)
    if (!item) return
    if (item.type === TreeItemType.TAB) Tree.removeTab(item.uid, false)
    else if (item.type === TreeItemType.NOTE) Tree.removeNote(item.uid)
    else Tree.removeSeparator(item.uid)
    return
  }

  if (command.command === 'move-note-to-window-root') {
    const notes = allNotes().filter(
      (candidate) =>
        candidate.windowUid && !hasBrowserBackedTabInSubtree(candidate),
    )
    const note = selectByIndex(notes, command.selectedIndex)
    if (!note?.windowUid) return
    const window = Tree.windowsByUid.get(note.windowUid)
    if (!window) return
    await Tree.moveTreeItems(
      [note.uid],
      command.targetIndex % (window.children.length + 1),
      undefined,
      window.uid,
      false,
      true,
    )
    return
  }

  if (command.command === 'toggle-collapse') {
    const note = selectByIndex(allNotes(), command.selectedIndex)
    if (note) Tree.toggleCollapseNote(note.uid)
    return
  }

  const candidates = allMutableTreeItems().filter(
    (item) =>
      item.parentUid !== undefined && !hasBrowserBackedTabInSubtree(item),
  )
  const item = selectByIndex(candidates, command.selectedIndex)
  if (!item) return
  await Tree.treeItemIndentDecrease([item.uid])
}

function hasBrowserBackedTabInSubtree(parent: TreeItem): boolean {
  if (
    parent.type === TreeItemType.TAB &&
    (parent.state === State.OPEN || parent.state === State.DISCARDED)
  ) {
    return true
  }
  if (parent.type === TreeItemType.WINDOW || !parent.windowUid) return false
  const window = Tree.windowsByUid.get(parent.windowUid)
  if (!window) return false
  const directChildren = window.children.filter(
    (candidate) => candidate.parentUid === parent.uid,
  )
  return directChildren.some(hasBrowserBackedTabInSubtree)
}

function allMutableTreeItems(): TreeItem[] {
  return [
    ...Tree.Items,
    ...[...Tree.windowsByUid.values()].flatMap((window) => window.children),
  ]
}

function richTab(
  state: State,
  overrides: Partial<{
    pinned: boolean
    grouped: boolean
    collapsed: boolean
  }> = {},
) {
  return {
    kind: 'tab' as const,
    state,
    pinned: overrides.pinned ?? false,
    collapsed: overrides.collapsed ?? false,
    grouped: overrides.grouped ?? false,
  }
}
