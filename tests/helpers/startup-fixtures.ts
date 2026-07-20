import { vi } from 'vitest'
import { STORAGE_KEY } from '@/defaults/constants'
import { State, Tab, TreeItemType, Window } from '@/types/session-tree'

export function storedTab(uid: string, overrides: Partial<Tab> = {}): Tab {
  return {
    type: TreeItemType.TAB,
    uid: uid as UID,
    active: false,
    id: 0,
    selected: false,
    state: State.OPEN,
    title: uid,
    url: `https://example.test/${uid}`,
    windowUid: '' as UID,
    indentLevel: 1,
    pinned: false,
    ...overrides,
  }
}

export function storedWindow(
  uid: string,
  children: Tab[] = [],
  overrides: Partial<Window> = {},
): Window {
  const window: Window = {
    type: TreeItemType.WINDOW,
    uid: uid as UID,
    id: 0,
    incognito: false,
    selected: false,
    state: State.OPEN,
    children,
    indentLevel: 0,
    ...overrides,
  }
  for (const child of children) child.windowUid = window.uid
  return window
}

export function liveTab(
  id: number,
  windowId: number,
  index: number,
  overrides: Partial<browser.tabs.Tab> = {},
): browser.tabs.Tab {
  return {
    id,
    windowId,
    index,
    active: index === 0,
    discarded: false,
    pinned: false,
    title: `tab-${id}`,
    url: `https://example.test/tab-${id}`,
    ...overrides,
  } as browser.tabs.Tab
}

export function liveWindow(
  id: number,
  tabs: browser.tabs.Tab[],
  overrides: Partial<browser.windows.Window> = {},
): browser.windows.Window {
  return {
    id,
    incognito: false,
    focused: false,
    tabs,
    ...overrides,
  } as browser.windows.Window
}

export function mockStoredTree(items: unknown): void {
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    [STORAGE_KEY]: structuredClone(items),
  })
}
