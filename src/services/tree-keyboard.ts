import { nextTick, watch } from 'vue'
import * as Messages from '@/services/foreground-messages'
import { SessionTree } from '@/services/foreground-tree'
import { Selection } from '@/services/selection'
import {
  getLogicalTreeOrder,
  collectContextMenuActionItems,
} from '@/services/selection-actions'
import { Settings } from '@/services/settings'
import { matchingTreeShortcut } from '@/services/keyboard-shortcuts'
import {
  collectSelectedDragItems,
  shouldIncludeDescendantsForDrop,
} from '@/services/drag-and-drop-actions'
import {
  canDecreaseIndentSelectedItems,
  canIncreaseIndentSelectedItems,
} from '@/services/context-menu-actions'
import {
  ModalState,
  openEditCustomLabelModal,
  openEditNoteModal,
  openEditWindowTitleModal,
} from '@/services/modal-state'
import { showNotification } from '@/services/notification-state'
import { i18n } from '@/services/i18n'
import {
  DragType,
  State,
  SelectionType,
  TreeItemType,
  type TreeItem,
  type Tab,
  type Window,
} from '@/types/session-tree'
import type { TreeShortcutKey } from '@/types/keyboard'

function currentItem(): TreeItem | undefined {
  const selected = Selection.selectedItems.value
  const uid =
    selected.find(({ item }) => item.uid === Selection.anchor.value?.uid)?.item
      .uid ?? selected.at(-1)?.item.uid
  return getLogicalTreeOrder().find((item) => item.uid === uid)
}

export function selectKeyboardItem(item: TreeItem): void {
  Selection.clearSelection()
  item.selected = true
  const type =
    item.type === TreeItemType.WINDOW
      ? SelectionType.WINDOW
      : item.type === TreeItemType.TAB
        ? SelectionType.TAB
        : item.type === TreeItemType.NOTE
          ? SelectionType.NOTE
          : SelectionType.SEPARATOR
  Selection.selectedItems.value = [{ item, type }]
  Selection.anchor.value = item
  void nextTick(() => {
    if (typeof document === 'undefined') return
    const row = document.querySelector<HTMLElement>(
      `[drag-and-drop-id="${CSS.escape(item.uid)}"]`,
    )
    row?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: 'nearest' })
  })
}

export function navigationTarget(
  item: TreeItem,
  key: string,
  visible: readonly TreeItem[],
  openTabsOnly = false,
): TreeItem | undefined {
  const index = visible.findIndex((candidate) => candidate.uid === item.uid)
  if (index < 0) return undefined
  if (key === 'ArrowLeft') {
    const parentUid =
      item.parentUid ??
      (item.type !== TreeItemType.WINDOW ? item.windowUid : undefined)
    return visible.find((candidate) => candidate.uid === parentUid)
  }
  if (key === 'ArrowRight') {
    const next = visible[index + 1]
    return next && (next.indentLevel ?? 0) > (item.indentLevel ?? 0)
      ? next
      : undefined
  }
  const direction = key === 'ArrowUp' ? -1 : 1
  for (let offset = 1; offset <= visible.length; offset++) {
    const cursor =
      (index + direction * offset + visible.length) % visible.length
    const candidate = visible[cursor]
    if (
      !openTabsOnly ||
      (candidate.type === TreeItemType.TAB &&
        candidate.state !== State.SAVED &&
        candidate.state !== State.OTHER)
    )
      return candidate
  }
  return undefined
}

interface KeyboardMove {
  targetIndex: number
  parentUid?: UID
  targetWindowUid?: UID
}

