import { DragAndDrop } from '@/services/drag-and-drop'
import * as Messages from '@/services/foreground-messages'
import { SessionTree } from '@/services/foreground-tree'
import { Selection } from '@/services/selection'
import { Settings } from '@/services/settings'
import { Settings as SettingsType } from '@/types/settings'
import {
  DragInfo,
  DragType,
  DropPosition,
  DropType,
  SelectionType,
  TreeItem,
  TreeItemType,
  Window,
} from '@/types/session-tree'

export function collectDraggedItemsWithIncludedChildren(
  items: TreeItem[],
  originType: SelectionType,
  includeChildrenOfSelectedItems: SettingsType['includeChildrenOfSelectedItems'],
  windowsByUid: Map<UID, Window>,
): TreeItem[] {
  if (
    originType !== SelectionType.TAB ||
    includeChildrenOfSelectedItems === 'never'
  ) {
    return items
  }

  const additionalItems: TreeItem[] = []
  for (const item of items) {
    if (item.type !== TreeItemType.TAB) continue
    const shouldInclude =
      item.isParent &&
      (includeChildrenOfSelectedItems === 'always' ||
        (item.collapsed && includeChildrenOfSelectedItems === 'collapsed'))
    if (!shouldInclude) continue

    const window = windowsByUid.get(item.windowUid)
    if (!window) continue

    const parentIndex = window.children.findIndex(
      (child) => child.uid === item.uid,
    )
    if (parentIndex === -1) continue

    const parentIndent = item.indentLevel ?? 1
    for (let i = parentIndex + 1; i < window.children.length; i++) {
      const child = window.children[i]
      const indent = child.indentLevel ?? 0
      if (indent <= parentIndent) break
      if (
        !items.some((existing) => existing.uid === child.uid) &&
        !additionalItems.some((existing) => existing.uid === child.uid)
      ) {
        additionalItems.push(child)
      }
    }
  }

  return items.concat(additionalItems)
}

export function start(dragInfo: DragInfo): void {
  reset()
  console.debug('drag-and-drop-actions.start: Drag started:', dragInfo)
  DragAndDrop.dragState.dragEventStarted = true
  DragAndDrop.dragState.sourceType = getEffectiveDragType(dragInfo.items)
  DragAndDrop.dragInfo = dragInfo
}

export function onDragEnd(e: DragEvent): void {
  // reset()
  if (!Settings.values.enableDragAndDrop) return
  console.debug('drag-and-drop-actions.onDragEnd: Drag ended:', e)
}

export function onDragEnter(e: DragEvent): void {
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
  if (!Settings.values.enableDragAndDrop) return
  if (!DragAndDrop.dragState.dragEventStarted) {
    if (!Settings.values.enableDropFromExternalSources) return
    // TODO: Handle drop from external source verification here
    console.warn('drag-and-drop-actions.onDragEnter: External drag enter', e)

    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    return
  }

  const el = (e.target as HTMLElement)?.closest(
    '.drag-and-drop-target',
  ) as HTMLElement | null
  if (!el) return
  if (!el.getAttribute) return
  const type = el.getAttribute('drag-and-drop-type')
  const id = el.getAttribute('drag-and-drop-id')

  updateDropTarget(e)
  if (!DragAndDrop.dragState.isValidDropTarget) return

  if (!type || !id) {
    return
  }

  // TODO: drop effect can also be copy when it is implemented
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'

  // TODO: Validate drop target here, later
  if (type === 'tab') {
    // TODO: Check if tab exists when tabsByUid is implemented in foreground tree
    // const tab = SessionTree.tabsByUid.get(id)
    // if (!tab) return
    DragAndDrop.dragState.destinationId = id
  } else if (type === 'window') {
    const window = SessionTree.windowsByUid.get(id)
    if (!window) return
    DragAndDrop.dragState.destinationId = id
  } else if (type === 'note') {
    const note = SessionTree.notesByUid.get(id)
    if (!note) return
    DragAndDrop.dragState.destinationId = id
  } else if (type === 'separator') {
    const separator = SessionTree.separatorsByUid.get(id)
    if (!separator) return
    DragAndDrop.dragState.destinationId = id
  }
}

