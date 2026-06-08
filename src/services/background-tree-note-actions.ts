import { Tree } from '@/services/background-tree'
import { emitTreeDelta } from '@/services/runtime-port-service'
import * as Utils from '@/services/utils'
import { Note, TreeItem, TreeItemType, Window } from '@/types/session-tree'

/**
 * Creates a note at the specified position under a parent item or at the top level.
 * Handles top-level notes, window child notes, and notes nested under tabs or notes.
 *
 * @param {UID} [parentUid] - Optional UID of the parent window, tab, or note.
 * @param {number} [index] - Optional index in the containing item list where the note will be inserted.
 * @param {string} [text='New note'] - Text content for the new note.
 * @returns {UID} The UID of the created note.
 */
export function createNote(
  parentUid?: UID,
  index?: number,
  text: string = 'New note',
): UID {
  const { children, parent } = Tree.getContainerForParent(parentUid)
  const itemParentUid =
    parent?.type === TreeItemType.WINDOW ? undefined : parentUid
  const note: Note = {
    type: TreeItemType.NOTE,
    uid: Utils.createUid(Tree.existingUidsSet),
    text,
    selected: false,
    windowUid: Tree.getWindowUidForParent(parent),
    collapsed: false,
    indentLevel: parent ? (parent.indentLevel ?? 0) + 1 : 0,
    parentUid: itemParentUid,
    isVisible: parent ? parent.isVisible !== false && !parent.collapsed : true,
  }

  const targetIndex = Tree.getTargetIndex(children, parent, index)
  children.splice(targetIndex, 0, note)
  Tree.notesByUid.set(note.uid, note)
  Tree.existingUidsSet.add(note.uid)
  if (parent) parent.isParent = true

  Tree.recomputeSessionTree(false)
  emitTreeDelta({
    op: 'noteCreated',
    parentUid: itemParentUid,
    note: structuredClone(note),
    index: targetIndex,
  })
  emitTreeDelta({
    op: 'treeReplaced',
    treeItems: structuredClone(Tree.Items),
  })
  return note.uid
}

/**
 * Updates a note with the provided fields.
 * Emits a note update delta unless disabled.
 *
 * @param {UID} noteUid - The UID of the note to update.
 * @param {Partial<Note>} updatedFields - The note fields to update.
 * @param {boolean} [emitDelta=true] - Whether to emit a note update delta.
 */
export function updateNote(
  noteUid: UID,
  updatedFields: Partial<Note>,
  emitDelta: boolean = true,
): void {
  const note = Tree.notesByUid.get(noteUid)
  if (!note) return
  Object.assign(note, updatedFields)
  if (emitDelta) {
    emitTreeDelta({
      op: 'noteUpdated',
      note: structuredClone(note),
    })
  }
}

/**
 * Updates the text content of a note.
 *
 * @param {UID} noteUid - The UID of the note to update.
 * @param {string} text - The new text content for the note.
 */
export function updateNoteText(noteUid: UID, text: string): void {
  updateNote(noteUid, { text })
}

/**
 * Toggles a note's collapsed state and updates descendant visibility.
 * Handles both top-level note descendants and notes inside windows.
 *
 * @param {UID} noteUid - The UID of the note to collapse or expand.
 */
export function toggleCollapseNote(noteUid: UID): void {
  const note = Tree.notesByUid.get(noteUid)
  if (!note) return
  let window: Window | undefined
  if (note.windowUid) {
    window = Tree.windowsByUid.get(note.windowUid)
    if (!window) {
      console.warn(
        `toggleCollapseNote: window with uid ${note.windowUid} not found`,
      )
      return
    }
  }
  note.collapsed = !note.collapsed
  // set visibility of children in tree and list based on new collapsed state
  if (note.collapsed) {
    if (note.windowUid && window) {
      Tree.setItemChildrenVisibility(note.uid, window.children, false, true)
    } else {
      Tree.setItemChildrenVisibility(
        note.uid,
        Tree.Items as TreeItem[],
        false,
        true,
      )
    }
  } else {
    // before showing children, ensure no ancestor is collapsed
    let ancestorCollapsed = false
    let parentUid = note.parentUid
    while (parentUid !== undefined) {
      const parent = Tree.getItemByUid(parentUid)
      if (!parent) break
      if (parent.collapsed) {
        ancestorCollapsed = true
        break
      }
      parentUid = parent.parentUid
    }
    if (!ancestorCollapsed) {
      if (note.windowUid && window) {
        Tree.setItemChildrenVisibility(note.uid, window.children, true, true)
      } else {
        Tree.setItemChildrenVisibility(
          note.uid,
          Tree.Items as TreeItem[],
          true,
          true,
        )
      }
    }
  }

  Tree.recomputeSessionTree(false)
  emitTreeDelta({
    op: 'noteUpdated',
    note: structuredClone(note),
  })
  emitTreeDelta({
    op: 'treeReplaced',
    treeItems: structuredClone(Tree.Items),
  })
}

/**
 * Removes a note from the session tree.
 * Promotes direct children to the removed note's parent and removes an empty containing window.
 *
 * @param {UID} noteUid - The UID of the note to remove.
 */
export function removeNote(noteUid: UID): void {
  const location = Tree.findItemLocation(noteUid)
  if (!location || location.item.type !== TreeItemType.NOTE) return

  const window = location.item.windowUid
    ? Tree.windowsByUid.get(location.item.windowUid)
    : undefined
  const oldParentUid = location.item.parentUid
  const promotedChildren: TreeItem[] = []
  for (const item of location.children) {
    if (item.parentUid === location.item.uid) {
      item.parentUid = oldParentUid
      promotedChildren.push(item)
    }
  }
  location.children.splice(location.index, 1)
  Tree.existingUidsSet.delete(location.item.uid)
  Tree.notesByUid.delete(location.item.uid)

  const parent = oldParentUid ? Tree.getItemByUid(oldParentUid) : undefined
  if (parent)
    parent.isParent = Tree.hasChildrenInContainer(parent, location.children)
  for (const item of promotedChildren) {
    item.isParent = Tree.hasChildrenInContainer(item, location.children)
  }

  if (window && window.children.length === 0) {
    Tree.removeWindow(window.uid)
    return
  }

  Tree.recomputeSessionTree(false)
  emitTreeDelta({ op: 'noteRemoved', noteUid })
  emitTreeDelta({
    op: 'treeReplaced',
    treeItems: structuredClone(Tree.Items),
  })
}