/** Match a drag above/below a sibling without ever making the item deeper. */
export function keyboardMoveTarget(
  item: TreeItem,
  direction: -1 | 1,
): KeyboardMove | undefined {
  const windowUid =
    item.type !== TreeItemType.WINDOW ? item.windowUid : undefined
  const list: TreeItem[] = windowUid
    ? (SessionTree.windowsByUid.get(windowUid)?.children ?? [])
    : SessionTree.reactiveItems.value
  const index = list.findIndex((candidate) => candidate.uid === item.uid)
  if (index < 0) return undefined
  const indent = item.indentLevel ?? 0
  for (
    let cursor = index + direction;
    cursor >= 0 && cursor < list.length;
    cursor += direction
  ) {
    const candidate = list[cursor]
    if ((candidate.indentLevel ?? 0) > indent) continue
    if (
      (candidate.indentLevel ?? 0) < indent ||
      candidate.parentUid !== item.parentUid
    )
      break
    let targetIndex = cursor
    if (direction === 1) {
      targetIndex++
      while (
        targetIndex < list.length &&
        (list[targetIndex].indentLevel ?? 0) > indent
      )
        targetIndex++
    }
    return {
      targetIndex,
      parentUid: item.parentUid,
      targetWindowUid: windowUid,
    }
  }
  // At a boundary, move outside the current parent. Tabs stay in a window.
  const parent = list.find((candidate) => candidate.uid === item.parentUid)
  if (!parent) {
    if (!windowUid || item.type === TreeItemType.TAB) return undefined
    const window = SessionTree.windowsByUid.get(windowUid)
    const roots = SessionTree.reactiveItems.value
    const windowIndex = roots.findIndex(
      (candidate) => candidate.uid === windowUid,
    )
    if (!window || windowIndex < 0) return undefined
    let targetIndex = windowIndex
    if (direction === 1) {
      targetIndex++
      while (
        targetIndex < roots.length &&
        roots[targetIndex].indentLevel > window.indentLevel
      )
        targetIndex++
    }
    return {
      targetIndex,
      parentUid: window.parentUid,
      targetWindowUid: undefined,
    }
  }
  const parentIndex = list.indexOf(parent)
  let targetIndex = parentIndex
  if (direction === 1) {
    targetIndex++
    while (
      targetIndex < list.length &&
      (list[targetIndex].indentLevel ?? 0) > (parent.indentLevel ?? 0)
    )
      targetIndex++
  }
  return {
    targetIndex,
    parentUid: parent.parentUid,
    targetWindowUid: windowUid,
  }
}

function selectedForScope(scope: 'always' | 'collapsed' | 'never'): TreeItem[] {
  const items = collectContextMenuActionItems(
    Selection.selectedItems.value.map(({ item }) => item),
    scope,
  )
  const windows = new Set(
    items
      .filter((item) => item.type === TreeItemType.WINDOW)
      .map((item) => item.uid),
  )
  return items.filter(
    (item) =>
      item.type === TreeItemType.WINDOW ||
      !item.windowUid ||
      !windows.has(item.windowUid),
  )
}