export function onDragLeave(e: DragEvent): void {
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
  DragAndDrop.dragState.destinationId = null
  DragAndDrop.dragState.isValidDropTarget = false
}

export function onDragMove(e: DragEvent): void {
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
  if (!Settings.values.enableDragAndDrop) return
  // verify external drag is valid before setting drop effect
  if (!DragAndDrop.dragState.dragEventStarted) {
    if (!Settings.values.enableDropFromExternalSources) return
    // TODO: Handle drop from external source verification here
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    return
  }
  updateDropTarget(e)

  const el = (e.target as HTMLElement)?.closest(
    '.drag-and-drop-target',
  ) as HTMLElement | null

  if (!el) return
  if (!el.getAttribute) return

  if (DragAndDrop.dragState.prevEl && DragAndDrop.dragState.prevEl !== el) {
    clearDragIndicators(DragAndDrop.dragState.prevEl)
  }

  // add drag indicator classes to visualize drop position
  if (DragAndDrop.dragState.isValidDropTarget) {
    // TODO: drop effect can also be copy when it is implemented
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    switch (DragAndDrop.dragState.dropPosition) {
      case DropPosition.ABOVE:
        el.classList.add('drag-over-above')
        el.classList.remove('drag-over-mid', 'drag-over-below')
        break
      case DropPosition.MID:
        el.classList.add('drag-over-mid')
        el.classList.remove('drag-over-above', 'drag-over-below')
        break
      case DropPosition.BELOW:
        el.classList.add('drag-over-below')
        el.classList.remove('drag-over-above', 'drag-over-mid')
        break
    }
  }

  DragAndDrop.dragState.prevEl = el
}

