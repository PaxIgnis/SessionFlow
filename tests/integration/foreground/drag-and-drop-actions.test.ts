import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { DragAndDrop } from '@/services/drag-and-drop'
import { SessionTree } from '@/services/foreground-tree'
import { Selection } from '@/services/selection'
import { Settings } from '@/services/settings'
import { DragType, DropPosition, TreeItem } from '@/types/session-tree'
import {
  createFakeDragEvent,
  createFakeDragTarget,
  installFakeDocument,
} from '../../helpers/fake-dom'
import {
  makeForegroundNote,
  makeForegroundSeparator,
  makeForegroundTab,
  makeForegroundWindow,
  resetForegroundTree,
} from '../../helpers/foreground-tree-fixtures'

const moveTabs = vi.hoisted(() => vi.fn())
const moveTreeItems = vi.hoisted(() => vi.fn())
const moveWindows = vi.hoisted(() => vi.fn())

const childInclusionSettings = [
  { setting: 'always' as const, collapsed: false, includeDescendants: true },
  { setting: 'collapsed' as const, collapsed: true, includeDescendants: true },
  { setting: 'never' as const, collapsed: true, includeDescendants: false },
]

vi.mock('@/services/foreground-messages', () => ({
  moveTabs,
  moveTreeItems,
  moveWindows,
}))