async function runShortcut(
  key: TreeShortcutKey,
  item?: TreeItem,
): Promise<void> {
  if (key === 'shortcutAddNote' || key === 'shortcutAddSeparator') {
    const create =
      key === 'shortcutAddNote' ? Messages.createNote : Messages.createSeparator
    if (item?.type === TreeItemType.SEPARATOR) {
      const list = item.windowUid
        ? (SessionTree.windowsByUid.get(item.windowUid)?.children ?? [])
        : SessionTree.reactiveItems.value
      create(
        item.parentUid ?? item.windowUid,
        list.findIndex((candidate) => candidate.uid === item.uid) + 1,
      )
    } else if (item) create(item.uid)
    else create(undefined, SessionTree.reactiveItems.value.length)
    return
  }
  if (!item) return
  if (key === 'shortcutActivate') {
    if (item.type === TreeItemType.NOTE) openEditNoteModal(item)
    else if (item.type !== TreeItemType.SEPARATOR)
      await Messages.treeItemDoubleClick(item)
  } else if (key === 'shortcutCollapse') {
    if (item.type === TreeItemType.WINDOW)
      Messages.toggleCollapseWindow(item.uid)
    else if (item.isParent && item.type === TreeItemType.TAB)
      Messages.toggleCollapseTab(item.uid)
    else if (item.isParent && item.type === TreeItemType.NOTE)
      Messages.toggleCollapseNote(item.uid)
  } else if (key === 'shortcutEdit') {
    if (item.type === TreeItemType.WINDOW) openEditWindowTitleModal(item)
    else if (item.type === TreeItemType.TAB)
      openEditCustomLabelModal(item.uid, item.customLabel)
    else if (item.type === TreeItemType.NOTE) openEditNoteModal(item)
  } else if (key === 'shortcutClose') {
    // Match each row's delete button; its children are handled by the command.
    for (const target of selectedForScope('never')) {
      if (target.type === TreeItemType.WINDOW)
        await Messages.closeWindow(target.id, target.uid)
      else if (target.type === TreeItemType.TAB)
        await Messages.closeTab(target.id, target.uid)
      else if (target.type === TreeItemType.NOTE)
        Messages.removeNote(target.uid)
      else if (target.type === TreeItemType.SEPARATOR)
        Messages.removeSeparator(target.uid)
    }
  } else if (key === 'shortcutSave') {
    const targets = selectedForScope(Settings.values.contextMenuSaveDescendants)
    await Messages.saveWindows(
      targets.filter(
        (target): target is Window =>
          target.type === TreeItemType.WINDOW && target.state !== State.SAVED,
      ),
    )
    await Messages.saveTabs(
      targets.filter(
        (target): target is Tab =>
          target.type === TreeItemType.TAB && target.state !== State.SAVED,
      ),
    )
  } else if (key === 'shortcutReload') {
    const tabs = collectContextMenuActionItems(
      Selection.getSelectedTabs(),
      Settings.values.contextMenuReloadDescendants,
    ).filter((target): target is Tab => target.type === TreeItemType.TAB)
    await Messages.reloadTabs(tabs)
  } else if (key === 'shortcutPin') {
    const tabs = collectContextMenuActionItems(
      Selection.getSelectedTabs(),
      Settings.values.contextMenuPinDescendants,
    ).filter((target): target is Tab => target.type === TreeItemType.TAB)
    if (tabs.every((tab) => tab.pinned)) await Messages.unpinTabs(tabs)
    else await Messages.pinTabs(tabs)
  }
}

export async function handleTreeKeydown(
  event: KeyboardEvent,
  visible: readonly TreeItem[],
): Promise<void> {
  if (event.defaultPrevented || event.isComposing || ModalState.active) return
  const target = event.target as HTMLElement | null
  if (
    target?.closest?.(
      'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="dialog"]',
    )
  )
    return
  const item = currentItem()
  if (
    event.key.startsWith('Arrow') &&
    !event.shiftKey &&
    !event.metaKey &&
    !(event.ctrlKey && event.altKey)
  ) {
    const focusedUid = target
      ?.closest('[drag-and-drop-id]')
      ?.getAttribute('drag-and-drop-id')
    const navigationItem =
      item ??
      (!event.ctrlKey
        ? visible.find((candidate) => candidate.uid === focusedUid)
        : undefined)
    if (!navigationItem) return
    if (event.altKey && !['ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    if (event.ctrlKey) {
      const items = Selection.selectedItems.value.map(({ item }) => item)
      if (event.key === 'ArrowRight' && canIncreaseIndentSelectedItems(items))
        Messages.treeItemIndentIncrease(items.map((item) => item.uid))
      else if (
        event.key === 'ArrowLeft' &&
        canDecreaseIndentSelectedItems(items)
      )
        Messages.treeItemIndentDecrease(items.map((item) => item.uid))
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const moving = collectSelectedDragItems(
          navigationItem,
          items,
          Settings.values.includeSelectedItemsWithDraggedItem,
        )
        const windowUid =
          navigationItem.type === TreeItemType.WINDOW
            ? undefined
            : navigationItem.windowUid
        // A keyboard step moves selected siblings together. Mixed hierarchies
        // still have the explicit drag-and-drop path for choosing a destination.
        if (
          moving.some(
            (candidate) =>
              candidate.parentUid !== navigationItem.parentUid ||
              candidate.indentLevel !== navigationItem.indentLevel ||
              (candidate.type === TreeItemType.WINDOW
                ? undefined
                : candidate.windowUid) !== windowUid,
          )
        )
          return
        const ordered = getLogicalTreeOrder().filter((candidate) =>
          moving.some((selected) => selected.uid === candidate.uid),
        )
        const edge = event.key === 'ArrowUp' ? ordered[0] : ordered.at(-1)
        if (!edge) return
        const move = keyboardMoveTarget(edge, event.key === 'ArrowUp' ? -1 : 1)
        if (move) {
          const dragType = moving.some(
            (item) => item.type === TreeItemType.WINDOW,
          )
            ? DragType.WINDOW
            : moving.some((item) => item.type === TreeItemType.TAB)
              ? DragType.TAB
              : moving.some((item) => item.type === TreeItemType.NOTE)
                ? DragType.NOTE
                : DragType.SEPARATOR
          await Messages.moveTreeItems(
            ordered.map((item) => item.uid),
            move.targetIndex,
            move.parentUid,
            move.targetWindowUid,
            false,
            shouldIncludeDescendantsForDrop(dragType, moving),
          )
        }
      }
    } else {
      const next = navigationTarget(
        navigationItem,
        event.key,
        visible,
        event.altKey,
      )
      if (next) selectKeyboardItem(next)
    }
    return
  }
  const shortcut = matchingTreeShortcut(event, Settings.values)
  if (!shortcut) return
  if (!item && !['shortcutAddNote', 'shortcutAddSeparator'].includes(shortcut))
    return
  event.preventDefault()
  if (event.repeat) return
  await runShortcut(shortcut, item)
}

