import fc from 'fast-check'
import { Tree } from '@/services/background-tree'
import {
  Note,
  Separator,
  State,
  Tab,
  TopLevelTreeItem,
  TreeItem,
  TreeItemType,
  Window,
  WindowChild,
} from '@/types/session-tree'
import {
  createNote,
  createSeparator,
  createTab,
  createWindow,
} from '../helpers/tree-fixtures'

export interface GeneratedTreeSpec {
  topLevel: GeneratedTopLevelSpec[]
  activeWindowIndex: number
  activeTabIndex: number
}

export interface GeneratedTopLevelSpec {
  kind: 'window' | 'note' | 'separator'
  parentOffset?: number
  state: State
  collapsed: boolean
  children: GeneratedRichChildSpec[]
}

export interface GeneratedRichChildSpec {
  kind: 'tab' | 'note' | 'separator'
  parentOffset?: number
  state: State
  pinned: boolean
  collapsed: boolean
  grouped: boolean
}

export interface GeneratedWindowSpec {
  uid: UID
  children: GeneratedChildSpec[]
}

export interface GeneratedChildSpec {
  kind: 'tab' | 'note'
  uid: UID
  parentIndex?: number
  pinned?: boolean
}

const maxWindows = 3
const maxRootBlocksPerWindow = 4
const maxDirectChildrenPerRoot = 2

const stateArbitrary = fc.constantFrom(
  State.SAVED,
  State.OPEN,
  State.DISCARDED,
  State.OTHER,
)

const richChildDraftArbitrary: fc.Arbitrary<GeneratedRichChildSpec> = fc.record(
  {
    kind: fc.constantFrom('tab', 'note', 'separator'),
    parentOffset: fc.option(fc.integer({ min: 1, max: 50 }), {
      nil: undefined,
    }),
    state: stateArbitrary,
    pinned: fc.boolean(),
    collapsed: fc.boolean(),
    grouped: fc.boolean(),
  },
)

const richTopLevelDraftArbitrary: fc.Arbitrary<GeneratedTopLevelSpec> = fc
  .record({
    kind: fc.constantFrom('window', 'note', 'separator'),
    parentOffset: fc.option(fc.integer({ min: 1, max: 50 }), {
      nil: undefined,
    }),
    state: stateArbitrary,
    collapsed: fc.boolean(),
    children: fc.array(richChildDraftArbitrary, {
      minLength: 0,
      maxLength: 20,
    }),
  })
  .map((spec) => ({
    ...spec,
    children: spec.kind === 'window' ? spec.children : [],
  }))

export const richTreeSpecArbitrary: fc.Arbitrary<GeneratedTreeSpec> = fc.record(
  {
    topLevel: fc.array(richTopLevelDraftArbitrary, {
      minLength: 1,
      maxLength: 8,
    }),
    activeWindowIndex: fc.nat(),
    activeTabIndex: fc.nat(),
  },
)

export const smallWindowSpecsArbitrary: fc.Arbitrary<GeneratedWindowSpec[]> = fc
  .array(windowChildDraftsArbitrary(), {
    minLength: 1,
    maxLength: maxWindows,
  })
  .map((windowChildren) =>
    windowChildren.map((children, windowIndex) => ({
      uid: `window-${windowIndex}` as UID,
      children: children.map((child, childIndex) => ({
        ...child,
        uid: childUid(windowIndex, childIndex),
      })),
    })),
  )

export function materializeWindows(specs: GeneratedWindowSpec[]): Window[] {
  const windows = specs.map((spec) => {
    const children = materializeChildren(spec.children)
    return createWindow(spec.uid, children)
  })

  Tree.recomputeSessionTree(false)
  return windows
}

