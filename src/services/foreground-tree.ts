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
  SessionTree.reactiveItems.value = structuredClone(newItems)
  reindexTree()
}

function applyDelta(delta: SessionTreeDelta): void {
  switch (delta.op) {
    case 'treeReplaced':
      replaceSessionTree(delta.treeItems)
      return
    case 'windowCreated': {
      const window = structuredClone(delta.window)
      SessionTree.reactiveItems.value.splice(delta.index, 0, window)
      reindexTree()
      return
    }
    case 'windowRemoved': {
      const index = SessionTree.reactiveItems.value.findIndex(
        (w) => w.uid === delta.windowUid,
      )
      if (index !== -1) {
        SessionTree.reactiveItems.value.splice(index, 1)
        reindexTree()
      }
      return
    }
    case 'windowUpdated': {
      const existingWindow = SessionTree.windowsByUid.get(delta.window.uid)
      if (existingWindow) {
        updateTreeItemInPlace(existingWindow, delta.window)
      }
      reindexTree()
      return
    }
    case 'tabCreated': {
      const window = findWindow(delta.windowUid)
      if (!window) return
      const existingIndex = window.children.findIndex(
        (t) => t.uid === delta.tab.uid,
      )
      if (existingIndex === -1) {
        window.children.splice(delta.index, 0, structuredClone(delta.tab))
      }
      reindexTree()
      return
    }
    case 'tabRemoved': {
      const window = findWindow(delta.windowUid)
      if (!window) return
      const index = window.children.findIndex((t) => t.uid === delta.tabUid)
      if (index !== -1) window.children.splice(index, 1)
      reindexTree()
      return
    }
    case 'tabUpdated': {
      const existingTab = SessionTree.tabsByUid.get(delta.tab.uid)
      if (existingTab) {
        updateObjectProperties(existingTab, delta.tab)
      }
      reindexTree()
      return
    }
    case 'noteCreated':
    case 'noteRemoved':
    case 'separatorCreated':
    case 'separatorRemoved':
      return
    case 'separatorUpdated': {
      const existingSeparator = SessionTree.separatorsByUid.get(
        delta.separator.uid,
      )
      if (existingSeparator)
        updateTreeItemInPlace(existingSeparator, delta.separator)
      reindexTree()
      return
    }
    case 'noteUpdated': {
      const existingNote = SessionTree.notesByUid.get(delta.note.uid)
      if (existingNote) updateTreeItemInPlace(existingNote, delta.note)
      reindexTree()
      return
    }
    default:
      return
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
    applyDelta(delta)
  },
}