export function onDrop(e: DragEvent): void {
  console.log(DragAndDrop.dragState)
  if (!Settings.values.enableDragAndDrop) return
  updateDropTarget(e)

  if (
    !DragAndDrop.dragState.isValidDropTarget ||
    !DragAndDrop.dragState.dragEventStarted ||
    !DragAndDrop.dragState.destinationId ||
    DragAndDrop.dragState.destinationType === DropType.OTHER
  ) {
    clearDragIndicators(DragAndDrop.dragState.prevEl)
    reset()
    return
  }

  // calculate drop index
  let dropIndex = 0
  let dropParentUid: UID | undefined = undefined
  let targetWindowUid: UID | undefined = undefined
  const id = DragAndDrop.dragState.destinationId
  const draggedItems = DragAndDrop.dragInfo!.items
  const effectiveSourceType = getEffectiveDragType(draggedItems)
  const includeDescendantsForDraggedItems =
    effectiveSourceType === DragType.NOTE
      ? shouldIncludeDescendantsForDraggedItems(draggedItems)
      : effectiveSourceType === DragType.SEPARATOR
        ? false
      : true

  // if src and drop target is type tab
  if (
    DragAndDrop.dragState.destinationType === DropType.TAB &&
    (effectiveSourceType === DragType.TAB ||
      effectiveSourceType === DragType.NOTE ||
      effectiveSourceType === DragType.SEPARATOR)
  ) {
    const destinationTab = SessionTree.tabsByUid.get(id as UID)
    const destinationWindow = destinationTab
      ? SessionTree.windowsByUid.get(destinationTab.windowUid)
      : undefined
    targetWindowUid = destinationWindow?.uid
    if (!destinationWindow) return
    const destTab = destinationWindow.children.find((tab) => tab.uid === id)
    const destTabIndex = destinationWindow.children.findIndex(
      (tab) => tab.uid === id,
    )
    if (destTabIndex === -1 || !destTab) return

    // dropping as sibling above
    if (DragAndDrop.dragState.dropPosition === DropPosition.ABOVE) {
      dropIndex = destTabIndex
      dropParentUid = destTab.parentUid
    }
    // dropping as sibling below
    else if (DragAndDrop.dragState.dropPosition === DropPosition.BELOW) {
      // Scan forward to find the next tab with same or lower indent level
      const targetIndent = destTab.indentLevel ?? 1
      for (
        let i = destTabIndex + 1;
        i < destinationWindow.children.length;
        i++
      ) {
        const candidate = destinationWindow.children[i]
        if ((candidate.indentLevel ?? 1) <= targetIndent) {
          dropIndex = i
          break
        }
      }
      if (dropIndex === 0) dropIndex = destinationWindow.children.length
      dropParentUid = destTab.parentUid
    }
    // dropping as child
    else if (DragAndDrop.dragState.dropPosition === DropPosition.MID) {
      // TODO: Add setting to control whether new child tabs are added at start or end of children
      dropIndex = destTabIndex + 1 // currently always adds as first child
      dropParentUid = destTab.uid
    }
  }
  // if drop target is a window
  else if (DragAndDrop.dragState.destinationType === DropType.WINDOW) {
    const destinationWindow = SessionTree.windowsByUid.get(id as UID)
    targetWindowUid = destinationWindow?.uid
    const destinationWindowIndex = SessionTree.reactiveItems.value.findIndex(
      (item) => item.type === TreeItemType.WINDOW && item.uid === id,
    )
    if (destinationWindowIndex === -1 || !destinationWindow) return
    // dropping as window above (src window only)
    if (
      DragAndDrop.dragState.dropPosition === DropPosition.ABOVE &&
      (effectiveSourceType === DragType.WINDOW ||
        effectiveSourceType === DragType.NOTE ||
        effectiveSourceType === DragType.SEPARATOR)
    ) {
      dropIndex = destinationWindowIndex
      dropParentUid = destinationWindow.parentUid
      targetWindowUid = undefined
      if (
        effectiveSourceType === DragType.NOTE &&
        !includeDescendantsForDraggedItems
      ) {
        dropParentUid = getDropParentUidAfterMovingWithoutDescendants(
          draggedItems,
          dropParentUid,
        )
      }
    }
    // dropping as window below (src window only)
    else if (
      DragAndDrop.dragState.dropPosition === DropPosition.BELOW &&
      (effectiveSourceType === DragType.WINDOW ||
        effectiveSourceType === DragType.NOTE ||
        effectiveSourceType === DragType.SEPARATOR)
    ) {
      dropIndex = destinationWindowIndex + 1
      dropParentUid = destinationWindow.parentUid
      targetWindowUid = undefined
      if (
        effectiveSourceType === DragType.NOTE &&
        !includeDescendantsForDraggedItems
      ) {
        dropParentUid = getDropParentUidAfterMovingWithoutDescendants(
          draggedItems,
          dropParentUid,
        )
      }
    }
    // dropping as tab in window (mid) (src tab only)
    else if (
      DragAndDrop.dragState.dropPosition === DropPosition.MID &&
      (effectiveSourceType === DragType.TAB ||
        effectiveSourceType === DragType.NOTE ||
        effectiveSourceType === DragType.SEPARATOR)
    ) {
      // TODO: Add setting to control whether new child tabs are added at start or end of children
      dropIndex = 0 // currently always adds as first tab
    }
  }
  // if drop target is a note
  else if (DragAndDrop.dragState.destinationType === DropType.NOTE) {
    const destinationNote = SessionTree.notesByUid.get(id as UID)
    if (!destinationNote) return
    const destination = findItemLocation(
      SessionTree.reactiveItems.value as TreeItem[],
      destinationNote.uid,
    )
    if (!destination) return
    targetWindowUid = destinationNote.windowUid

    if (DragAndDrop.dragState.dropPosition === DropPosition.ABOVE) {
      dropIndex = destination.index
      dropParentUid = destination.parent
    } else if (DragAndDrop.dragState.dropPosition === DropPosition.BELOW) {
      const targetIndent = destinationNote.indentLevel ?? 0
      dropIndex = destination.children.length
      for (
        let i = destination.index + 1;
        i < destination.children.length;
        i++
      ) {
        const candidate = destination.children[i]
        if ((candidate.indentLevel ?? 0) <= targetIndent) {
          dropIndex = i
          break
        }
      }
      dropParentUid = destination.parent
    } else if (DragAndDrop.dragState.dropPosition === DropPosition.MID) {
      dropIndex = destination.index + 1
      dropParentUid = destinationNote.uid
    }
  }
  // if drop target is a separator
  else if (DragAndDrop.dragState.destinationType === DropType.SEPARATOR) {
    const destinationSeparator = SessionTree.separatorsByUid.get(id as UID)
    if (!destinationSeparator) return
    const destination = findItemLocation(
      SessionTree.reactiveItems.value as TreeItem[],
      destinationSeparator.uid,
    )
    if (!destination) return
    targetWindowUid = destinationSeparator.windowUid

    if (DragAndDrop.dragState.dropPosition === DropPosition.ABOVE) {
      dropIndex = destination.index
      dropParentUid = destination.parent
    } else if (DragAndDrop.dragState.dropPosition === DropPosition.BELOW) {
      dropIndex = destination.index + 1
      dropParentUid = destination.parent
    } else {
      clearDragIndicators(DragAndDrop.dragState.prevEl)
      reset()
      return
    }
  }
  // if src is tab and dest is tab or window
  if (
    effectiveSourceType === DragType.TAB &&
    (DragAndDrop.dragState.destinationType === DropType.TAB ||
      DragAndDrop.dragState.destinationType === DropType.WINDOW ||
      DragAndDrop.dragState.destinationType === DropType.NOTE ||
      DragAndDrop.dragState.destinationType === DropType.SEPARATOR)
  ) {
    if (targetWindowUid) {
      const tabs = draggedItems.filter((item) => item.type === TreeItemType.TAB)
      const notes = draggedItems.filter(
        (item) => item.type === TreeItemType.NOTE,
      )
      const separators = draggedItems.filter(
        (item) => item.type === TreeItemType.SEPARATOR,
      )
      if (tabs.length > 0) {
        Messages.moveTabs(
          tabs.map((tab) => tab.uid),
          targetWindowUid as UID,
          dropIndex,
          dropParentUid,
          false,
        )
      }
      if (notes.length > 0) {
        Messages.moveTreeItems(
          notes.map((note) => note.uid),
          dropIndex + tabs.length,
          dropParentUid,
          targetWindowUid,
          false,
        )
      }
      if (separators.length > 0) {
        Messages.moveTreeItems(
          separators.map((separator) => separator.uid),
          dropIndex + tabs.length + notes.length,
          dropParentUid,
          targetWindowUid,
          false,
          false,
        )
      }
    }
  }
  // if src is window and dest is window or note
  else if (
    effectiveSourceType === DragType.WINDOW &&
    (DragAndDrop.dragState.destinationType === DropType.WINDOW ||
      DragAndDrop.dragState.destinationType === DropType.NOTE ||
      DragAndDrop.dragState.destinationType === DropType.SEPARATOR)
  ) {
    Messages.moveTreeItems(
      draggedItems
        .filter(
          (item) =>
            item.type === TreeItemType.WINDOW ||
            item.type === TreeItemType.NOTE ||
            item.type === TreeItemType.SEPARATOR,
        )
        .map((item) => item.uid),
      dropIndex,
      dropParentUid || undefined,
      undefined,
      false,
    )
  }
  // if src is note and dest is anything
  else if (effectiveSourceType === DragType.NOTE) {
    if (
      targetWindowUid &&
      includeDescendantsForDraggedItems &&
      includedDraggedNoteDescendantsContainWindow(draggedItems)
    ) {
      clearDragIndicators(DragAndDrop.dragState.prevEl)
      reset()
      return
    }

    Messages.moveTreeItems(
      draggedItems.map((item) => item.uid),
      dropIndex,
      dropParentUid,
      targetWindowUid,
      false,
      includeDescendantsForDraggedItems,
    )
  }
  // if src is separator and dest is anything
  else if (effectiveSourceType === DragType.SEPARATOR) {
    Messages.moveTreeItems(
      draggedItems.map((item) => item.uid),
      dropIndex,
      dropParentUid,
      targetWindowUid,
      false,
      false,
    )
  }
  clearDragIndicators(DragAndDrop.dragState.prevEl)
  reset()
}

