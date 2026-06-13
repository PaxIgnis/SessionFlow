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

  it('sends moveTabs when dropping a tab into a window', () => {
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

    expect(moveTabs).toHaveBeenCalledWith(
      [tab.uid],
      window.uid,
      0,
      undefined,
      false,
    )
    expect(moveTreeItems).not.toHaveBeenCalled()
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

  it('sends moveTabs with the tab parent when dropping a tab into a tab', () => {
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

    expect(moveTabs).toHaveBeenCalledWith(
      [tab.uid],
      window.uid,
      1,
      parent.uid,
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

    expect(moveTabs).toHaveBeenCalledWith(
      [tab.uid],
      window.uid,
      0,
      undefined,
      false,
    )
  })

  it('sends tab and note move commands in order for mixed dragged items', () => {
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

    expect(moveTabs).toHaveBeenCalledWith(
      [tab.uid],
      window.uid,
      1,
      parent.uid,
      false,
    )
    expect(moveTreeItems).toHaveBeenCalledWith(
      [note.uid],
      2,
      parent.uid,
      window.uid,
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

  it('marks dropping a note above its included child window invalid during drag', () => {
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

    expect(DragAndDrop.dragState.isValidDropTarget).toBe(false)
    expect(DragAndDrop.dragState.dropPosition).toBe(DropPosition.NONE)
    expect(event.dataTransfer?.dropEffect).toBe('none')
    expect(target.classList.contains('drag-over-above')).toBe(false)
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
    { setting: 'collapsed' as const, collapsed: false, includeDescendants: false },
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

    expect(moveTabs).toHaveBeenCalledWith(
      [tab.uid],
      window.uid,
      2,
      undefined,
      false,
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
