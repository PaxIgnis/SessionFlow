import {
  buildDragImagePreview,
  getDropPosition,
} from './drag-and-drop-presentation'
import type { OnboardingExampleItem } from '@/types/onboarding-demo'
import {
  DropPosition,
  State,
  TreeItemType,
  type TreeItem,
  type WindowChild,
} from '@/types/session-tree'

export interface DemoPoint {
  x: number
  y: number
}

/** Animate only the example pointer. Abort settles pending work on navigation. */
export function moveDemoPointer(
  from: DemoPoint,
  to: DemoPoint,
  duration: number,
  update: (point: DemoPoint) => void,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false)
      return
    }
    let frame = 0
    const started = performance.now()
    const abort = () => {
      cancelAnimationFrame(frame)
      resolve(false)
    }
    signal.addEventListener('abort', abort, { once: true })
    const tick = (time: number) => {
      if (signal.aborted) return
      const progress = Math.min(1, Math.max(0, (time - started) / duration))
      const eased = progress * progress * (3 - 2 * progress)
      update({
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
      })
      if (progress < 1) frame = requestAnimationFrame(tick)
      else {
        signal.removeEventListener('abort', abort)
        resolve(true)
      }
    }
    frame = requestAnimationFrame(tick)
  })
}

export function demoPause(
  duration: number,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false)
      return
    }
    const abort = () => {
      clearTimeout(timer)
      resolve(false)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve(true)
    }, duration)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export function demoDropHighlight(
  point: DemoPoint,
  rect: DOMRect,
): 'above' | 'mid' | 'below' | undefined {
  if (
    point.x < rect.left ||
    point.x > rect.right ||
    point.y < rect.top ||
    point.y > rect.bottom
  )
    return undefined
  const position = getDropPosition(point.y, rect, true)
  return position === DropPosition.ABOVE
    ? 'above'
    : position === DropPosition.BELOW
      ? 'below'
      : 'mid'
}

export function exampleDragPreview(
  item: OnboardingExampleItem,
  items: readonly OnboardingExampleItem[],
  selectedIds?: readonly string[],
) {
  function project(source: OnboardingExampleItem): TreeItem {
    const common = {
      uid: source.id as UID,
      selected: false,
      indentLevel: source.indentLevel,
    }
    const state =
      source.state === 'saved'
        ? State.SAVED
        : source.state === 'unloaded'
          ? State.DISCARDED
          : State.OPEN
    if (source.kind === 'tab')
      return {
        ...common,
        type: TreeItemType.TAB,
        id: 0,
        state,
        title: source.title,
        url: source.url || 'https://example.org/reference',
        windowUid: 'example-window' as UID,
        pinned: false,
      }
    if (source.kind === 'note')
      return { ...common, type: TreeItemType.NOTE, text: source.title }
    if (source.kind === 'separator')
      return { ...common, type: TreeItemType.SEPARATOR }
    const children: WindowChild[] = []
    for (let index = items.indexOf(source) + 1; index < items.length; index++) {
      const child = items[index]
      if (child.indentLevel <= source.indentLevel) break
      if (child.kind !== 'window') children.push(project(child) as WindowChild)
    }
    return {
      ...common,
      type: TreeItemType.WINDOW,
      id: 0,
      state,
      incognito: false,
      title: source.title,
      children,
    }
  }
  return buildDragImagePreview(
    selectedIds
      ? items.filter((source) => selectedIds.includes(source.id)).map(project)
      : [project(item)],
  )
}
