import { SessionTreeDelta } from '@/types/runtime-port-service'
import {
  Note,
  Separator,
  Tab,
  TopLevelTreeItem,
  TreeItem,
  TreeItemType,
  Window,
} from '@/types/session-tree'
import { ref } from 'vue'

function updateObjectProperties<T extends object>(
  target: T,
  source: Partial<T>,
): void {
  Object.entries(source).forEach(([key, value]) => {
    ;(target as Record<string, unknown>)[key] = value
  })
}

function replaceObjectProperties<T extends object>(
  target: T,
  source: Partial<T>,
  preservedKeys: string[] = [],
): void {
  const preserved = new Set(preservedKeys)
  Object.keys(target).forEach((key) => {
    if (
      !preserved.has(key) &&
      !Object.prototype.hasOwnProperty.call(source, key)
    ) {
      delete (target as Record<string, unknown>)[key]
    }
  })
  updateObjectProperties(target, source)
}

function updateTreeItemInPlace(target: TreeItem, source: TreeItem): void {
  if (target.type !== source.type) return

  if (
    target.type === TreeItemType.WINDOW &&
    source.type === TreeItemType.WINDOW
  ) {
    const { children, ...windowProps } = source
    updateObjectProperties(target, windowProps)
    reconcileChildren(target.children as TreeItem[], children as TreeItem[])
    return
  }

  if (target.type === TreeItemType.NOTE && source.type === TreeItemType.NOTE) {
    updateObjectProperties(target, source)
    return
  }

  updateObjectProperties(target, source)
}

function reconcileChildren(
  targetChildren: TreeItem[],
  sourceChildren: TreeItem[],
): void {
  const existingByUid = new Map(
    targetChildren.map((child) => [child.uid, child] as const),
  )
  const nextChildren = sourceChildren.map((sourceChild) => {
    const existingChild = existingByUid.get(sourceChild.uid)
    if (existingChild && existingChild.type === sourceChild.type) {
      updateTreeItemInPlace(existingChild, sourceChild)
      return existingChild
    }
    return structuredClone(sourceChild)
  })

  targetChildren.splice(0, targetChildren.length, ...nextChildren)
}

function indexExistingItems(items: TreeItem[]): Map<UID, TreeItem> {
  const existingByUid = new Map<UID, TreeItem>()
  walk(items, (item) => existingByUid.set(item.uid, item))
  return existingByUid
}

function reconcileSnapshotItem(
  sourceItem: TreeItem,
  existingByUid: Map<UID, TreeItem>,
): TreeItem {
  const existingItem = existingByUid.get(sourceItem.uid)

  if (sourceItem.type === TreeItemType.WINDOW) {
    const { children, ...windowProperties } = sourceItem
    const targetWindow =
      existingItem?.type === TreeItemType.WINDOW
        ? existingItem
        : structuredClone(sourceItem)
    replaceObjectProperties(targetWindow, windowProperties, ['children'])
    const nextChildren = children.map((child) =>
      reconcileSnapshotItem(child, existingByUid),
    ) as Window['children']
    targetWindow.children.splice(
      0,
      targetWindow.children.length,
      ...nextChildren,
    )
    return targetWindow
  }

  if (existingItem && existingItem.type === sourceItem.type) {
    replaceObjectProperties(existingItem, sourceItem)
    return existingItem
  }
  return structuredClone(sourceItem)
}

function reconcileTreeItems(
  targetItems: TreeItem[],
  sourceItems: TreeItem[],
): void {
  const existingByUid = indexExistingItems(targetItems)
  const nextItems = sourceItems.map((sourceItem) =>
    reconcileSnapshotItem(sourceItem, existingByUid),
  )
  targetItems.splice(0, targetItems.length, ...nextItems)
}

function getChildren(item: TreeItem): TreeItem[] {
  if (item.type === TreeItemType.WINDOW) return item.children
  return []
}

function walk(items: TreeItem[], callback: (item: TreeItem) => void): void {
  for (const item of items) {
    callback(item)
    walk(getChildren(item), callback)
  }
}

function findWindow(uid: UID): Window | undefined {
  return SessionTree.windowsByUid.get(uid)
}

