import { i18n, formatList, formatNumber } from '@/services/i18n'
import {
  DropPosition,
  TreeItemType,
  type Tab,
  type TreeItem,
  type Window,
} from '@/types/session-tree'

// Shared presentation and geometry helpers have no dependency on live drag state.
export interface DragImagePreview {
  title: string
  metadata?: string
  body: string[]
}

export const DRAG_IMAGE_MAX_CANVAS_WIDTH = 370

export function getDragImageTextWidth(
  measuredWidth: number,
  padding: number,
): number {
  return Math.min(measuredWidth, DRAG_IMAGE_MAX_CANVAS_WIDTH - padding * 2)
}

export function buildDragImagePreview(items: TreeItem[]): DragImagePreview {
  if (items.length === 0) return { title: '', body: [] }

  const firstItem = items[0]
  if (items.length === 1) {
    if (firstItem.type === TreeItemType.TAB) {
      return {
        title: firstItem.title || i18n.t('tabId', [firstItem.id]),
        body: [firstItem.url || ''],
      }
    }
    if (firstItem.type === TreeItemType.NOTE) {
      return { title: firstItem.text, body: [] }
    }
    if (firstItem.type === TreeItemType.SEPARATOR) {
      return { title: i18n.t('separator'), body: [] }
    }
  }

  let metadata: string | undefined
  const selectedWindows = items.filter(
    (item): item is Window => item.type === TreeItemType.WINDOW,
  )
  if (selectedWindows.length > 0) {
    const windowChildren = selectedWindows.flatMap((window) => window.children)
    const contents = formatItemCounts(windowChildren, [
      TreeItemType.TAB,
      TreeItemType.NOTE,
      TreeItemType.SEPARATOR,
    ])
    metadata = i18n.t('windowContents', [contents || i18n.t('0Items')])
  }

  if (items.length === 1 && firstItem.type === TreeItemType.WINDOW) {
    return {
      title: firstItem.title || i18n.t('windowId', [firstItem.id]),
      metadata,
      body: [],
    }
  }

  const body = items
    .filter((item): item is Tab => item.type === TreeItemType.TAB)
    .map((tab) => tab.url)
    .filter(Boolean)
    .slice(0, 15 - (metadata ? 1 : 0))

  return {
    title: formatItemCounts(items, getFirstOccurrenceTypeOrder(items)),
    ...(metadata ? { metadata } : {}),
    body,
  }
}

function getFirstOccurrenceTypeOrder(items: TreeItem[]): TreeItemType[] {
  return [...new Set(items.map((item) => item.type))]
}

function formatItemCounts(
  items: TreeItem[],
  typeOrder: TreeItemType[],
): string {
  const phrases = typeOrder.flatMap((type) => {
    const count = items.filter((item) => item.type === type).length
    return count > 0 ? [getItemTypeLabel(type, count)] : []
  })
  return formatList(phrases)
}

function getItemTypeLabel(type: TreeItemType, count: number): string {
  if (type === TreeItemType.WINDOW)
    return i18n.t('countWindow', count, [formatNumber(count)])
  if (type === TreeItemType.TAB)
    return i18n.t('countTab', count, [formatNumber(count)])
  if (type === TreeItemType.NOTE)
    return i18n.t('countNote', count, [formatNumber(count)])
  return i18n.t('countSeparator', count, [formatNumber(count)])
}

export function getDropPosition(
  clientY: number,
  rect: Pick<DOMRect, 'top' | 'height'>,
  supportsMiddle: boolean,
): DropPosition {
  const height = rect.height > 0 ? rect.height : 1
  const y = clientY - rect.top

  if (!supportsMiddle) {
    return y < height / 2 ? DropPosition.ABOVE : DropPosition.BELOW
  }
  if (y < height * 0.33) {
    return DropPosition.ABOVE
  }
  if (y > height * 0.66) {
    return DropPosition.BELOW
  }
  return DropPosition.MID
}