describe('drag-and-drop onDrop command path', () => {
  let restoreDocument: () => void

  beforeEach(() => {
    restoreDocument?.()
    restoreDocument = installFakeDocument()
    vi.clearAllMocks()
    resetForegroundTree()
    Selection.selectedItems.value = []
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
    DragAndDrop.dragState.dragEventStarted = true
    DragAndDrop.dragState.sourceType = DragType.TAB
    DragAndDrop.dragState.destinationId = null
    DragAndDrop.dragState.destinationType = null
    DragAndDrop.dragState.isValidDropTarget = false
    DragAndDrop.dragState.prevEl = null
    DragAndDrop.dragState.dropPosition = DropPosition.NONE
    DragAndDrop.dragInfo = null
  })

  it('sends moveTreeItems when dropping a tab into a window', () => {
    const tab = makeForegroundTab('tab-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [tab])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = { dragType: DragType.TAB, items: [tab] }

    const target = createFakeDragTarget({
      id: window.uid,
      type: 'window',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })
    const { onDrop } = DragAndDrop

    onDrop(event)

    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveTreeItems).toHaveBeenCalledWith(
      [tab.uid],
      0,
      undefined,
      window.uid,
      false,
      false,
    )
    expect(moveWindows).not.toHaveBeenCalled()
  })

  it('appends a tab to the last logical window and ignores later non-window items', () => {
    const movedTab = makeForegroundTab('tab-moved' as UID)
    const sourceWindow = makeForegroundWindow('window-source' as UID, [
      movedTab,
    ])
    const parentNote = makeForegroundNote('note-parent' as UID, {
      isParent: true,
      collapsed: true,
      indentLevel: 0,
      windowUid: undefined,
    })
    const lastWindowTab = makeForegroundTab('tab-last-window' as UID)
    const lastWindow = makeForegroundWindow(
      'window-last' as UID,
      [lastWindowTab],
      {
        collapsed: true,
        indentLevel: 1,
        isVisible: false,
        parentUid: parentNote.uid,
      },
    )
    const trailingSeparator = makeForegroundSeparator(
      'separator-trailing' as UID,
      {
        indentLevel: 0,
        windowUid: undefined,
      },
    )
    resetForegroundTree([
      sourceWindow,
      parentNote,
      lastWindow,
      trailingSeparator,
    ])
    DragAndDrop.dragInfo = { dragType: DragType.TAB, items: [movedTab] }

    const target = createFakeDragTarget({
      id: 'tree-end' as UID,
      type: 'tree-end',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })

    DragAndDrop.onDrop(event)

    expect(moveTreeItems).toHaveBeenCalledWith(
      [movedTab.uid],
      lastWindow.children.length,
      undefined,
      lastWindow.uid,
      false,
      false,
    )
  })

  it.each([
    { name: 'note', sourceType: DragType.NOTE },
    { name: 'separator', sourceType: DragType.SEPARATOR },
  ])('appends a $name to the top-level tree', ({ name, sourceType }) => {
    const source =
      name === 'note'
        ? makeForegroundNote('source-note' as UID, {
            indentLevel: 0,
            windowUid: undefined,
          })
        : makeForegroundSeparator('source-separator' as UID, {
            indentLevel: 0,
            windowUid: undefined,
          })
    const window = makeForegroundWindow('window-1' as UID)
    const trailingNote = makeForegroundNote('trailing-note' as UID, {
      indentLevel: 0,
      windowUid: undefined,
    })
    resetForegroundTree([source, window, trailingNote])
    DragAndDrop.dragInfo = { dragType: sourceType, items: [source] }

    const target = createFakeDragTarget({
      id: 'tree-end' as UID,
      type: 'tree-end',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })

    DragAndDrop.onDrop(event)

    expect(moveTreeItems).toHaveBeenCalledWith(
      [source.uid],
      SessionTree.reactiveItems.value.length,
      undefined,
      undefined,
      false,
      false,
    )
  })

  it('appends a window to the top-level tree', () => {
    const sourceWindow = makeForegroundWindow('window-source' as UID)
    const trailingNote = makeForegroundNote('trailing-note' as UID, {
      indentLevel: 0,
      windowUid: undefined,
    })
    resetForegroundTree([sourceWindow, trailingNote])
    DragAndDrop.dragInfo = {
      dragType: DragType.WINDOW,
      items: [sourceWindow],
    }

    const target = createFakeDragTarget({
      id: 'tree-end' as UID,
      type: 'tree-end',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })

    DragAndDrop.onDrop(event)

    expect(moveTreeItems).toHaveBeenCalledWith(
      [sourceWindow.uid],
      SessionTree.reactiveItems.value.length,
      undefined,
      undefined,
      false,
    )
  })

  it('shows a base-indent line at the top of the bottom drop area for non-tabs', () => {
    const note = makeForegroundNote('note-1' as UID, {
      indentLevel: 0,
      windowUid: undefined,
    })
    resetForegroundTree([note])
    DragAndDrop.dragInfo = { dragType: DragType.NOTE, items: [note] }
    const target = createFakeDragTarget({
      id: 'tree-end' as UID,
      type: 'tree-end',
    })

    DragAndDrop.onDragMove(createFakeDragEvent({ target, yRatio: 0.5 }))

    expect(target.classList.contains('drag-over-tree-end')).toBe(true)
    expect(target.style.getPropertyValue('--drop-indent-level')).toBe('0')
  })

  it('shows a tab destination line on the visible collapsed ancestor', () => {
    const movedTab = makeForegroundTab('tab-moved' as UID)
    const sourceWindow = makeForegroundWindow('window-source' as UID, [
      movedTab,
    ])
    const collapsedNote = makeForegroundNote('collapsed-note' as UID, {
      collapsed: true,
      indentLevel: 0,
      isParent: true,
      windowUid: undefined,
    })
    const hiddenWindow = makeForegroundWindow('window-hidden' as UID, [], {
      collapsed: true,
      indentLevel: 1,
      isVisible: false,
      parentUid: collapsedNote.uid,
    })
    const trailingNote = makeForegroundNote('trailing-note' as UID, {
      indentLevel: 0,
      windowUid: undefined,
    })
    resetForegroundTree([
      sourceWindow,
      collapsedNote,
      hiddenWindow,
      trailingNote,
    ])
    DragAndDrop.dragInfo = { dragType: DragType.TAB, items: [movedTab] }

    const visibleAncestor = createFakeDragTarget({
      id: collapsedNote.uid,
      type: 'note',
      classes: ['tree-item'],
    })
    restoreDocument()
    restoreDocument = installFakeDocument([visibleAncestor])

    const target = createFakeDragTarget({
      id: 'tree-end' as UID,
      type: 'tree-end',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })

    DragAndDrop.onDragMove(event)

    expect(DragAndDrop.dragState.isValidDropTarget).toBe(true)
    expect(event.dataTransfer?.dropEffect).toBe('move')
    expect(visibleAncestor.classList.contains('drag-over-tree-end')).toBe(true)
    expect(visibleAncestor.style.getPropertyValue('--drop-indent-level')).toBe(
      '2',
    )
    expect(target.classList.contains('drag-over-tree-end')).toBe(false)
  })

  it('shows a tab destination line after the last visible child of an expanded window', () => {
    const movedTab = makeForegroundTab('tab-moved' as UID)
    const lastVisibleTab = makeForegroundTab('tab-last-visible' as UID, {
      indentLevel: 2,
    })
    const window = makeForegroundWindow('window-1' as UID, [
      movedTab,
      lastVisibleTab,
    ])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = { dragType: DragType.TAB, items: [movedTab] }

    const visibleChild = createFakeDragTarget({
      id: lastVisibleTab.uid,
      type: 'tab',
      classes: ['tree-item'],
    })
    restoreDocument()
    restoreDocument = installFakeDocument([visibleChild])

    const target = createFakeDragTarget({
      id: 'tree-end' as UID,
      type: 'tree-end',
    })

    DragAndDrop.onDragMove(createFakeDragEvent({ target, yRatio: 0.5 }))

    expect(visibleChild.classList.contains('drag-over-tree-end')).toBe(true)
    expect(visibleChild.style.getPropertyValue('--drop-indent-level')).toBe('1')
  })

  it('rejects a bottom-area tab drop when the tree has no window', () => {
    const tab = makeForegroundTab('tab-orphan' as UID)
    const note = makeForegroundNote('note-1' as UID, {
      indentLevel: 0,
      windowUid: undefined,
    })
    resetForegroundTree([note])
    DragAndDrop.dragInfo = { dragType: DragType.TAB, items: [tab] }
    const target = createFakeDragTarget({
      id: 'tree-end' as UID,
      type: 'tree-end',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })

    DragAndDrop.onDragMove(event)
    DragAndDrop.onDrop(event)

    expect(event.dataTransfer?.dropEffect).toBe('none')
    expectNoMoveCommands()
  })

  it('does not include expanded tab descendants for collapsed-only tab drag drops', () => {
    Settings.values.includeChildrenOfSelectedItems = 'collapsed'
    const parentTab = makeForegroundTab('tab-parent' as UID, {
      collapsed: false,
      isParent: true,
    })
    const childTab = makeForegroundTab('tab-child' as UID, {
      parentUid: parentTab.uid,
      indentLevel: 2,
    })
    const targetTab = makeForegroundTab('tab-target' as UID)
    const window = makeForegroundWindow('window-1' as UID, [
      parentTab,
      childTab,
      targetTab,
    ])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = { dragType: DragType.TAB, items: [parentTab] }

    const target = createFakeDragTarget({
      id: targetTab.uid,
      type: 'tab',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })

    DragAndDrop.onDrop(event)

    expect(moveTreeItems).toHaveBeenCalledWith(
      [parentTab.uid],
      3,
      targetTab.uid,
      window.uid,
      false,
      false,
    )
    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveWindows).not.toHaveBeenCalled()
  })

  it('marks external drag enter and move events as copy when external drops are enabled', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const target = createFakeDragTarget({
      id: 'window-1' as UID,
      type: 'window',
    })
    const enterEvent = createFakeDragEvent({ target, yRatio: 0.5 })
    const moveEvent = createFakeDragEvent({ target, yRatio: 0.5 })
    DragAndDrop.dragState.dragEventStarted = false
    Settings.values.enableDropFromExternalSources = true

    try {
      DragAndDrop.onDragEnter(enterEvent)
      DragAndDrop.onDragMove(moveEvent)

      expect(enterEvent.dataTransfer?.dropEffect).toBe('copy')
      expect(moveEvent.dataTransfer?.dropEffect).toBe('copy')
      expect(DragAndDrop.dragState.destinationId).toBeNull()
      expect(DragAndDrop.dragState.isValidDropTarget).toBe(false)
    } finally {
      consoleWarn.mockRestore()
    }
  })

  it('keeps external drag effects disabled and clears drop target state on leave', () => {
    const target = createFakeDragTarget({
      id: 'window-1' as UID,
      type: 'window',
    })
    const enterEvent = createFakeDragEvent({ target, yRatio: 0.5 })
    const moveEvent = createFakeDragEvent({ target, yRatio: 0.5 })
    const leaveEvent = createFakeDragEvent({ target, yRatio: 0.5 })
    DragAndDrop.dragState.dragEventStarted = false
    DragAndDrop.dragState.destinationId = 'window-1' as UID
    DragAndDrop.dragState.isValidDropTarget = true
    Settings.values.enableDropFromExternalSources = false

    DragAndDrop.onDragEnter(enterEvent)
    DragAndDrop.onDragMove(moveEvent)
    DragAndDrop.onDragLeave(leaveEvent)

    expect(enterEvent.dataTransfer?.dropEffect).toBe('none')
    expect(moveEvent.dataTransfer?.dropEffect).toBe('none')
    expect(leaveEvent.dataTransfer?.dropEffect).toBe('none')
    expect(DragAndDrop.dragState.destinationId).toBeNull()
    expect(DragAndDrop.dragState.isValidDropTarget).toBe(false)
  })

  it('sends moveTreeItems with the tab parent when dropping a tab into a tab', () => {
    const parent = makeForegroundTab('tab-parent' as UID)
    const tab = makeForegroundTab('tab-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [parent, tab])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = { dragType: DragType.TAB, items: [tab] }

    const target = createFakeDragTarget({
      id: parent.uid,
      type: 'tab',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })

    DragAndDrop.onDrop(event)

    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveTreeItems).toHaveBeenCalledWith(
      [tab.uid],
      1,
      parent.uid,
      window.uid,
      false,
      false,
    )
  })

  it('uses undefined parentUid when dropping a tab above a root note inside a window', () => {
    const note = makeForegroundNote('note-1' as UID)
    const tab = makeForegroundTab('tab-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [note, tab])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = { dragType: DragType.TAB, items: [tab] }

    const target = createFakeDragTarget({
      id: note.uid,
      type: 'note',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.1 })

    DragAndDrop.onDrop(event)

    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveTreeItems).toHaveBeenCalledWith(
      [tab.uid],
      0,
      undefined,
      window.uid,
      false,
      false,
    )
  })

  it('uses undefined parentUid when dropping a child tab above a root tab', () => {
    const beta = makeForegroundTab('tab-beta' as UID)
    const initial = makeForegroundTab('tab-initial' as UID, {
      isParent: true,
    })
    const alpha = makeForegroundTab('tab-alpha' as UID, {
      parentUid: initial.uid,
      indentLevel: 2,
    })
    const window = makeForegroundWindow('window-1' as UID, [
      beta,
      initial,
      alpha,
    ])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = { dragType: DragType.TAB, items: [alpha] }

    const target = createFakeDragTarget({
      id: beta.uid,
      type: 'tab',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.1 })

    DragAndDrop.onDrop(event)

    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveTreeItems).toHaveBeenCalledWith(
      [alpha.uid],
      0,
      undefined,
      window.uid,
      false,
      false,
    )
  })

  it('keeps included note and separator descendants under their dragged tab parents', () => {
    Settings.values.includeChildrenOfSelectedItems = 'collapsed'
    const target = makeForegroundTab('tab-target' as UID)
    const parent = makeForegroundTab('tab-parent' as UID, {
      collapsed: true,
      isParent: true,
    })
    const childTab = makeForegroundTab('tab-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
      isParent: true,
    })
    const childNote = makeForegroundNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const childSeparator = makeForegroundSeparator('separator-child' as UID, {
      parentUid: childTab.uid,
      indentLevel: 3,
    })
    const window = makeForegroundWindow('window-1' as UID, [
      target,
      parent,
      childTab,
      childNote,
      childSeparator,
    ])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = {
      dragType: DragType.TAB,
      items: [parent, childTab, childNote, childSeparator] as TreeItem[],
    }

    const eventTarget = createFakeDragTarget({
      id: target.uid,
      type: 'tab',
    })
    const event = createFakeDragEvent({ target: eventTarget, yRatio: 0.1 })

    DragAndDrop.onDrop(event)

    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveTreeItems).toHaveBeenCalledTimes(1)
    expect(moveTreeItems).toHaveBeenCalledWith(
      [parent.uid, childTab.uid, childNote.uid, childSeparator.uid],
      0,
      undefined,
      window.uid,
      false,
      true,
    )
  })

  it('sends one tree item move command for mixed dragged tab and note items', () => {
    const parent = makeForegroundNote('note-parent' as UID)
    const tab = makeForegroundTab('tab-1' as UID)
    const note = makeForegroundNote('note-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [parent, tab, note])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = {
      dragType: DragType.TAB,
      items: [tab, note] as TreeItem[],
    }

    const target = createFakeDragTarget({
      id: parent.uid,
      type: 'note',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })

    DragAndDrop.onDrop(event)

    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveTreeItems).toHaveBeenCalledWith(
      [tab.uid, note.uid],
      1,
      parent.uid,
      window.uid,
      false,
      false,
    )
  })

  it('sends one tree item move command for tab-source note and separator payloads', () => {
    const target = makeForegroundTab('tab-target' as UID)
    const note = makeForegroundNote('note-1' as UID)
    const separator = makeForegroundSeparator('separator-1' as UID, {
      parentUid: note.uid,
      indentLevel: 2,
    })
    const window = makeForegroundWindow('window-1' as UID, [
      target,
      note,
      separator,
    ])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = {
      dragType: DragType.TAB,
      items: [note, separator] as TreeItem[],
    }

    const eventTarget = createFakeDragTarget({
      id: target.uid,
      type: 'tab',
    })
    const event = createFakeDragEvent({ target: eventTarget, yRatio: 0.9 })

    DragAndDrop.onDrop(event)

    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveTreeItems).toHaveBeenCalledTimes(1)
    expect(moveTreeItems).toHaveBeenCalledWith(
      [note.uid, separator.uid],
      1,
      undefined,
      window.uid,
      false,
      false,
    )
  })

  it('does not send a command for invalid tab drops onto top-level notes', () => {
    const topNote = makeForegroundNote('top-note' as UID, {
      windowUid: undefined,
      indentLevel: 0,
    })
    const tab = makeForegroundTab('tab-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [tab])
    resetForegroundTree([topNote, window])
    DragAndDrop.dragInfo = { dragType: DragType.TAB, items: [tab] }

    const target = createFakeDragTarget({
      id: topNote.uid,
      type: 'note',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })

    DragAndDrop.onDrop(event)

    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveTreeItems).not.toHaveBeenCalled()
    expect(moveWindows).not.toHaveBeenCalled()
  })

  it('allows the A-F descendant drop by default and emits the descendant-target move command', () => {
    const tabA = makeForegroundTab('tab-a' as UID, { indentLevel: 1 })
    const tabB = makeForegroundTab('tab-b' as UID, {
      parentUid: tabA.uid,
      indentLevel: 2,
    })
    const tabC = makeForegroundTab('tab-c' as UID, {
      parentUid: tabB.uid,
      indentLevel: 3,
    })
    const tabD = makeForegroundTab('tab-d' as UID, {
      parentUid: tabC.uid,
      indentLevel: 4,
    })
    const tabE = makeForegroundTab('tab-e' as UID, {
      parentUid: tabB.uid,
      indentLevel: 3,
    })
    const tabF = makeForegroundTab('tab-f' as UID, { indentLevel: 1 })
    const window = makeForegroundWindow('window-1' as UID, [
      tabA,
      tabB,
      tabC,
      tabD,
      tabE,
      tabF,
    ])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = { dragType: DragType.TAB, items: [tabC] }

    const target = createFakeDragTarget({
      id: tabD.uid,
      type: 'tab',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.9 })

    DragAndDrop.onDrop(event)

    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveTreeItems).toHaveBeenCalledWith(
      [tabC.uid],
      4,
      tabC.uid,
      window.uid,
      false,
      false,
    )
    expect(moveWindows).not.toHaveBeenCalled()
  })

  it('allows the A-F descendant drop when the target descendant is included in the drag payload', () => {
    Settings.values.includeChildrenOfSelectedItems = 'always'
    const tabA = makeForegroundTab('tab-a' as UID, { indentLevel: 1 })
    const tabB = makeForegroundTab('tab-b' as UID, {
      parentUid: tabA.uid,
      indentLevel: 2,
    })
    const tabC = makeForegroundTab('tab-c' as UID, {
      parentUid: tabB.uid,
      indentLevel: 3,
    })
    const tabD = makeForegroundTab('tab-d' as UID, {
      parentUid: tabC.uid,
      indentLevel: 4,
    })
    const tabE = makeForegroundTab('tab-e' as UID, {
      parentUid: tabB.uid,
      indentLevel: 3,
    })
    const tabF = makeForegroundTab('tab-f' as UID, { indentLevel: 1 })
    const window = makeForegroundWindow('window-1' as UID, [
      tabA,
      tabB,
      tabC,
      tabD,
      tabE,
      tabF,
    ])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = {
      dragType: DragType.TAB,
      items: [tabC, tabD] as TreeItem[],
    }

    const target = createFakeDragTarget({
      id: tabD.uid,
      type: 'tab',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.9 })

    DragAndDrop.onDrop(event)

    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveTreeItems).toHaveBeenCalledWith(
      [tabC.uid, tabD.uid],
      4,
      tabC.uid,
      window.uid,
      false,
      true,
    )
    expect(moveWindows).not.toHaveBeenCalled()
  })

  it('does not move tab C in the A-F descendant drop when descendant drops are disabled', () => {
    Settings.values.includeChildrenOfSelectedItems = 'always'
    Settings.values.allowDropOntoDescendantItems = false
    const tabA = makeForegroundTab('tab-a' as UID, { indentLevel: 1 })
    const tabB = makeForegroundTab('tab-b' as UID, {
      parentUid: tabA.uid,
      indentLevel: 2,
    })
    const tabC = makeForegroundTab('tab-c' as UID, {
      parentUid: tabB.uid,
      indentLevel: 3,
    })
    const tabD = makeForegroundTab('tab-d' as UID, {
      parentUid: tabC.uid,
      indentLevel: 4,
    })
    const tabE = makeForegroundTab('tab-e' as UID, {
      parentUid: tabB.uid,
      indentLevel: 3,
    })
    const tabF = makeForegroundTab('tab-f' as UID, { indentLevel: 1 })
    const window = makeForegroundWindow('window-1' as UID, [
      tabA,
      tabB,
      tabC,
      tabD,
      tabE,
      tabF,
    ])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = {
      dragType: DragType.TAB,
      items: [tabC, tabD] as TreeItem[],
    }

    const target = createFakeDragTarget({
      id: tabD.uid,
      type: 'tab',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.9 })

    DragAndDrop.onDrop(event)

    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveTreeItems).not.toHaveBeenCalled()
    expect(moveWindows).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'above',
      yRatio: 0.1,
      expectedIndex: 1,
      expectedParentUid: 'tab-a' as UID,
    },
    {
      label: 'mid',
      yRatio: 0.5,
      expectedIndex: 2,
      expectedParentUid: 'tab-b' as UID,
    },
    {
      label: 'below',
      yRatio: 0.9,
      expectedIndex: 2,
      expectedParentUid: 'tab-a' as UID,
    },
  ])(
    'sends the exact move command when dropping a tab $label its direct child',
    ({ yRatio, expectedIndex, expectedParentUid }) => {
      Settings.values.allowDropOntoDescendantItems = true
      const tabA = makeForegroundTab('tab-a' as UID, {
        indentLevel: 1,
        isParent: true,
      })
      const tabB = makeForegroundTab('tab-b' as UID, {
        parentUid: tabA.uid,
        indentLevel: 2,
      })
      const tail = makeForegroundTab('tab-tail' as UID)
      const window = makeForegroundWindow('window-1' as UID, [tabA, tabB, tail])
      resetForegroundTree([window])
      DragAndDrop.dragInfo = { dragType: DragType.TAB, items: [tabA] }

      const target = createFakeDragTarget({
        id: tabB.uid,
        type: 'tab',
      })
      const event = createFakeDragEvent({ target, yRatio })

      DragAndDrop.onDrop(event)

      expect(moveTabs).not.toHaveBeenCalled()
      expect(moveTreeItems).toHaveBeenCalledWith(
        [tabA.uid],
        expectedIndex,
        expectedParentUid,
        window.uid,
        false,
        true,
      )
      expect(moveWindows).not.toHaveBeenCalled()
    },
  )

  it.each([
    {
      source: 'tab' as const,
      target: 'direct descendant tab' as const,
      targetDepth: 'direct' as const,
      targetType: 'tab' as const,
      yRatio: 0.1,
      label: 'above',
    },
    {
      source: 'tab' as const,
      target: 'direct descendant tab' as const,
      targetDepth: 'direct' as const,
      targetType: 'tab' as const,
      yRatio: 0.5,
      label: 'mid',
    },
    {
      source: 'tab' as const,
      target: 'direct descendant tab' as const,
      targetDepth: 'direct' as const,
      targetType: 'tab' as const,
      yRatio: 0.9,
      label: 'below',
    },
    {
      source: 'tab' as const,
      target: 'non-direct descendant tab' as const,
      targetDepth: 'nested' as const,
      targetType: 'tab' as const,
      yRatio: 0.1,
      label: 'above',
    },
    {
      source: 'tab' as const,
      target: 'non-direct descendant tab' as const,
      targetDepth: 'nested' as const,
      targetType: 'tab' as const,
      yRatio: 0.5,
      label: 'mid',
    },
    {
      source: 'tab' as const,
      target: 'non-direct descendant tab' as const,
      targetDepth: 'nested' as const,
      targetType: 'tab' as const,
      yRatio: 0.9,
      label: 'below',
    },
    {
      source: 'note' as const,
      target: 'direct descendant note' as const,
      targetDepth: 'direct' as const,
      targetType: 'note' as const,
      yRatio: 0.1,
      label: 'above',
    },
    {
      source: 'note' as const,
      target: 'direct descendant note' as const,
      targetDepth: 'direct' as const,
      targetType: 'note' as const,
      yRatio: 0.5,
      label: 'mid',
    },
    {
      source: 'note' as const,
      target: 'direct descendant note' as const,
      targetDepth: 'direct' as const,
      targetType: 'note' as const,
      yRatio: 0.9,
      label: 'below',
    },
    {
      source: 'note' as const,
      target: 'non-direct descendant note' as const,
      targetDepth: 'nested' as const,
      targetType: 'note' as const,
      yRatio: 0.1,
      label: 'above',
    },
    {
      source: 'note' as const,
      target: 'non-direct descendant note' as const,
      targetDepth: 'nested' as const,
      targetType: 'note' as const,
      yRatio: 0.5,
      label: 'mid',
    },
    {
      source: 'note' as const,
      target: 'non-direct descendant note' as const,
      targetDepth: 'nested' as const,
      targetType: 'note' as const,
      yRatio: 0.9,
      label: 'below',
    },
    {
      source: 'mixed tab/note' as const,
      target: 'direct descendant note' as const,
      targetDepth: 'direct' as const,
      targetType: 'note' as const,
      yRatio: 0.1,
      label: 'above',
    },
    {
      source: 'mixed tab/note' as const,
      target: 'direct descendant note' as const,
      targetDepth: 'direct' as const,
      targetType: 'note' as const,
      yRatio: 0.5,
      label: 'mid',
    },
    {
      source: 'mixed tab/note' as const,
      target: 'direct descendant note' as const,
      targetDepth: 'direct' as const,
      targetType: 'note' as const,
      yRatio: 0.9,
      label: 'below',
    },
    {
      source: 'mixed tab/note' as const,
      target: 'non-direct descendant tab' as const,
      targetDepth: 'nested' as const,
      targetType: 'tab' as const,
      yRatio: 0.1,
      label: 'above',
    },
    {
      source: 'mixed tab/note' as const,
      target: 'non-direct descendant tab' as const,
      targetDepth: 'nested' as const,
      targetType: 'tab' as const,
      yRatio: 0.5,
      label: 'mid',
    },
    {
      source: 'mixed tab/note' as const,
      target: 'non-direct descendant tab' as const,
      targetDepth: 'nested' as const,
      targetType: 'tab' as const,
      yRatio: 0.9,
      label: 'below',
    },
  ])(
    'does not move when $source is dropped $label its $target with descendant drops disabled',
    ({ source, targetDepth, targetType, yRatio }) => {
      Settings.values.allowDropOntoDescendantItems = false
      const setup = setupDescendantDropFixture(source)
      const target =
        targetDepth === 'direct'
          ? setup.directDescendant
          : setup.nestedDescendant
      const eventTarget = createFakeDragTarget({
        id: target.uid,
        type: targetType,
      })
      const event = createFakeDragEvent({ target: eventTarget, yRatio })

      DragAndDrop.onDrop(event)

      expect(moveTabs).not.toHaveBeenCalled()
      expect(moveTreeItems).not.toHaveBeenCalled()
      expect(moveWindows).not.toHaveBeenCalled()
    },
  )

  it.each([
    {
      source: 'tab' as const,
      targetDepth: 'direct' as const,
      targetType: 'tab' as const,
      yRatio: 0.1,
      label: 'above direct descendant tab',
    },
    {
      source: 'tab' as const,
      targetDepth: 'direct' as const,
      targetType: 'tab' as const,
      yRatio: 0.5,
      label: 'mid direct descendant tab',
    },
    {
      source: 'tab' as const,
      targetDepth: 'direct' as const,
      targetType: 'tab' as const,
      yRatio: 0.9,
      label: 'below direct descendant tab',
    },
    {
      source: 'tab' as const,
      targetDepth: 'nested' as const,
      targetType: 'tab' as const,
      yRatio: 0.1,
      label: 'above non-direct descendant tab',
    },
    {
      source: 'tab' as const,
      targetDepth: 'nested' as const,
      targetType: 'tab' as const,
      yRatio: 0.5,
      label: 'mid non-direct descendant tab',
    },
    {
      source: 'tab' as const,
      targetDepth: 'nested' as const,
      targetType: 'tab' as const,
      yRatio: 0.9,
      label: 'below non-direct descendant tab',
    },
    {
      source: 'note' as const,
      targetDepth: 'direct' as const,
      targetType: 'note' as const,
      yRatio: 0.1,
      label: 'above direct descendant note',
    },
    {
      source: 'note' as const,
      targetDepth: 'direct' as const,
      targetType: 'note' as const,
      yRatio: 0.5,
      label: 'mid direct descendant note',
    },
    {
      source: 'note' as const,
      targetDepth: 'direct' as const,
      targetType: 'note' as const,
      yRatio: 0.9,
      label: 'below direct descendant note',
    },
    {
      source: 'note' as const,
      targetDepth: 'nested' as const,
      targetType: 'note' as const,
      yRatio: 0.1,
      label: 'above non-direct descendant note',
    },
    {
      source: 'note' as const,
      targetDepth: 'nested' as const,
      targetType: 'note' as const,
      yRatio: 0.5,
      label: 'mid non-direct descendant note',
    },
    {
      source: 'note' as const,
      targetDepth: 'nested' as const,
      targetType: 'note' as const,
      yRatio: 0.9,
      label: 'below non-direct descendant note',
    },
  ])(
    'marks dropping $source $label invalid during drag when descendant drops are disabled',
    ({ source, targetDepth, targetType, yRatio }) => {
      Settings.values.allowDropOntoDescendantItems = false
      const setup = setupDescendantDropFixture(source)
      const target =
        targetDepth === 'direct'
          ? setup.directDescendant
          : setup.nestedDescendant
      const eventTarget = createFakeDragTarget({
        id: target.uid,
        type: targetType,
      })
      const event = createFakeDragEvent({ target: eventTarget, yRatio })

      DragAndDrop.onDragMove(event)

      expect(DragAndDrop.dragState.isValidDropTarget).toBe(false)
      expect(DragAndDrop.dragState.dropPosition).toBe(DropPosition.NONE)
      expect(event.dataTransfer?.dropEffect).toBe('none')
      expect(eventTarget.classList.contains('drag-over-above')).toBe(false)
      expect(eventTarget.classList.contains('drag-over-mid')).toBe(false)
      expect(eventTarget.classList.contains('drag-over-below')).toBe(false)
    },
  )

  it('drops an expanded note mid onto a descendant note when descendant drops are allowed', () => {
    Settings.values.includeChildrenOfSelectedItems = 'collapsed'
    Settings.values.allowDropOntoDescendantItems = true
    const note = makeForegroundNote('note-source' as UID, {
      collapsed: false,
      isParent: true,
    })
    const child = makeForegroundNote('note-child' as UID, {
      parentUid: note.uid,
      indentLevel: 2,
    })
    const tail = makeForegroundTab('tab-tail' as UID)
    const window = makeForegroundWindow('window-1' as UID, [note, child, tail])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = { dragType: DragType.NOTE, items: [note] }

    const target = createFakeDragTarget({
      id: child.uid,
      type: 'note',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })

    DragAndDrop.onDrop(event)

    expect(moveTreeItems).toHaveBeenCalledWith(
      [note.uid],
      2,
      child.uid,
      window.uid,
      false,
      false,
    )
    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveWindows).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'above direct descendant note',
      targetDepth: 'direct' as const,
      yRatio: 0.1,
      expectedPosition: DropPosition.ABOVE,
    },
    {
      label: 'mid direct descendant note',
      targetDepth: 'direct' as const,
      yRatio: 0.5,
      expectedPosition: DropPosition.MID,
    },
    {
      label: 'below direct descendant note',
      targetDepth: 'direct' as const,
      yRatio: 0.9,
      expectedPosition: DropPosition.BELOW,
    },
    {
      label: 'above non-direct descendant note',
      targetDepth: 'nested' as const,
      yRatio: 0.1,
      expectedPosition: DropPosition.ABOVE,
    },
    {
      label: 'mid non-direct descendant note',
      targetDepth: 'nested' as const,
      yRatio: 0.5,
      expectedPosition: DropPosition.MID,
    },
    {
      label: 'below non-direct descendant note',
      targetDepth: 'nested' as const,
      yRatio: 0.9,
      expectedPosition: DropPosition.BELOW,
    },
  ])(
    'marks dropping a note $label valid when descendant drops are allowed',
    ({ targetDepth, yRatio, expectedPosition }) => {
      Settings.values.includeChildrenOfSelectedItems = 'always'
      Settings.values.allowDropOntoDescendantItems = true
      const setup = setupDescendantDropFixture('note')
      const target =
        targetDepth === 'direct'
          ? setup.directDescendant
          : setup.nestedDescendant
      const eventTarget = createFakeDragTarget({
        id: target.uid,
        type: 'note',
      })
      const event = createFakeDragEvent({ target: eventTarget, yRatio })

      DragAndDrop.onDragMove(event)

      expect(DragAndDrop.dragState.isValidDropTarget).toBe(true)
      expect(DragAndDrop.dragState.dropPosition).toBe(expectedPosition)
      expect(event.dataTransfer?.dropEffect).toBe('move')
    },
  )

  it('sends moveWindows when dropping a window below another window', () => {
    const sourceWindow = makeForegroundWindow('window-source' as UID)
    const targetWindow = makeForegroundWindow('window-target' as UID)
    resetForegroundTree([sourceWindow, targetWindow])
    DragAndDrop.dragInfo = {
      dragType: DragType.WINDOW,
      items: [sourceWindow],
    }

    const target = createFakeDragTarget({
      id: targetWindow.uid,
      type: 'window',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.9 })

    DragAndDrop.onDrop(event)

    expect(moveTreeItems).toHaveBeenCalledWith(
      [sourceWindow.uid],
      2,
      undefined,
      undefined,
      false,
    )
    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveWindows).not.toHaveBeenCalled()
  })

  it('resets drag state after a valid drop', () => {
    const tab = makeForegroundTab('tab-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [tab])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = { dragType: DragType.TAB, items: [tab] }

    const target = createFakeDragTarget({
      id: window.uid,
      type: 'window',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })

    DragAndDrop.onDrop(event)

    expect(DragAndDrop.dragInfo).toBeNull()
    expect(DragAndDrop.dragState.dragEventStarted).toBe(false)
    expect(DragAndDrop.dragState.dropPosition).toBe(DropPosition.NONE)
  })

  it('uses the lower subtree boundary when dropping a note below a collapsed note', () => {
    Settings.values.includeChildrenOfSelectedItems = 'collapsed'
    const collapsed = makeForegroundNote('note-collapsed' as UID, {
      collapsed: true,
      isParent: true,
    })
    const hiddenChild = makeForegroundTab('tab-hidden' as UID, {
      parentUid: collapsed.uid,
      indentLevel: 2,
      isVisible: false,
    })
    const note = makeForegroundNote('note-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [
      collapsed,
      hiddenChild,
      note,
    ])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = { dragType: DragType.NOTE, items: [note] }

    const target = createFakeDragTarget({
      id: collapsed.uid,
      type: 'note',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.9 })

    DragAndDrop.onDrop(event)

    expect(moveTreeItems).toHaveBeenCalledWith(
      [note.uid],
      2,
      undefined,
      window.uid,
      false,
      false,
    )
  })

  it('sends moveTreeItems when dropping a note above a tab sibling', () => {
    Settings.values.includeChildrenOfSelectedItems = 'collapsed'
    const tab = makeForegroundTab('tab-1' as UID)
    const note = makeForegroundNote('note-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [tab, note])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = { dragType: DragType.NOTE, items: [note] }

    const target = createFakeDragTarget({
      id: tab.uid,
      type: 'tab',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.1 })

    DragAndDrop.onDrop(event)

    expect(moveTreeItems).toHaveBeenCalledWith(
      [note.uid],
      0,
      undefined,
      window.uid,
      false,
      false,
    )
  })

  it('sends moveTreeItems when dropping a separator below a tab sibling', () => {
    const tab = makeForegroundTab('tab-1' as UID)
    const separator = makeForegroundSeparator('separator-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [tab, separator])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = {
      dragType: DragType.SEPARATOR,
      items: [separator],
    }

    const target = createFakeDragTarget({
      id: tab.uid,
      type: 'tab',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.9 })

    DragAndDrop.onDrop(event)

    expect(moveTreeItems).toHaveBeenCalledWith(
      [separator.uid],
      1,
      undefined,
      window.uid,
      false,
      false,
    )
  })

  it('drops a tab near the middle of a separator as a sibling, not as a child', () => {
    const separator = makeForegroundSeparator('separator-1' as UID)
    const tab = makeForegroundTab('tab-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [separator, tab])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = { dragType: DragType.TAB, items: [tab] }

    const target = createFakeDragTarget({
      id: separator.uid,
      type: 'separator',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })

    DragAndDrop.onDrop(event)

    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveTreeItems).toHaveBeenCalledWith(
      [tab.uid],
      1,
      undefined,
      window.uid,
      false,
      false,
    )
    expect(moveWindows).not.toHaveBeenCalled()
  })

  it('drags an expanded note out of a window without including its tab child', () => {
    Settings.values.includeChildrenOfSelectedItems = 'collapsed'
    const note = makeForegroundNote('note-parent' as UID, {
      collapsed: false,
      isParent: true,
    })
    const childTab = makeForegroundTab('tab-child' as UID, {
      parentUid: note.uid,
      indentLevel: 2,
    })
    const sourceWindow = makeForegroundWindow('window-source' as UID, [
      note,
      childTab,
    ])
    const targetWindow = makeForegroundWindow('window-target' as UID)
    resetForegroundTree([sourceWindow, targetWindow])
    DragAndDrop.dragInfo = { dragType: DragType.NOTE, items: [note] }

    const target = createFakeDragTarget({
      id: targetWindow.uid,
      type: 'window',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.1 })

    DragAndDrop.onDrop(event)

    expect(moveTreeItems).toHaveBeenCalledWith(
      [note.uid],
      1,
      undefined,
      undefined,
      false,
      false,
    )
  })

  it('does not include expanded note descendants for collapsed-only note drag drops', () => {
    Settings.values.includeChildrenOfSelectedItems = 'collapsed'
    const rootTab = makeForegroundTab('tab-root' as UID)
    const note = makeForegroundNote('note-1' as UID, {
      collapsed: false,
      isParent: true,
    })
    const childTab = makeForegroundTab('tab-child' as UID, {
      parentUid: note.uid,
      indentLevel: 2,
    })
    const window = makeForegroundWindow('window-1' as UID, [
      rootTab,
      note,
      childTab,
    ])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = { dragType: DragType.NOTE, items: [note] }

    const target = createFakeDragTarget({
      id: rootTab.uid,
      type: 'tab',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })

    DragAndDrop.onDrop(event)

    expect(moveTreeItems).toHaveBeenCalledWith(
      [note.uid],
      1,
      rootTab.uid,
      window.uid,
      false,
      false,
    )
  })

  it('rejects dropping a note into a window when always-included descendants contain a window', () => {
    Settings.values.includeChildrenOfSelectedItems = 'always'
    const note = makeForegroundNote('note-parent' as UID, {
      indentLevel: 0,
      isParent: true,
      windowUid: undefined,
    })
    const childWindow = makeForegroundWindow('window-child' as UID, [], {
      indentLevel: 1,
      parentUid: note.uid,
    })
    const targetWindow = makeForegroundWindow('window-target' as UID)
    resetForegroundTree([note, childWindow, targetWindow])
    DragAndDrop.dragInfo = { dragType: DragType.NOTE, items: [note] }

    const target = createFakeDragTarget({
      id: targetWindow.uid,
      type: 'window',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })

    DragAndDrop.onDrop(event)

    expect(moveTreeItems).not.toHaveBeenCalled()
    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveWindows).not.toHaveBeenCalled()
  })

  it('rejects dropping a collapsed note into a window when collapsed descendants contain a window', () => {
    Settings.values.includeChildrenOfSelectedItems = 'collapsed'
    const note = makeForegroundNote('note-parent' as UID, {
      collapsed: true,
      indentLevel: 0,
      isParent: true,
      windowUid: undefined,
    })
    const childWindow = makeForegroundWindow('window-child' as UID, [], {
      indentLevel: 1,
      parentUid: note.uid,
    })
    const targetWindow = makeForegroundWindow('window-target' as UID)
    resetForegroundTree([note, childWindow, targetWindow])
    DragAndDrop.dragInfo = { dragType: DragType.NOTE, items: [note] }

    const target = createFakeDragTarget({
      id: targetWindow.uid,
      type: 'window',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })

    DragAndDrop.onDrop(event)

    expect(moveTreeItems).not.toHaveBeenCalled()
    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveWindows).not.toHaveBeenCalled()
  })

  it('marks note drops into windows invalid during drag when included descendants contain a window', () => {
    Settings.values.includeChildrenOfSelectedItems = 'always'
    const note = makeForegroundNote('note-parent' as UID, {
      indentLevel: 0,
      isParent: true,
      windowUid: undefined,
    })
    const childWindow = makeForegroundWindow('window-child' as UID, [], {
      indentLevel: 1,
      parentUid: note.uid,
    })
    const targetWindow = makeForegroundWindow('window-target' as UID)
    resetForegroundTree([note, childWindow, targetWindow])
    DragAndDrop.dragInfo = { dragType: DragType.NOTE, items: [note] }

    const target = createFakeDragTarget({
      id: targetWindow.uid,
      type: 'window',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })

    DragAndDrop.onDragMove(event)

    expect(DragAndDrop.dragState.isValidDropTarget).toBe(false)
    expect(DragAndDrop.dragState.dropPosition).toBe(DropPosition.NONE)
    expect(event.dataTransfer?.dropEffect).toBe('none')
    expect(target.classList.contains('drag-over-mid')).toBe(false)
    expect(target.classList.contains('drag-over-above')).toBe(false)
    expect(target.classList.contains('drag-over-below')).toBe(false)
  })

  it('marks dropping a note above its included child window valid when descendant drops are allowed', () => {
    Settings.values.includeChildrenOfSelectedItems = 'always'
    const note = makeForegroundNote('note-parent' as UID, {
      indentLevel: 0,
      isParent: true,
      windowUid: undefined,
    })
    const childWindow = makeForegroundWindow('window-child' as UID, [], {
      indentLevel: 1,
      parentUid: note.uid,
    })
    resetForegroundTree([note, childWindow])
    DragAndDrop.dragInfo = { dragType: DragType.NOTE, items: [note] }

    const target = createFakeDragTarget({
      id: childWindow.uid,
      type: 'window',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.1 })

    DragAndDrop.onDragMove(event)

    expect(DragAndDrop.dragState.isValidDropTarget).toBe(true)
    expect(DragAndDrop.dragState.dropPosition).toBe(DropPosition.ABOVE)
    expect(event.dataTransfer?.dropEffect).toBe('move')
    expect(target.classList.contains('drag-over-above')).toBe(true)
  })

  it.each([
    { label: 'above', yRatio: 0.1, expectedPosition: DropPosition.ABOVE },
    { label: 'below', yRatio: 0.9, expectedPosition: DropPosition.BELOW },
  ])(
    'marks dropping an expanded note $label its child window valid during drag',
    ({ yRatio, expectedPosition }) => {
      Settings.values.includeChildrenOfSelectedItems = 'collapsed'
      const note = makeForegroundNote('note-parent' as UID, {
        collapsed: false,
        indentLevel: 0,
        isParent: true,
        windowUid: undefined,
      })
      const childWindow = makeForegroundWindow('window-child' as UID, [], {
        indentLevel: 1,
        parentUid: note.uid,
      })
      resetForegroundTree([note, childWindow])
      DragAndDrop.dragInfo = { dragType: DragType.NOTE, items: [note] }

      const target = createFakeDragTarget({
        id: childWindow.uid,
        type: 'window',
      })
      const event = createFakeDragEvent({ target, yRatio })

      DragAndDrop.onDragMove(event)

      expect(DragAndDrop.dragState.isValidDropTarget).toBe(true)
      expect(DragAndDrop.dragState.dropPosition).toBe(expectedPosition)
      expect(event.dataTransfer?.dropEffect).toBe('move')
      expect(
        target.classList.contains(
          expectedPosition === DropPosition.ABOVE
            ? 'drag-over-above'
            : 'drag-over-below',
        ),
      ).toBe(true)
    },
  )

  it.each([
    { label: 'above', yRatio: 0.1, expectedIndex: 1 },
    { label: 'below', yRatio: 0.9, expectedIndex: 2 },
  ])(
    'drops an expanded note $label its child window without making the note its own parent',
    ({ yRatio, expectedIndex }) => {
      Settings.values.includeChildrenOfSelectedItems = 'collapsed'
      const note = makeForegroundNote('note-parent' as UID, {
        collapsed: false,
        indentLevel: 0,
        isParent: true,
        windowUid: undefined,
      })
      const childWindow = makeForegroundWindow('window-child' as UID, [], {
        indentLevel: 1,
        parentUid: note.uid,
      })
      resetForegroundTree([note, childWindow])
      DragAndDrop.dragInfo = { dragType: DragType.NOTE, items: [note] }

      const target = createFakeDragTarget({
        id: childWindow.uid,
        type: 'window',
      })
      const event = createFakeDragEvent({ target, yRatio })

      DragAndDrop.onDrop(event)

      expect(moveTreeItems).toHaveBeenCalledWith(
        [note.uid],
        expectedIndex,
        undefined,
        undefined,
        false,
        false,
      )
    },
  )

  it.each([
    { setting: 'always' as const, collapsed: false },
    { setting: 'collapsed' as const, collapsed: true },
  ])(
    'drops a root note with its child window below another root window when descendants are included: $setting',
    ({ setting, collapsed }) => {
      Settings.values.includeChildrenOfSelectedItems = setting
      const note = makeForegroundNote('note-parent' as UID, {
        collapsed,
        indentLevel: 0,
        isParent: true,
        windowUid: undefined,
      })
      const childWindow = makeForegroundWindow('window-child' as UID, [], {
        indentLevel: 1,
        parentUid: note.uid,
      })
      const targetWindow = makeForegroundWindow('window-target' as UID)
      resetForegroundTree([note, childWindow, targetWindow])
      DragAndDrop.dragInfo = { dragType: DragType.NOTE, items: [note] }

      const target = createFakeDragTarget({
        id: targetWindow.uid,
        type: 'window',
      })
      const event = createFakeDragEvent({ target, yRatio: 0.9 })

      DragAndDrop.onDrop(event)

      expect(moveTreeItems).toHaveBeenCalledWith(
        [note.uid],
        3,
        undefined,
        undefined,
        false,
        true,
      )
    },
  )

  it.each(childInclusionSettings)(
    'drops a collapsed root note above another root window using child inclusion setting: $setting',
    ({ setting, collapsed, includeDescendants }) => {
      Settings.values.includeChildrenOfSelectedItems = setting
      const targetWindow = makeForegroundWindow('window-target' as UID)
      const note = makeForegroundNote('note-parent' as UID, {
        collapsed,
        indentLevel: 0,
        isParent: true,
        windowUid: undefined,
      })
      const childWindow = makeForegroundWindow('window-child' as UID, [], {
        indentLevel: 1,
        parentUid: note.uid,
      })
      resetForegroundTree([targetWindow, note, childWindow])
      DragAndDrop.dragInfo = { dragType: DragType.NOTE, items: [note] }

      const target = createFakeDragTarget({
        id: targetWindow.uid,
        type: 'window',
      })
      const event = createFakeDragEvent({ target, yRatio: 0.1 })

      DragAndDrop.onDrop(event)

      expect(moveTreeItems).toHaveBeenCalledWith(
        [note.uid],
        0,
        undefined,
        undefined,
        false,
        includeDescendants,
      )
    },
  )

  it.each([
    { setting: 'always' as const, collapsed: false, includeDescendants: true },
    {
      setting: 'collapsed' as const,
      collapsed: false,
      includeDescendants: false,
    },
    { setting: 'never' as const, collapsed: false, includeDescendants: false },
  ])(
    'drops an expanded note with a tab child into a tab using child inclusion setting: $setting',
    ({ setting, collapsed, includeDescendants }) => {
      Settings.values.includeChildrenOfSelectedItems = setting
      const rootTab = makeForegroundTab('tab-root' as UID)
      const note = makeForegroundNote('note-parent' as UID, {
        collapsed,
        isParent: true,
      })
      const childTab = makeForegroundTab('tab-child' as UID, {
        parentUid: note.uid,
        indentLevel: 2,
      })
      const window = makeForegroundWindow('window-1' as UID, [
        rootTab,
        note,
        childTab,
      ])
      resetForegroundTree([window])
      DragAndDrop.dragInfo = { dragType: DragType.NOTE, items: [note] }

      const target = createFakeDragTarget({
        id: rootTab.uid,
        type: 'tab',
      })
      const event = createFakeDragEvent({ target, yRatio: 0.5 })

      DragAndDrop.onDrop(event)

      expect(moveTreeItems).toHaveBeenCalledWith(
        [note.uid],
        1,
        rootTab.uid,
        window.uid,
        false,
        includeDescendants,
      )
    },
  )

  it.each([
    { setting: 'always' as const, collapsed: false, isAllowed: false },
    { setting: 'collapsed' as const, collapsed: true, isAllowed: false },
    { setting: 'never' as const, collapsed: true, isAllowed: true },
  ])(
    'validates dropping a root note into a window with child-window descendants using setting: $setting',
    ({ setting, collapsed, isAllowed }) => {
      Settings.values.includeChildrenOfSelectedItems = setting
      const note = makeForegroundNote('note-parent' as UID, {
        collapsed,
        indentLevel: 0,
        isParent: true,
        windowUid: undefined,
      })
      const childWindow = makeForegroundWindow('window-child' as UID, [], {
        indentLevel: 1,
        parentUid: note.uid,
      })
      const targetWindow = makeForegroundWindow('window-target' as UID)
      resetForegroundTree([note, childWindow, targetWindow])
      DragAndDrop.dragInfo = { dragType: DragType.NOTE, items: [note] }

      const target = createFakeDragTarget({
        id: targetWindow.uid,
        type: 'window',
      })
      const event = createFakeDragEvent({ target, yRatio: 0.5 })

      DragAndDrop.onDragMove(event)

      expect(DragAndDrop.dragState.isValidDropTarget).toBe(isAllowed)
      expect(event.dataTransfer?.dropEffect).toBe(isAllowed ? 'move' : 'none')
    },
  )

  it.each([
    {
      allowDescendantDrops: false,
      expectedAllowed: false,
      targetDepth: 'direct' as const,
      yRatio: 0.1,
      label: 'above direct tab',
    },
    {
      allowDescendantDrops: false,
      expectedAllowed: false,
      targetDepth: 'direct' as const,
      yRatio: 0.5,
      label: 'mid direct tab',
    },
    {
      allowDescendantDrops: false,
      expectedAllowed: false,
      targetDepth: 'direct' as const,
      yRatio: 0.9,
      label: 'below direct tab',
    },
    {
      allowDescendantDrops: false,
      expectedAllowed: false,
      targetDepth: 'nested' as const,
      yRatio: 0.1,
      label: 'above nested tab',
    },
    {
      allowDescendantDrops: false,
      expectedAllowed: false,
      targetDepth: 'nested' as const,
      yRatio: 0.5,
      label: 'mid nested tab',
    },
    {
      allowDescendantDrops: false,
      expectedAllowed: false,
      targetDepth: 'nested' as const,
      yRatio: 0.9,
      label: 'below nested tab',
    },
    {
      allowDescendantDrops: true,
      expectedAllowed: true,
      targetDepth: 'direct' as const,
      yRatio: 0.1,
      label: 'above direct tab',
    },
    {
      allowDescendantDrops: true,
      expectedAllowed: true,
      targetDepth: 'direct' as const,
      yRatio: 0.5,
      label: 'mid direct tab',
    },
    {
      allowDescendantDrops: true,
      expectedAllowed: true,
      targetDepth: 'direct' as const,
      yRatio: 0.9,
      label: 'below direct tab',
    },
    {
      allowDescendantDrops: true,
      expectedAllowed: true,
      targetDepth: 'nested' as const,
      yRatio: 0.1,
      label: 'above nested tab',
    },
    {
      allowDescendantDrops: true,
      expectedAllowed: true,
      targetDepth: 'nested' as const,
      yRatio: 0.5,
      label: 'mid nested tab',
    },
    {
      allowDescendantDrops: true,
      expectedAllowed: true,
      targetDepth: 'nested' as const,
      yRatio: 0.9,
      label: 'below nested tab',
    },
  ])(
    'validates dropping a root note $label inside its descendant child window when descendant drops allowed is $allowDescendantDrops',
    ({ allowDescendantDrops, expectedAllowed, targetDepth, yRatio }) => {
      Settings.values.includeChildrenOfSelectedItems = 'always'
      Settings.values.allowDropOntoDescendantItems = allowDescendantDrops
      const note = makeForegroundNote('note-parent' as UID, {
        indentLevel: 0,
        isParent: true,
        windowUid: undefined,
      })
      const rootTab = makeForegroundTab('tab-root' as UID)
      const childTab = makeForegroundTab('tab-child' as UID, {
        parentUid: rootTab.uid,
        indentLevel: 2,
      })
      const childWindow = makeForegroundWindow(
        'window-child' as UID,
        [rootTab, childTab],
        {
          indentLevel: 1,
          parentUid: note.uid,
        },
      )
      resetForegroundTree([note, childWindow])
      DragAndDrop.dragInfo = { dragType: DragType.NOTE, items: [note] }

      const target = targetDepth === 'direct' ? rootTab : childTab
      const eventTarget = createFakeDragTarget({
        id: target.uid,
        type: 'tab',
      })
      const event = createFakeDragEvent({ target: eventTarget, yRatio })

      DragAndDrop.onDragMove(event)

      expect(DragAndDrop.dragState.isValidDropTarget).toBe(expectedAllowed)
      expect(event.dataTransfer?.dropEffect).toBe(
        expectedAllowed ? 'move' : 'none',
      )
      expect(eventTarget.classList.contains('drag-over-above')).toBe(
        expectedAllowed && yRatio < 0.33,
      )
      expect(eventTarget.classList.contains('drag-over-mid')).toBe(
        expectedAllowed && yRatio >= 0.33 && yRatio <= 0.66,
      )
      expect(eventTarget.classList.contains('drag-over-below')).toBe(
        expectedAllowed && yRatio > 0.66,
      )
    },
  )

  it('uses the note subtree boundary when dropping a tab below a parent note', () => {
    const parent = makeForegroundNote('note-parent' as UID, { isParent: true })
    const child = makeForegroundNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const tab = makeForegroundTab('tab-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [parent, child, tab])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = { dragType: DragType.TAB, items: [tab] }

    const target = createFakeDragTarget({
      id: parent.uid,
      type: 'note',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.9 })

    DragAndDrop.onDrop(event)

    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveTreeItems).toHaveBeenCalledWith(
      [tab.uid],
      2,
      undefined,
      window.uid,
      false,
      true,
    )
  })

  it('moves a window under a top-level note when dropped mid', () => {
    const note = makeForegroundNote('top-note' as UID, {
      indentLevel: 0,
      windowUid: undefined,
    })
    const window = makeForegroundWindow('window-1' as UID)
    resetForegroundTree([note, window])
    DragAndDrop.dragInfo = { dragType: DragType.WINDOW, items: [window] }

    const target = createFakeDragTarget({
      id: note.uid,
      type: 'note',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })

    DragAndDrop.onDrop(event)

    expect(moveTreeItems).toHaveBeenCalledWith(
      [window.uid],
      1,
      note.uid,
      undefined,
      false,
    )
  })

  it('uses the destination window parent when dropping a window above a child window', () => {
    const sourceWindow = makeForegroundWindow('window-source' as UID)
    const parentNote = makeForegroundNote('top-note' as UID, {
      indentLevel: 0,
      isParent: true,
      windowUid: undefined,
    })
    const childWindow = makeForegroundWindow('window-child' as UID, [], {
      indentLevel: 1,
      parentUid: parentNote.uid,
    })
    resetForegroundTree([sourceWindow, parentNote, childWindow])
    DragAndDrop.dragInfo = {
      dragType: DragType.WINDOW,
      items: [sourceWindow],
    }

    const target = createFakeDragTarget({
      id: childWindow.uid,
      type: 'window',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.1 })

    DragAndDrop.onDrop(event)

    expect(moveTreeItems).toHaveBeenCalledWith(
      [sourceWindow.uid],
      2,
      parentNote.uid,
      undefined,
      false,
    )
  })

  it('rejects dropping a window onto a note inside a window', () => {
    const note = makeForegroundNote('note-1' as UID)
    const sourceWindow = makeForegroundWindow('window-source' as UID)
    const targetWindow = makeForegroundWindow('window-target' as UID, [note])
    resetForegroundTree([sourceWindow, targetWindow])
    DragAndDrop.dragInfo = {
      dragType: DragType.WINDOW,
      items: [sourceWindow],
    }

    const target = createFakeDragTarget({
      id: note.uid,
      type: 'note',
    })
    const event = createFakeDragEvent({ target, yRatio: 0.5 })

    DragAndDrop.onDrop(event)

    expect(moveTreeItems).not.toHaveBeenCalled()
    expect(moveTabs).not.toHaveBeenCalled()
    expect(moveWindows).not.toHaveBeenCalled()
  })
})