export function materializeTree(spec: GeneratedTreeSpec): TopLevelTreeItem[] {
  const topLevel: TopLevelTreeItem[] = []

  for (const [index, itemSpec] of spec.topLevel.entries()) {
    const uid = `top-${index}` as UID
    const parent = resolveEarlierParent(
      topLevel,
      itemSpec.parentOffset,
      (item) => item.type === TreeItemType.NOTE,
    )
    let item: TopLevelTreeItem

    if (itemSpec.kind === 'window') {
      item = createWindow(
        uid,
        materializeRichChildren(index, itemSpec.children),
        {
          state: itemSpec.state,
          collapsed: itemSpec.collapsed,
        },
      )
    } else if (itemSpec.kind === 'note') {
      item = createNote(uid, {
        collapsed: itemSpec.collapsed,
        indentLevel: 0,
      })
    } else {
      item = createSeparator(uid, { indentLevel: 0 })
    }

    if (parent) item.parentUid = parent.uid
    topLevel.push(item)
  }

  setParentFlags(topLevel)
  for (const item of topLevel) {
    if (item.type === TreeItemType.WINDOW) setParentFlags(item.children)
  }
  Tree.Items = topLevel
  rebuildGeneratedIndexes()
  setGeneratedActiveIdentity(spec)
  Tree.recomputeSessionTree(false)
  return topLevel
}

export function allWindowChildren(): WindowChild[] {
  return Tree.Items.flatMap((item) =>
    Tree.isWindow(item) ? item.children : [],
  )
}

export function allTabs(): Tab[] {
  return allWindowChildren().filter((child): child is Tab => Tree.isTab(child))
}

export function allNotes(): Note[] {
  return [...Tree.notesByUid.values()]
}

function materializeRichChildren(
  windowIndex: number,
  specs: GeneratedRichChildSpec[],
): WindowChild[] {
  const children: WindowChild[] = []

  for (const [index, spec] of specs.entries()) {
    const uid = `child-${windowIndex}-${index}` as UID
    const parent = resolveEarlierParent(
      children,
      spec.parentOffset,
      (item) => item.type !== TreeItemType.SEPARATOR,
    )
    let child: WindowChild

    if (spec.kind === 'tab') {
      child = createTab(uid, {
        state: spec.state,
        pinned: spec.pinned,
        collapsed: spec.collapsed,
        tabGroup: spec.grouped
          ? {
              uid: `group-${windowIndex}-${Math.floor(index / 3)}` as UID,
              id: spec.state === State.OPEN ? index + 1 : -1,
              color: 'blue',
              collapsed: spec.collapsed,
            }
          : undefined,
      })
    } else if (spec.kind === 'note') {
      child = createNote(uid, { collapsed: spec.collapsed })
    } else {
      child = createSeparator(uid)
    }

    if (parent) child.parentUid = parent.uid
    children.push(child)
  }

  return children
}

function resolveEarlierParent<T extends TreeItem>(
  items: T[],
  parentOffset: number | undefined,
  canParent: (item: T) => boolean,
): T | undefined {
  if (parentOffset === undefined) return undefined
  const candidates = items.filter(canParent).slice(-50)
  if (candidates.length === 0) return undefined
  return candidates[(parentOffset - 1) % candidates.length]
}

function rebuildGeneratedIndexes(): void {
  Tree.windowsByUid.clear()
  Tree.tabsByUid.clear()
  Tree.notesByUid.clear()
  Tree.separatorsByUid.clear()
  Tree.existingUidsSet.clear()

  for (const item of Tree.Items) {
    indexGeneratedItem(item)
    if (item.type === TreeItemType.WINDOW) {
      for (const child of item.children) {
        child.windowUid = item.uid
        indexGeneratedItem(child)
      }
    }
  }
}

function indexGeneratedItem(item: TreeItem): void {
  Tree.existingUidsSet.add(item.uid)
  if (item.type === TreeItemType.WINDOW) Tree.windowsByUid.set(item.uid, item)
  else if (item.type === TreeItemType.TAB) {
    Tree.tabsByUid.set(item.uid, item)
    if (item.tabGroup) Tree.existingUidsSet.add(item.tabGroup.uid)
  } else if (item.type === TreeItemType.NOTE)
    Tree.notesByUid.set(item.uid, item)
  else Tree.separatorsByUid.set(item.uid, item)
}

