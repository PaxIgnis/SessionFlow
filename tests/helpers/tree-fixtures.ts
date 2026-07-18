import { DeferredEventsQueue } from '@/services/background-deferred-events-queue'
import { Tree } from '@/services/background-tree'
import {
  Note,
  Separator,
  State,
  Tab,
  TreeItemType,
  Window,
} from '@/types/session-tree'

let nextWindowId = 1
let nextTabId = 1

export function resetTree(): void {
  Tree.sessionTreeWindowId = undefined
  Tree.windowPositionInterval = undefined
  Tree.Items = []
  Tree.existingUidsSet = new Set<UID>()
  Tree.tabsByUid = new Map<UID, Tab>()
  Tree.notesByUid = new Map<UID, Note>()
  Tree.separatorsByUid = new Map<UID, Separator>()
  Tree.windowsByUid = new Map<UID, Window>()
  Tree.resetTabGroupState()
  Tree.resetContainerState()
  Tree.initialized = true
  DeferredEventsQueue.windows = new Map()
  DeferredEventsQueue.tabs = new Map()
  nextWindowId = 1
  nextTabId = 1
}

export function createWindow(
  uid: UID,
  children: Array<Tab | Note | Separator> = [],
  overrides: Partial<Window> = {},
): Window {
  const window: Window = {
    type: TreeItemType.WINDOW,
    uid,
    id: nextWindowId++,
    incognito: false,
    selected: false,
    state: State.SAVED,
    children,
    indentLevel: 0,
    ...overrides,
  }

  Tree.Items.push(window)
  Tree.windowsByUid.set(window.uid, window)
  Tree.existingUidsSet.add(window.uid)

  for (const child of children) {
    child.windowUid = window.uid
    indexChild(child)
  }

  return window
}

export function createTab(uid: UID, overrides: Partial<Tab> = {}): Tab {
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

export function createNote(uid: UID, overrides: Partial<Note> = {}): Note {
  return {
    type: TreeItemType.NOTE,
    uid,
    text: uid,
    selected: false,
    windowUid: undefined,
    collapsed: false,
    indentLevel: 1,
    ...overrides,
  }
}

export function createSeparator(
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

function indexChild(child: Tab | Note | Separator): void {
  Tree.existingUidsSet.add(child.uid)
  if (child.type === TreeItemType.TAB) {
    Tree.tabsByUid.set(child.uid, child)
    if (child.tabGroup) Tree.existingUidsSet.add(child.tabGroup.uid)
  } else if (child.type === TreeItemType.NOTE) {
    Tree.notesByUid.set(child.uid, child)
  } else {
    Tree.separatorsByUid.set(child.uid, child)
  }
}