function reset(): void {
  DragAndDrop.dragState.dragEventStarted = false
  DragAndDrop.dragState.sourceType = null
  DragAndDrop.dragState.destinationId = null
  DragAndDrop.dragState.destinationType = null
  DragAndDrop.dragState.isValidDropTarget = false
  DragAndDrop.dragState.dropPosition = DropPosition.NONE
  DragAndDrop.dragInfo = null

  // clear any drag indicators anywhere in the DOM
  const elements = document.querySelectorAll<HTMLElement>(
    '.drag-over-above, .drag-over-mid, .drag-over-below',
  )

  elements.forEach((el) => {
    el.classList.remove('drag-over-above', 'drag-over-mid', 'drag-over-below')
  })

  DragAndDrop.dragState.prevEl = null

  if (!Settings.values.enableDragAndDrop) return

  Selection.clearSelection()
}

/**
 * Clears drag indicator classes from the given element, cleaning up visual state.
 *
 * @param {HTMLElement | null} el - The element to clear drag indicators from.
 */
function clearDragIndicators(el: HTMLElement | null) {
  if (!el) return
  el.classList.remove('drag-over-above', 'drag-over-mid', 'drag-over-below')
}

/**
 * Updates destination type, id and drop position based on drag event.
 *
 * @param {DragEvent} e - The drag event.
 */
