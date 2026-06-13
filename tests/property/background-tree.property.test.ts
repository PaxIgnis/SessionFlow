import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Tree } from '@/services/background-tree'
import { Tab, WindowChild } from '@/types/session-tree'
import {
  allNotes,
  allTabs,
  allWindowChildren,
  materializeWindows,
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
      fc.property(
        fc.boolean(),
        fc.boolean(),
        (pinnedParent, noteBeforeTab) => {
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
        },
      ),
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
