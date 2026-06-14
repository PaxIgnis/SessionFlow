import { expect } from 'vitest'
import { SessionTree } from '@/services/foreground-tree'
import { TreeItem, TreeItemType } from '@/types/session-tree'
import { flattenForegroundItems } from './foreground-tree-fixtures'

export function expectForegroundIndexes(): void {
  const items = flattenForegroundItems(SessionTree.reactiveItems.value)
  const windows = items.filter((item) => item.type === TreeItemType.WINDOW)
  const tabs = items.filter((item) => item.type === TreeItemType.TAB)
  const notes = items.filter((item) => item.type === TreeItemType.NOTE)
  const separators = items.filter(
    (item) => item.type === TreeItemType.SEPARATOR,
  )

  expect(new Set(SessionTree.windowsByUid.keys())).toEqual(
    new Set(windows.map((item) => item.uid)),
  )
  expect(new Set(SessionTree.tabsByUid.keys())).toEqual(
    new Set(tabs.map((item) => item.uid)),
  )
  expect(new Set(SessionTree.notesByUid.keys())).toEqual(
    new Set(notes.map((item) => item.uid)),
  )
  expect(new Set(SessionTree.separatorsByUid.keys())).toEqual(
    new Set(separators.map((item) => item.uid)),
  )

  for (const item of items) {
    expect(indexedItem(item)).toBe(item)
  }
}

function indexedItem(item: TreeItem): TreeItem | undefined {
  if (item.type === TreeItemType.WINDOW) {
    return SessionTree.windowsByUid.get(item.uid)
  }
  if (item.type === TreeItemType.TAB) {
    return SessionTree.tabsByUid.get(item.uid)
  }
  if (item.type === TreeItemType.NOTE) {
    return SessionTree.notesByUid.get(item.uid)
  }
  return SessionTree.separatorsByUid.get(item.uid)
}
