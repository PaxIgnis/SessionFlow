import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import * as Messages from '@/services/foreground-messages'
import { SessionTree } from '@/services/foreground-tree'
import { closeModal } from '@/services/modal-state'
import { Selection } from '@/services/selection'
import { getLogicalTreeOrder } from '@/services/selection-actions'
import { Settings } from '@/services/settings'
import { handleTreeKeydown } from '@/services/tree-keyboard'
import { SelectionType, type TreeItem } from '@/types/session-tree'
import {
  makeForegroundNote,
  makeForegroundTab,
  makeForegroundWindow,
  resetForegroundTree,
} from '../helpers/foreground-tree-fixtures'

function key(name: string): KeyboardEvent {
  return {
    key: name,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent
}

function mouse(shiftKey: boolean): MouseEvent {
  return { ctrlKey: false, metaKey: false, shiftKey } as MouseEvent
}

/*
 * The Delete shortcut used to send one close/remove command per selected item,
 * top to bottom. Each command re-sent and re-rendered the whole tree, so a
 * large selection took tens of seconds, and removing a note before the windows
 * nested under it promoted those windows into view until their own command
 * arrived. A multi-item selection now goes out as one deleteTreeItems command,
 * which removes deepest-first and publishes a single update.
 */
describe('bulk Delete shortcut', () => {
  let items: TreeItem[]

  beforeEach(() => {
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
    Settings.values.shortcutClose = 'Delete'
    Selection.clearSelection()
    closeModal()
    const note = makeForegroundNote('note' as UID, {
      indentLevel: 0,
      isParent: true,
    })
    const nested = ['nested-1', 'nested-2'].map((uid) =>
      makeForegroundWindow(
        uid as UID,
        [makeForegroundTab(`${uid}-tab` as UID)],
        { parentUid: note.uid, indentLevel: 1 },
      ),
    )
    const tail = makeForegroundNote('tail' as UID, { indentLevel: 0 })
    resetForegroundTree([note, ...nested, tail])
    items = getLogicalTreeOrder()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('deletes a note and the windows nested under it with one command', async () => {
    const deleteTreeItems = vi
      .spyOn(Messages, 'deleteTreeItems')
      .mockResolvedValue()
    const removeNote = vi
      .spyOn(Messages, 'removeNote')
      .mockImplementation(() => {})
    const closeWindow = vi.spyOn(Messages, 'closeWindow').mockResolvedValue()
    const note = SessionTree.notesByUid.get('note' as UID)!
    const lastNestedTab = items.find((item) => item.uid === 'nested-2-tab')!

    Selection.selectItem(note, SelectionType.NOTE, mouse(false))
    Selection.selectItem(lastNestedTab, SelectionType.TAB, mouse(true))
    await handleTreeKeydown(key('Delete'), items)

    expect(deleteTreeItems).toHaveBeenCalledExactlyOnceWith([
      'note',
      'nested-1',
      'nested-2',
    ])
    expect(removeNote).not.toHaveBeenCalled()
    expect(closeWindow).not.toHaveBeenCalled()
  })

  it('keeps the row command for a single item, which sends a smaller update', async () => {
    const deleteTreeItems = vi
      .spyOn(Messages, 'deleteTreeItems')
      .mockResolvedValue()
    const removeNote = vi
      .spyOn(Messages, 'removeNote')
      .mockImplementation(() => {})
    const tail = SessionTree.notesByUid.get('tail' as UID)!

    Selection.selectItem(tail, SelectionType.NOTE, mouse(false))
    await handleTreeKeydown(key('Delete'), items)

    expect(removeNote).toHaveBeenCalledExactlyOnceWith('tail')
    expect(deleteTreeItems).not.toHaveBeenCalled()
  })
})