export function setupTreeKeyboard(
  getVisible: () => readonly TreeItem[],
): () => void {
  let disposed = false
  // Capture focus before Vue removes or moves the row. Focus is separate from
  // selection: deleting an item must not select another item for deletion.
  const stopFocusWatch = watch(
    () => getVisible().map((item) => item.uid),
    (uids, previousUids) => {
      if (typeof document === 'undefined' || ModalState.active) return
      const focused = document.activeElement as HTMLElement | null
      const uid = focused
        ?.closest('[drag-and-drop-id]')
        ?.getAttribute('drag-and-drop-id') as UID | undefined
      if (!uid) return
      const index = previousUids.indexOf(uid)
      if (index < 0) return
      const surviving = new Set(uids)
      const nextUid = [
        uid,
        ...previousUids.slice(index + 1),
        ...previousUids.slice(0, index).reverse(),
      ].find((candidate) => surviving.has(candidate))
      if (!nextUid) return
      void nextTick(() => {
        if (
          disposed ||
          ModalState.active ||
          (document.activeElement !== focused &&
            document.activeElement !== document.body)
        )
          return
        const row = document.querySelector<HTMLElement>(
          `[drag-and-drop-id="${CSS.escape(nextUid)}"]`,
        )
        row?.focus({ preventScroll: true })
        row?.scrollIntoView({ block: 'nearest' })
      })
    },
  )
  let movePending = false
  const listener = (event: KeyboardEvent) => {
    const moving =
      event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    // Sibling moves compute their destination from the foreground order, so
    // wait for the preceding move's delta. Other actions are coordinated by
    // the background and must remain usable while Firefox opens a tab/window.
    if (moving && movePending) return
    if (moving) movePending = true
    void handleTreeKeydown(event, getVisible())
      .catch((error) => {
        console.error('Tree keyboard action failed:', error)
        showNotification(i18n.t('keyboardActionFailed'))
      })
      .finally(() => {
        if (moving) movePending = false
      })
  }
  const notificationListener = (message: unknown) => {
    if (
      message &&
      typeof message === 'object' &&
      'action' in message &&
      message.action === 'keyboard-notification' &&
      'message' in message &&
      typeof message.message === 'string'
    )
      showNotification(message.message)
  }
  browser.runtime.onMessage.addListener(notificationListener)
  window.addEventListener('keydown', listener)
  return () => {
    disposed = true
    stopFocusWatch()
    window.removeEventListener('keydown', listener)
    browser.runtime.onMessage.removeListener(notificationListener)
  }
}