function updateDropTarget(e: DragEvent): void {
  const el = (e.target as HTMLElement)?.closest(
    '.drag-and-drop-target',
  ) as HTMLElement | null

  DragAndDrop.dragState.isValidDropTarget = false
  DragAndDrop.dragState.dropPosition = DropPosition.NONE
  DragAndDrop.dragState.destinationId = null
  DragAndDrop.dragState.destinationType = null

  if (!el) return
  if (!el.getAttribute) return

  const type = el.getAttribute('drag-and-drop-type')
  const id = el.getAttribute('drag-and-drop-id')

  if (!id || !type) return

  DragAndDrop.dragState.destinationId = id

  let destType: DropType = DropType.OTHER
  if (type === 'tab') {
    destType = DropType.TAB
  } else if (type === 'window') {
    destType = DropType.WINDOW
  } else if (type === 'note') {
    destType = DropType.NOTE
  } else if (type === 'separator') {
    destType = DropType.SEPARATOR
  }
  DragAndDrop.dragState.destinationType = destType

  // cannot drop onto self
  if (DragAndDrop.dragInfo?.items.find((item) => item.uid === id)) return

  // check if this is a valid drop target
  const sourceType = getEffectiveDragType(DragAndDrop.dragInfo?.items ?? [])
  // don't allow dropping tabs onto notes that are not in a window
  if (
    sourceType === DragType.TAB &&
    DragAndDrop.dragState.destinationType === DropType.NOTE
  ) {
    const destinationNote = SessionTree.notesByUid.get(id as UID)
    if (!destinationNote?.windowUid) return
  }

  // don't allow dropping windows onto notes that are in a window
  if (
    sourceType === DragType.WINDOW &&
    DragAndDrop.dragState.destinationType === DropType.NOTE
  ) {
    const destinationNote = SessionTree.notesByUid.get(id as UID)
    if (destinationNote?.windowUid) return
  }

  if (sourceType === DragType.TAB) {
    if (
      DragAndDrop.dragState.destinationType !== DropType.WINDOW &&
      DragAndDrop.dragState.destinationType !== DropType.TAB &&
      DragAndDrop.dragState.destinationType !== DropType.NOTE &&
      DragAndDrop.dragState.destinationType !== DropType.SEPARATOR
    )
      return
  } else if (sourceType === DragType.WINDOW) {
    if (
      DragAndDrop.dragState.destinationType !== DropType.WINDOW &&
      DragAndDrop.dragState.destinationType !== DropType.NOTE &&
      DragAndDrop.dragState.destinationType !== DropType.SEPARATOR
    )
      return
  } else if (sourceType === DragType.NOTE) {
    if (
      DragAndDrop.dragState.destinationType !== DropType.WINDOW &&
      DragAndDrop.dragState.destinationType !== DropType.TAB &&
      DragAndDrop.dragState.destinationType !== DropType.NOTE &&
      DragAndDrop.dragState.destinationType !== DropType.SEPARATOR
    )
      return
  } else if (sourceType === DragType.SEPARATOR) {
    if (
      DragAndDrop.dragState.destinationType !== DropType.WINDOW &&
      DragAndDrop.dragState.destinationType !== DropType.TAB &&
      DragAndDrop.dragState.destinationType !== DropType.NOTE &&
      DragAndDrop.dragState.destinationType !== DropType.SEPARATOR
    )
      return
  }

  const rect = el.getBoundingClientRect()
  const y = e.clientY - rect.top
  const h = rect.height || 1
  const dropPosition = getDropPositionForTarget(
    sourceType,
    DragAndDrop.dragState.destinationType,
    y,
    h,
  )
  const draggedItems = DragAndDrop.dragInfo?.items ?? []
  const includeDescendants =
    sourceType === DragType.NOTE
      ? shouldIncludeDescendantsForDraggedItems(draggedItems)
      : sourceType === DragType.SEPARATOR
        ? false
      : true

  if (
    sourceType === DragType.NOTE &&
    isSelfOrDescendantParentDrop(
      draggedItems,
      DragAndDrop.dragState.destinationType,
      id as UID,
      dropPosition,
      includeDescendants,
    )
  ) {
    return
  }

  if (
    sourceType === DragType.NOTE &&
    includeDescendants &&
    includedDraggedNoteDescendantsContainWindow(draggedItems) &&
    isWindowBackedDropTarget(
      DragAndDrop.dragState.destinationType,
      id as UID,
      dropPosition,
    )
  ) {
    return
  }

  DragAndDrop.dragState.dropPosition = dropPosition
  DragAndDrop.dragState.isValidDropTarget = true
}