function expectNoMoveCommands(): void {
  expect(moveTabs).not.toHaveBeenCalled()
  expect(moveTreeItems).not.toHaveBeenCalled()
  expect(moveWindows).not.toHaveBeenCalled()
}

function setupDescendantDropFixture(
  source: 'tab' | 'note' | 'mixed tab/note',
): {
  directDescendant: TreeItem
  nestedDescendant: TreeItem
} {
  if (source === 'note') {
    Settings.values.includeChildrenOfSelectedItems = 'always'
    const note = makeForegroundNote('note-source' as UID, {
      isParent: true,
    })
    const directDescendant = makeForegroundNote('note-child' as UID, {
      parentUid: note.uid,
      indentLevel: 2,
      isParent: true,
    })
    const nestedDescendant = makeForegroundNote('note-grandchild' as UID, {
      parentUid: directDescendant.uid,
      indentLevel: 3,
    })
    const tail = makeForegroundTab('tab-tail' as UID)
    const window = makeForegroundWindow('window-1' as UID, [
      note,
      directDescendant,
      nestedDescendant,
      tail,
    ])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = { dragType: DragType.NOTE, items: [note] }

    return {
      directDescendant,
      nestedDescendant,
    }
  }

  if (source === 'mixed tab/note') {
    const tab = makeForegroundTab('tab-source' as UID, {
      isParent: true,
    })
    const directDescendant = makeForegroundNote('note-child' as UID, {
      parentUid: tab.uid,
      indentLevel: 2,
      isParent: true,
    })
    const nestedDescendant = makeForegroundTab('tab-grandchild' as UID, {
      parentUid: directDescendant.uid,
      indentLevel: 3,
    })
    const draggedNote = makeForegroundNote('note-dragged-sibling' as UID)
    const tail = makeForegroundTab('tab-tail' as UID)
    const window = makeForegroundWindow('window-1' as UID, [
      tab,
      directDescendant,
      nestedDescendant,
      draggedNote,
      tail,
    ])
    resetForegroundTree([window])
    DragAndDrop.dragInfo = {
      dragType: DragType.TAB,
      items: [tab, draggedNote] as TreeItem[],
    }

    return {
      directDescendant,
      nestedDescendant,
    }
  }

  const tab = makeForegroundTab('tab-source' as UID, {
    isParent: true,
  })
  const directDescendant = makeForegroundTab('tab-child' as UID, {
    parentUid: tab.uid,
    indentLevel: 2,
    isParent: true,
  })
  const nestedDescendant = makeForegroundTab('tab-grandchild' as UID, {
    parentUid: directDescendant.uid,
    indentLevel: 3,
  })
  const tail = makeForegroundTab('tab-tail' as UID)
  const window = makeForegroundWindow('window-1' as UID, [
    tab,
    directDescendant,
    nestedDescendant,
    tail,
  ])
  resetForegroundTree([window])
  DragAndDrop.dragInfo = { dragType: DragType.TAB, items: [tab] }

  return {
    directDescendant,
    nestedDescendant,
  }
}
