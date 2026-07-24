import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { toRaw } from 'vue'
import { SessionTree } from '@/services/foreground-tree'
import { SessionTreeDelta } from '@/types/runtime-port-service'
import {
  Tab,
  TopLevelTreeItem,
  TreeItemType,
  Window,
} from '@/types/session-tree'
import {
  makeForegroundNote,
  makeForegroundSeparator,
  makeForegroundTab,
  makeForegroundWindow,
  resetForegroundTree,
} from '../helpers/foreground-tree-fixtures'
import { expectForegroundIndexes } from '../helpers/foreground-invariants'

const PROPERTY_RUNS = 75

interface DeltaCommand {
  kind:
    | 'create-tab'
    | 'update-tab'
    | 'remove-tab'
    | 'update-window'
    | 'update-note'
    | 'update-separator'
    | 'replace'
  selectedIndex: number
  value: number
}

const deltaCommandsArbitrary = fc.array(
  fc.record({
    kind: fc.constantFrom(
      'create-tab',
      'update-tab',
      'remove-tab',
      'update-window',
      'update-note',
      'update-separator',
      'replace',
    ),
    selectedIndex: fc.nat(),
    value: fc.nat(),
  }),
  { minLength: 1, maxLength: 40 },
)

describe('foreground tree delta properties', () => {
  it('matches a full snapshot rebuild after every arbitrary supported delta', () => {
    fc.assert(
      fc.property(deltaCommandsArbitrary, (commands) => {
        resetForegroundTree()
        const model: TopLevelTreeItem[] = [
          makeForegroundNote('note-root' as UID, { indentLevel: 0 }),
          makeForegroundWindow('window-1' as UID, [
            makeForegroundTab('tab-initial' as UID),
            makeForegroundNote('note-child' as UID),
            makeForegroundSeparator('separator-child' as UID),
          ]),
        ]
        SessionTree.replaceSessionTree(model)

        commands.forEach((command, commandIndex) => {
          const delta = applyCommandToModel(model, command, commandIndex)
          if (delta) SessionTree.applyDelta(delta)

          const deltaSnapshot = structuredClone(
            toRaw(SessionTree.reactiveItems.value),
          )
          const deltaIndexes = foregroundIndexKeys()
          SessionTree.replaceSessionTree(structuredClone(model))

          expect(deltaSnapshot).toEqual(SessionTree.reactiveItems.value)
          expect(deltaIndexes).toEqual(foregroundIndexKeys())
          expectForegroundIndexes()

          SessionTree.replaceSessionTree(deltaSnapshot)
        })
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})

function applyCommandToModel(
  model: TopLevelTreeItem[],
  command: DeltaCommand,
  commandIndex: number,
): SessionTreeDelta | undefined {
  const windows = model.filter(
    (item): item is Window => item.type === TreeItemType.WINDOW,
  )
  const window = select(windows, command.selectedIndex)

  if (command.kind === 'replace') {
    if (command.value % 2 === 0) model.reverse()
    return { op: 'treeReplaced', treeItems: structuredClone(model) }
  }
  if (!window) return undefined

  const tabs = window.children.filter(
    (item): item is Tab => item.type === TreeItemType.TAB,
  )
  if (command.kind === 'create-tab') {
    const tab = makeForegroundTab(`tab-generated-${commandIndex}` as UID, {
      windowUid: window.uid,
    })
    const index = command.value % (window.children.length + 1)
    window.children.splice(index, 0, tab)
    return { op: 'tabCreated', windowUid: window.uid, tab, index }
  }
  if (command.kind === 'update-tab') {
    const tab = select(tabs, command.selectedIndex)
    if (!tab) return undefined
    tab.title = `title-${command.value}`
    return { op: 'tabUpdated', tab: structuredClone(tab) }
  }
  if (command.kind === 'remove-tab') {
    const tab = select(tabs, command.selectedIndex)
    if (!tab) return undefined
    window.children.splice(window.children.indexOf(tab), 1)
    return { op: 'tabRemoved', windowUid: window.uid, tabUid: tab.uid }
  }
  if (command.kind === 'update-window') {
    window.title = `window-${command.value}`
    return { op: 'windowUpdated', window: structuredClone(window) }
  }
  if (command.kind === 'update-note') {
    const notes = window.children.filter(
      (item) => item.type === TreeItemType.NOTE,
    )
    const note = select(notes, command.selectedIndex)
    if (!note) return undefined
    note.text = `note-${command.value}`
    return { op: 'noteUpdated', note: structuredClone(note) }
  }

  const separators = window.children.filter(
    (item) => item.type === TreeItemType.SEPARATOR,
  )
  const separator = select(separators, command.selectedIndex)
  if (!separator) return undefined
  separator.isVisible = command.value % 2 === 0
  return { op: 'separatorUpdated', separator: structuredClone(separator) }
}

function foregroundIndexKeys() {
  return {
    windows: [...SessionTree.windowsByUid.keys()],
    tabs: [...SessionTree.tabsByUid.keys()],
    notes: [...SessionTree.notesByUid.keys()],
    separators: [...SessionTree.separatorsByUid.keys()],
  }
}

function select<T>(items: T[], index: number): T | undefined {
  if (items.length === 0) return undefined
  return items[index % items.length]
}
