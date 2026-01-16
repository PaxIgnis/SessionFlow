import { DragAndDrop } from '@/services/drag-and-drop'
import * as Messages from '@/services/foreground-messages'
import { SessionTree } from '@/services/foreground-tree'
import { Selection } from '@/services/selection'
import { Settings } from '@/services/settings'
import {
  DragInfo,
  DragType,
  DropPosition,
  DropType,
} from '@/types/session-tree'

export function start(dragInfo: DragInfo): void {
  reset()
  console.debug('drag-and-drop-actions.start: Drag started:', dragInfo)
  DragAndDrop.dragState.dragEventStarted = true
  DragAndDrop.dragState.sourceType = dragInfo.dragType
  DragAndDrop.dragInfo = dragInfo
}

export function onDragEnd(e: DragEvent): void {
  reset()
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
    '.drag-and-drop-target'
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
    // TODO: Switch to windowsByUid when implemented in foreground tree
    const window = SessionTree.reactiveWindowsList.value.find(
      (win) => win.uid === id
    )
    if (!window) return
    DragAndDrop.dragState.destinationId = id
  }
}

export function onDragLeave(e: DragEvent): void {
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
    '.drag-and-drop-target'
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
  // if src and drop target is type tab
  if (
    DragAndDrop.dragState.destinationType === DropType.TAB &&
    DragAndDrop.dragState.sourceType === DragType.TAB
  ) {
    const destinationWindow = SessionTree.reactiveWindowsList.value.find(
      (win) => win.tabs.find((tab) => tab.uid === id)
    )
    targetWindowUid = destinationWindow?.uid
    if (!destinationWindow) return
    const destTab = destinationWindow.tabs.find((tab) => tab.uid === id)
    const destTabIndex = destinationWindow.tabs.findIndex(
      (tab) => tab.uid === id
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
      for (let i = destTabIndex + 1; i < destinationWindow.tabs.length; i++) {
        const candidate = destinationWindow.tabs[i]
        if ((candidate.indentLevel ?? 1) <= targetIndent) {
          dropIndex = i
          break
        }
      }
      if (dropIndex === 0) dropIndex = destinationWindow.tabs.length
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
    const destinationWindow = SessionTree.reactiveWindowsList.value.find(
      (win) => win.uid === id
    )
    targetWindowUid = destinationWindow?.uid
    const destinationWindowIndex =
      SessionTree.reactiveWindowsList.value.findIndex((win) => win.uid === id)
    if (destinationWindowIndex === -1 || !destinationWindow) return
    // dropping as window above (src window only)
    if (
      DragAndDrop.dragState.dropPosition === DropPosition.ABOVE &&
      DragAndDrop.dragState.sourceType === DragType.WINDOW
    ) {
      dropIndex = destinationWindowIndex
    }
    // dropping as window below (src window only)
    else if (
      DragAndDrop.dragState.dropPosition === DropPosition.BELOW &&
      DragAndDrop.dragState.sourceType === DragType.WINDOW
    ) {
      dropIndex = destinationWindowIndex + 1
    }
    // dropping as tab in window (mid) (src tab only)
    else if (
      DragAndDrop.dragState.dropPosition === DropPosition.MID &&
      DragAndDrop.dragState.sourceType === DragType.TAB
    ) {
      // TODO: Add setting to control whether new child tabs are added at start or end of children
      dropIndex = 0 // currently always adds as first tab
    }
  }
  // if src is tab and dest is tab or window
  if (
    DragAndDrop.dragState.sourceType === DragType.TAB &&
    (DragAndDrop.dragState.destinationType === DropType.TAB ||
      DragAndDrop.dragState.destinationType === DropType.WINDOW)
  ) {
    if (
      DragAndDrop.dragState.destinationType === DropType.TAB ||
      DragAndDrop.dragState.destinationType === DropType.WINDOW
    ) {
      Messages.moveTabs(
        DragAndDrop.dragInfo!.items.map((tab) => tab.uid),
        targetWindowUid as UID,
        dropIndex,
        dropParentUid,
        false
      )
    }
  }
  // if src is window and dest is window
  else if (
    DragAndDrop.dragState.sourceType === DragType.WINDOW &&
    DragAndDrop.dragState.destinationType === DropType.WINDOW
  ) {
    console.log('Dropping window onto window')
    Messages.moveWindows(
      DragAndDrop.dragInfo!.items.map((win) => win.uid),
      dropIndex,
      false
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
    '.drag-over-above, .drag-over-mid, .drag-over-below'
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
    '.drag-and-drop-target'
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
  }
  DragAndDrop.dragState.destinationType = destType

  // cannot drop onto self
  if (DragAndDrop.dragInfo?.items.find((item) => item.uid === id)) return

  // check if this is a valid drop target
  if (DragAndDrop.dragState.sourceType === DragType.TAB) {
    if (
      DragAndDrop.dragState.destinationType !== DropType.WINDOW &&
      DragAndDrop.dragState.destinationType !== DropType.TAB
    )
      return
  } else if (DragAndDrop.dragState.sourceType === DragType.WINDOW) {
    if (DragAndDrop.dragState.destinationType !== DropType.WINDOW) return
  }

  // used to calculate drop position
  const rect = el.getBoundingClientRect()
  const y = e.clientY - rect.top
  const h = rect.height || 1

  // special case: tab being dragged over window -> always mid
  if (
    DragAndDrop.dragState.sourceType === DragType.TAB &&
    DragAndDrop.dragState.destinationType === DropType.WINDOW
  ) {
    DragAndDrop.dragState.dropPosition = DropPosition.MID
  }
  // special case: window being dragged over window -> never mid
  else if (
    DragAndDrop.dragState.sourceType === DragType.WINDOW &&
    DragAndDrop.dragState.destinationType === DropType.WINDOW
  ) {
    if (y < h / 2) {
      DragAndDrop.dragState.dropPosition = DropPosition.ABOVE
    } else {
      DragAndDrop.dragState.dropPosition = DropPosition.BELOW
    }
  }
  // normal case: tab being dragged over tab
  else {
    // decide drop region: top 33% -> above, bottom 33% -> below, else mid
    if (y < h * 0.33) {
      DragAndDrop.dragState.dropPosition = DropPosition.ABOVE
    } else if (y > h * 0.66) {
      DragAndDrop.dragState.dropPosition = DropPosition.BELOW
    } else {
      DragAndDrop.dragState.dropPosition = DropPosition.MID
    }
  }
  DragAndDrop.dragState.isValidDropTarget = true
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
  maxWidth: number
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