function getDropPositionForTarget(
  sourceType: DragType,
  destinationType: DropType,
  y: number,
  h: number,
): DropPosition {
  if (sourceType === DragType.TAB && destinationType === DropType.WINDOW) {
    return DropPosition.MID
  }

  if (destinationType === DropType.SEPARATOR) {
    return y < h / 2 ? DropPosition.ABOVE : DropPosition.BELOW
  }

  if (
    sourceType === DragType.WINDOW &&
    destinationType === DropType.WINDOW
  ) {
    return y < h / 2 ? DropPosition.ABOVE : DropPosition.BELOW
  }

  if (y < h * 0.33) {
    return DropPosition.ABOVE
  }
  if (y > h * 0.66) {
    return DropPosition.BELOW
  }
  return DropPosition.MID
}

function isWindowBackedDropTarget(
  destinationType: DropType,
  destinationId: UID,
  dropPosition: DropPosition,
): boolean {
  if (destinationType === DropType.WINDOW) {
    return dropPosition === DropPosition.MID
  }
  if (destinationType === DropType.TAB) return true
  if (destinationType === DropType.NOTE) {
    return Boolean(SessionTree.notesByUid.get(destinationId)?.windowUid)
  }
  if (destinationType === DropType.SEPARATOR) {
    return Boolean(SessionTree.separatorsByUid.get(destinationId)?.windowUid)
  }
  return false
}

function isSelfOrDescendantParentDrop(
  draggedItems: TreeItem[],
  destinationType: DropType,
  destinationId: UID,
  dropPosition: DropPosition,
  includeDescendants: boolean,
): boolean {
  const dropParentUid = getDropParentUidForValidation(
    destinationType,
    destinationId,
    dropPosition,
  )
  const effectiveDropParentUid = includeDescendants
    ? dropParentUid
    : getDropParentUidAfterMovingWithoutDescendants(
        draggedItems,
        dropParentUid,
      )
  if (!effectiveDropParentUid) return false

  return draggedItems
    .filter((item) => item.type === TreeItemType.NOTE)
    .some(
      (item) =>
        effectiveDropParentUid === item.uid ||
        noteDescendantUids(item).has(effectiveDropParentUid),
    )
}

function getDropParentUidAfterMovingWithoutDescendants(
  draggedItems: TreeItem[],
  dropParentUid: UID | undefined,
): UID | undefined {
  if (!dropParentUid) return undefined
  const draggedParent = draggedItems.find(
    (item) => item.type === TreeItemType.NOTE && item.uid === dropParentUid,
  )
  return draggedParent ? draggedParent.parentUid : dropParentUid
}

