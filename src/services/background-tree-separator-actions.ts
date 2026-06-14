import { Tree } from '@/services/background-tree'
import { emitTreeDelta } from '@/services/runtime-port-service'
import * as Utils from '@/services/utils'
import {
  Note,
  Separator,
  Tab,
  TreeItem,
  TreeItemType,
  Window,
} from '@/types/session-tree'

export function createSeparator(parentUid?: UID, index?: number): UID {
  const { children, parent } = Tree.getContainerForParent(parentUid)
  if (parent?.type === TreeItemType.SEPARATOR) {
    return ''
  }

  const itemParentUid =
    parent?.type === TreeItemType.WINDOW ? undefined : parentUid
  const separator: Separator = {
    type: TreeItemType.SEPARATOR,
    uid: Utils.createUid(Tree.existingUidsSet),
    selected: false,
    windowUid: Tree.getWindowUidForParent(parent),
    indentLevel: parent ? (parent.indentLevel ?? 0) + 1 : 0,
    parentUid: itemParentUid,
    isVisible: parent ? parent.isVisible !== false && !parent.collapsed : true,
    isParent: false,
    collapsed: false,
  }

  const targetIndex = Tree.getTargetIndex(children, parent, index)
  children.splice(targetIndex, 0, separator)
  Tree.separatorsByUid.set(separator.uid, separator)
  Tree.existingUidsSet.add(separator.uid)
  if (parent) parent.isParent = true

  Tree.recomputeSessionTree(false)
  emitTreeDelta({
    op: 'separatorCreated',
    parentUid: itemParentUid,
    separator: structuredClone(separator),
    index: targetIndex,
  })
  emitTreeDelta({
    op: 'treeReplaced',
    treeItems: structuredClone(Tree.Items),
  })
  return separator.uid
}

export function updateSeparator(
  separatorUid: UID,
  updatedFields: Partial<Separator>,
  emitDelta: boolean = true,
): void {
  const separator = Tree.separatorsByUid.get(separatorUid)
  if (!separator) return
  Object.assign(separator, updatedFields)
  separator.isParent = false
  separator.collapsed = false
  if (emitDelta) {
    emitTreeDelta({
      op: 'separatorUpdated',
      separator: structuredClone(separator),
    })
  }
}

export function createSeparatorBelow(separatorUid: UID): UID | void {
  const location = Tree.findItemLocation(separatorUid)
  if (!location || location.item.type !== TreeItemType.SEPARATOR) return

  const parentUid = location.item.parentUid ?? location.item.windowUid
  return createSeparator(parentUid, location.index + 1)
}

export function separatorIndentIncrease(separatorUids: UID[]): void {
  for (const separatorUid of separatorUids) {
    const location = Tree.findItemLocation(separatorUid)
    if (!location || location.item.type !== TreeItemType.SEPARATOR) continue
    if (location.index === 0) continue

    const previous = findPreviousSiblingAtSameIndent(
      location.children,
      location.index,
      location.item.indentLevel ?? 0,
    )
    if (!canParentSeparator(previous)) continue

    const targetWindowUid =
      previous.type === TreeItemType.WINDOW
        ? previous.uid
        : Tree.getWindowUidForParent(previous)
    const targetIndex =
      previous.type === TreeItemType.WINDOW
        ? previous.children.length
        : location.index

    Tree.moveTreeItems(
      [separatorUid],
      targetIndex,
      previous.uid,
      targetWindowUid,
      false,
      false,
    )
  }
}

function findPreviousSiblingAtSameIndent(
  items: TreeItem[],
  index: number,
  indentLevel: number,
): TreeItem | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const itemIndent = items[i].indentLevel ?? 0
    if (itemIndent === indentLevel) return items[i]
    if (itemIndent < indentLevel) return undefined
  }
  return undefined
}