function setGeneratedActiveIdentity(spec: GeneratedTreeSpec): void {
  const openWindows = [...Tree.windowsByUid.values()].filter(
    (window) => window.state === State.OPEN,
  )
  const activeWindow = openWindows[spec.activeWindowIndex % openWindows.length]

  for (const window of Tree.windowsByUid.values()) {
    window.active = window === activeWindow
    const openTabs = window.children.filter(
      (child): child is Tab =>
        child.type === TreeItemType.TAB && child.state === State.OPEN,
    )
    const activeTab =
      window === activeWindow
        ? openTabs[spec.activeTabIndex % openTabs.length]
        : undefined
    for (const tab of window.children) {
      if (tab.type === TreeItemType.TAB) tab.active = tab === activeTab
    }
    window.activeTabId = activeTab?.id

    const savedTabs = window.children.filter(
      (child): child is Tab =>
        child.type === TreeItemType.TAB && child.state !== State.OPEN,
    )
    window.savedActiveTabUid =
      window.state === State.SAVED && savedTabs.length > 0
        ? savedTabs[spec.activeTabIndex % savedTabs.length].uid
        : undefined
  }
}

function windowChildDraftsArbitrary(): fc.Arbitrary<
  Array<Omit<GeneratedChildSpec, 'uid'>>
> {
  return fc
    .array(rootBlockArbitrary(), {
      minLength: 1,
      maxLength: maxRootBlocksPerWindow,
    })
    .map((blocks) => {
      const children: Array<Omit<GeneratedChildSpec, 'uid'>> = []
      for (const block of blocks) {
        const parentIndex = children.length
        children.push({
          kind: block.root.kind,
          pinned: block.root.pinned,
        })

        for (const child of block.children) {
          children.push({
            kind: child.kind,
            parentIndex,
            pinned: child.pinned,
          })
        }
      }

      return children
    })
}

function rootBlockArbitrary(): fc.Arbitrary<{
  root: GeneratedChildDraft
  children: GeneratedChildDraft[]
}> {
  return fc.record({
    root: childDraftArbitrary(),
    children: fc.array(childDraftArbitrary(), {
      minLength: 0,
      maxLength: maxDirectChildrenPerRoot,
    }),
  })
}

function childDraftArbitrary(): fc.Arbitrary<GeneratedChildDraft> {
  return fc.oneof(
    fc.constant({ kind: 'note' as const }),
    fc.record({
      kind: fc.constant('tab' as const),
      pinned: fc.boolean(),
    }),
  )
}

function materializeChildren(specs: GeneratedChildSpec[]): WindowChild[] {
  const children: WindowChild[] = []

  for (const spec of specs) {
    const parent = getParent(spec, children)
    const indentLevel = parent ? parent.indentLevel + 1 : 1
    const child =
      spec.kind === 'tab'
        ? createGeneratedTab(spec, parent?.uid, indentLevel)
        : createGeneratedNote(spec, parent?.uid, indentLevel)

    if (parent) parent.isParent = true
    children.push(child)
  }

  setParentFlags(children)
  return children
}

function createGeneratedTab(
  spec: GeneratedChildSpec,
  parentUid: UID | undefined,
  indentLevel: number,
): Tab {
  const overrides: Partial<Tab> = {
    indentLevel,
    pinned: spec.pinned ?? false,
  }
  if (parentUid) overrides.parentUid = parentUid
  return createTab(spec.uid, overrides)
}

function createGeneratedNote(
  spec: GeneratedChildSpec,
  parentUid: UID | undefined,
  indentLevel: number,
): Note {
  const overrides: Partial<Note> = { indentLevel }
  if (parentUid) overrides.parentUid = parentUid
  return createNote(spec.uid, overrides)
}

function getParent(
  spec: GeneratedChildSpec,
  children: WindowChild[],
): WindowChild | undefined {
  if (spec.parentIndex === undefined) return undefined
  return children[spec.parentIndex]
}

function setParentFlags(items: TreeItem[]): void {
  for (const item of items) {
    item.isParent = items.some((candidate) => candidate.parentUid === item.uid)
  }
}

function childUid(windowIndex: number, childIndex: number): UID {
  return `item-${windowIndex}-${childIndex}` as UID
}

interface GeneratedChildDraft {
  kind: 'tab' | 'note'
  pinned?: boolean
}