function getDropParentUidForValidation(
  destinationType: DropType,
  destinationId: UID,
  dropPosition: DropPosition,
): UID | undefined {
  if (destinationType === DropType.WINDOW) {
    return dropPosition === DropPosition.MID
      ? undefined
      : SessionTree.windowsByUid.get(destinationId)?.parentUid
  }
  if (destinationType === DropType.TAB) {
    const tab = SessionTree.tabsByUid.get(destinationId)
    return dropPosition === DropPosition.MID ? tab?.uid : tab?.parentUid
  }
  if (destinationType === DropType.NOTE) {
    const note = SessionTree.notesByUid.get(destinationId)
    return dropPosition === DropPosition.MID ? note?.uid : note?.parentUid
  }
  if (destinationType === DropType.SEPARATOR) {
    const separator = SessionTree.separatorsByUid.get(destinationId)
    return dropPosition === DropPosition.MID ? undefined : separator?.parentUid
  }
  return undefined
}

function getEffectiveDragType(items: TreeItem[]): DragType {
  if (items.some((item) => item.type === TreeItemType.WINDOW)) {
    return DragType.WINDOW
  }
  if (items.some((item) => item.type === TreeItemType.TAB)) {
    return DragType.TAB
  }
  if (items.some((item) => item.type === TreeItemType.NOTE)) {
    return DragType.NOTE
  }
  return DragType.SEPARATOR
}

function shouldIncludeDescendantsForDraggedItems(items: TreeItem[]): boolean {
  if (Settings.values.includeChildrenOfSelectedItems === 'always') return true
  if (Settings.values.includeChildrenOfSelectedItems === 'never') return false

  return items
    .filter((item) => item.type === TreeItemType.NOTE)
    .some((item) => item.isParent && item.collapsed)
}

function includedDraggedNoteDescendantsContainWindow(items: TreeItem[]): boolean {
  return items
    .filter((item) => item.type === TreeItemType.NOTE)
    .some((item) => noteDescendantsContainWindow(item))
}

function noteDescendantsContainWindow(note: TreeItem): boolean {
  const location = findItemLocation(
    SessionTree.reactiveItems.value as TreeItem[],
    note.uid,
  )
  if (!location) return false

  const noteIndent = note.indentLevel ?? 0
  for (let i = location.index + 1; i < location.children.length; i++) {
    const candidate = location.children[i]
    if ((candidate.indentLevel ?? 0) <= noteIndent) break
    if (candidate.type === TreeItemType.WINDOW) return true
  }
  return false
}

function noteDescendantUids(note: TreeItem): Set<UID> {
  const descendantUids = new Set<UID>()
  const location = findItemLocation(
    SessionTree.reactiveItems.value as TreeItem[],
    note.uid,
  )
  if (!location) return descendantUids

  const noteIndent = note.indentLevel ?? 0
  for (let i = location.index + 1; i < location.children.length; i++) {
    const candidate = location.children[i]
    if ((candidate.indentLevel ?? 0) <= noteIndent) break
    descendantUids.add(candidate.uid)
  }
  return descendantUids
}

interface ItemLocation {
  item: TreeItem
  children: TreeItem[]
  index: number
  parent?: UID
}

function findItemLocation(
  children: TreeItem[],
  uid: UID,
): ItemLocation | undefined {
  const index = children.findIndex((item) => item.uid === uid)
  if (index !== -1) {
    return {
      item: children[index],
      children,
      index,
      parent: children[index].parentUid,
    }
  }

  for (const item of children) {
    const nestedChildren =
      item.type === TreeItemType.WINDOW ? (item.children as TreeItem[]) : []
    const location = findItemLocation(nestedChildren, uid)
    if (location) return location
  }
  return undefined
}

/**
 * Draws text on a canvas context, truncating it with an ellipsis if it exceeds the specified maximum width.
 *
 * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
 * @param {string} text - The text to be drawn.
 * @param {number} x - The x-coordinate where the text should start.
 * @param {number} y - The y-coordinate where the text should be drawn.
 * @param {number} maxWidth - The maximum width allowed for the text.
 */
export function drawTextEllipsisOnCanvas(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, x, y)
    return
  }
  const ell = '…'
  let low = 0
  let high = text.length
  let fit = ''
  // binary search for the max substring that fits
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    const substr = text.slice(0, mid) + ell
    if (ctx.measureText(substr).width <= maxWidth) {
      low = mid + 1
      fit = substr
    } else {
      high = mid
    }
  }
  if (!fit) {
    // fallback: draw ellipsis only
    ctx.fillText(ell, x, y)
  } else {
    ctx.fillText(fit, x, y)
  }
}
