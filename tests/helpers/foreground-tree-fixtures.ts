import { SessionTree } from '@/services/foreground-tree'
import {
  Note,
  Separator,
  State,
  Tab,
  TopLevelTreeItem,
  TreeItem,
  TreeItemType,
  Window,
} from '@/types/session-tree'

let nextWindowId = 100
let nextTabId = 1000

export function resetForegroundTree(items: TopLevelTreeItem[] = []): void {
  SessionTree.reactiveItems.value = []
  SessionTree.windowsByUid.clear()
  SessionTree.tabsByUid.clear()
  SessionTree.notesByUid.clear()
  SessionTree.separatorsByUid.clear()
  nextWindowId = 100
  nextTabId = 1000
  if (items.length) {
    SessionTree.replaceSessionTree(items)
  }
}

export function makeForegroundWindow(
  uid: UID,
  children: Array<Tab | Note | Separator> = [],
  overrides: Partial<Window> = {},
): Window {
  const window: Window = {
    type: TreeItemType.WINDOW,
    uid,
    id: nextWindowId++,
    selected: false,
    state: State.SAVED,
    children,
    indentLevel: 0,
    ...overrides,
  }
  for (const child of children) {
    child.windowUid = window.uid
  }
  return window
}

export function makeForegroundTab(
  uid: UID,
  overrides: Partial<Tab> = {},
): Tab {
  return {
    type: TreeItemType.TAB,
    uid,
    active: false,
    id: nextTabId++,
    selected: false,
    state: State.SAVED,
    title: uid,
    url: `https://example.test/${uid}`,
    windowUid: '' as UID,
    indentLevel: 1,
    pinned: false,
    ...overrides,
  }
}

export function makeForegroundNote(
  uid: UID,
  overrides: Partial<Note> = {},
): Note {
  return {
    type: TreeItemType.NOTE,
    uid,
    text: uid,
    selected: false,
    collapsed: false,
    indentLevel: 1,
    ...overrides,
  }
}

export function makeForegroundSeparator(
  uid: UID,
  overrides: Partial<Separator> = {},
): Separator {
  return {
    type: TreeItemType.SEPARATOR,
    uid,
    selected: false,
    windowUid: undefined,
    indentLevel: 1,
    isParent: false,
    collapsed: false,
    ...overrides,
  }
}

export function flattenForegroundItems(items: TreeItem[]): TreeItem[] {
  const flattened: TreeItem[] = []
  for (const item of items) {
    flattened.push(item)
    if (item.type === TreeItemType.WINDOW) {
      flattened.push(...flattenForegroundItems(item.children))
    }
  }
  return flattened
}
