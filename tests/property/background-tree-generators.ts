import fc from 'fast-check'
import { Tree } from '@/services/background-tree'
import { Note, Tab, TreeItem, Window, WindowChild } from '@/types/session-tree'
import {
  createNote,
  createTab,
  createWindow,
} from '../helpers/tree-fixtures'

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

export const smallWindowSpecsArbitrary: fc.Arbitrary<GeneratedWindowSpec[]> =
  fc.array(windowChildDraftsArbitrary(), {
    minLength: 1,
    maxLength: maxWindows,
  }).map((windowChildren) =>
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

export function allWindowChildren(): WindowChild[] {
  return Tree.Items.flatMap((item) =>
    Tree.isWindow(item) ? item.children : [],
  )
}

export function allTabs(): Tab[] {
  return allWindowChildren().filter((child): child is Tab => Tree.isTab(child))
}

export function allNotes(): Note[] {
  return allWindowChildren().filter((child): child is Note => Tree.isNote(child))
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