export function separatorIndentDecrease(separatorUids: UID[]): void {
  for (const separatorUid of separatorUids) {
    const location = Tree.findItemLocation(separatorUid)
    if (!location || location.item.type !== TreeItemType.SEPARATOR) continue

    const separator = location.item
    if (separator.parentUid) {
      decreaseFromItemParent(separator, location.children)
    } else if (separator.windowUid) {
      decreaseFromWindowRoot(separator)
    }
  }
}

function canParentSeparator(
  item: TreeItem | undefined,
): item is Window | Tab | Note {
  return Boolean(item && item.type !== TreeItemType.SEPARATOR)
}

function decreaseFromItemParent(
  separator: Separator,
  containingItems: TreeItem[],
): void {
  if (!separator.parentUid) return
  const parent = Tree.getItemByUid(separator.parentUid)
  if (!parent) return

  const parentIndex = containingItems.findIndex((item) => item.uid === parent.uid)
  if (parentIndex === -1) return
  const targetIndex = subtreeEndIndex(containingItems, parentIndex)
  const targetWindowUid =
    parent.type === TreeItemType.WINDOW ? parent.uid : Tree.getWindowUidForParent(parent)
  const newParentUid =
    parent.type === TreeItemType.WINDOW ? undefined : parent.parentUid

  Tree.moveTreeItems(
    [separator.uid],
    targetIndex,
    newParentUid,
    targetWindowUid,
    false,
    false,
  )
}

function decreaseFromWindowRoot(separator: Separator): void {
  if (!separator.windowUid) return
  const window = Tree.windowsByUid.get(separator.windowUid)
  if (!window) return
  const windowLocation = Tree.findItemLocation(window.uid)
  if (!windowLocation) return
  const separatorLocation = Tree.findItemLocation(separator.uid)
  if (!separatorLocation) return

  separatorLocation.children.splice(separatorLocation.index, 1)
  window.isParent = Tree.hasChildrenInContainer(window, window.children)
  separator.windowUid = undefined
  separator.parentUid = window.parentUid
  separator.indentLevel = window.indentLevel ?? 0
  separator.isVisible = window.isVisible !== false
  if (window.children.length === 0) {
    windowLocation.children.splice(windowLocation.index, 1, separator)
    Tree.windowsByUid.delete(window.uid)
    Tree.existingUidsSet.delete(window.uid)
  } else {
    window.isParent = Tree.hasChildrenInContainer(window, window.children)
    windowLocation.children.splice(windowLocation.index + 1, 0, separator)
  }

  Tree.recomputeSessionTree(false)
  emitTreeDelta({
    op: 'treeReplaced',
    treeItems: structuredClone(Tree.Items),
  })
}

function subtreeEndIndex(items: TreeItem[], parentIndex: number): number {
  const parent = items[parentIndex]
  let index = parentIndex + 1
  while (
    index < items.length &&
    (items[index].indentLevel ?? 0) > (parent.indentLevel ?? 0)
  ) {
    index += 1
  }
  return index
}

export function removeSeparator(separatorUid: UID): void {
  const location = Tree.findItemLocation(separatorUid)
  if (!location || location.item.type !== TreeItemType.SEPARATOR) return

  const window = location.item.windowUid
    ? Tree.windowsByUid.get(location.item.windowUid)
    : undefined
  const oldParentUid = location.item.parentUid
  location.children.splice(location.index, 1)
  Tree.existingUidsSet.delete(location.item.uid)
  Tree.separatorsByUid.delete(location.item.uid)

  const parent = oldParentUid ? Tree.getItemByUid(oldParentUid) : undefined
  if (parent)
    parent.isParent = Tree.hasChildrenInContainer(parent, location.children)

  if (window && window.children.length === 0) {
    Tree.removeWindow(window.uid)
    return
  }

  Tree.recomputeSessionTree(false)
  emitTreeDelta({ op: 'separatorRemoved', separatorUid })
  emitTreeDelta({
    op: 'treeReplaced',
    treeItems: structuredClone(Tree.Items),
  })
}