function reindexTree(): void {
  SessionTree.windowsByUid.clear()
  SessionTree.tabsByUid.clear()
  SessionTree.notesByUid.clear()
  SessionTree.separatorsByUid.clear()

  walk(SessionTree.reactiveItems.value, (item) => {
    if (item.type === TreeItemType.WINDOW)
      SessionTree.windowsByUid.set(item.uid, item)
    else if (item.type === TreeItemType.TAB)
      SessionTree.tabsByUid.set(item.uid, item)
    else if (item.type === TreeItemType.NOTE)
      SessionTree.notesByUid.set(item.uid, item)
    else SessionTree.separatorsByUid.set(item.uid, item)
  })
}

function replaceSessionTree(newItems: Array<TopLevelTreeItem>): void {
  reconcileTreeItems(
    SessionTree.reactiveItems.value as TreeItem[],
    newItems as TreeItem[],
  )
  reindexTree()
}

function applyDelta(delta: SessionTreeDelta): boolean {
  switch (delta.op) {
    case 'treeReplaced':
      replaceSessionTree(delta.treeItems)
      return true
    case 'windowCreated': {
      if (
        delta.index < 0 ||
        delta.index > SessionTree.reactiveItems.value.length
      ) {
        return false
      }
      const window = structuredClone(delta.window)
      SessionTree.reactiveItems.value.splice(delta.index, 0, window)
      reindexTree()
      return true
    }
    case 'windowRemoved': {
      const index = SessionTree.reactiveItems.value.findIndex(
        (w) => w.uid === delta.windowUid,
      )
      if (index === -1) return false
      SessionTree.reactiveItems.value.splice(index, 1)
      reindexTree()
      return true
    }
    case 'windowUpdated': {
      const existingWindow = SessionTree.windowsByUid.get(delta.window.uid)
      if (!existingWindow) return false
      updateTreeItemInPlace(existingWindow, delta.window)
      reindexTree()
      return true
    }
    case 'tabCreated': {
      const window = findWindow(delta.windowUid)
      if (!window || delta.index < 0 || delta.index > window.children.length)
        return false
      const existingIndex = window.children.findIndex(
        (t) => t.uid === delta.tab.uid,
      )
      if (existingIndex === -1) {
        window.children.splice(delta.index, 0, structuredClone(delta.tab))
      }
      reindexTree()
      return true
    }
    case 'tabRemoved': {
      const window = findWindow(delta.windowUid)
      if (!window) return false
      const index = window.children.findIndex((t) => t.uid === delta.tabUid)
      if (index === -1) return false
      window.children.splice(index, 1)
      reindexTree()
      return true
    }
    case 'tabUpdated': {
      const existingTab = SessionTree.tabsByUid.get(delta.tab.uid)
      if (!existingTab) return false
      updateObjectProperties(existingTab, delta.tab)
      reindexTree()
      return true
    }
    case 'noteCreated':
    case 'noteRemoved':
    case 'separatorCreated':
    case 'separatorRemoved':
      return false
    case 'separatorUpdated': {
      const existingSeparator = SessionTree.separatorsByUid.get(
        delta.separator.uid,
      )
      if (!existingSeparator) return false
      updateTreeItemInPlace(existingSeparator, delta.separator)
      reindexTree()
      return true
    }
    case 'noteUpdated': {
      const existingNote = SessionTree.notesByUid.get(delta.note.uid)
      if (!existingNote) return false
      updateTreeItemInPlace(existingNote, delta.note)
      reindexTree()
      return true
    }
    default:
      return false
  }
}

export const SessionTree = {
  reactiveItems: ref<TopLevelTreeItem[]>([]),
  windowsByUid: new Map<UID, Window>(),
  tabsByUid: new Map<UID, Tab>(),
  notesByUid: new Map<UID, Note>(),
  separatorsByUid: new Map<UID, Separator>(),

  replaceSessionTree(items: TopLevelTreeItem[]) {
    replaceSessionTree(items)
  },
  applyDelta(delta: SessionTreeDelta) {
    return applyDelta(delta)
  },
}
