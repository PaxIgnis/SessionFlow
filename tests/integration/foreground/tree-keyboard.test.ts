import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { SessionTree } from '@/services/foreground-tree'
import { Selection } from '@/services/selection'
import { Settings } from '@/services/settings'
import { closeModal, ModalState } from '@/services/modal-state'
import * as Messages from '@/services/foreground-messages'
import {
  handleTreeKeydown,
  keyboardMoveTarget,
  navigationTarget,
  selectKeyboardItem,
  setupTreeKeyboard,
} from '@/services/tree-keyboard'
import { installFakeBrowser, flushMicrotasks } from '../../helpers/fake-browser'
import { getLogicalTreeOrder } from '@/services/selection-actions'
import { SelectionType, State, type TreeItem } from '@/types/session-tree'
import {
  makeForegroundNote,
  makeForegroundSeparator,
  makeForegroundTab,
  makeForegroundWindow,
  resetForegroundTree,
} from '../../helpers/foreground-tree-fixtures'
import { expectForegroundIndexes } from '../../helpers/foreground-invariants'

function key(
  key: string,
  overrides: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent
}
function fixture(): TreeItem[] {
  const window = makeForegroundWindow('window' as UID, [
    makeForegroundTab('parent' as UID, { isParent: true, state: State.OPEN }),
    makeForegroundTab('child' as UID, {
      parentUid: 'parent' as UID,
      indentLevel: 2,
      state: State.SAVED,
    }),
    makeForegroundTab('sibling' as UID, { state: State.DISCARDED }),
    makeForegroundNote('note' as UID),
    makeForegroundSeparator('separator' as UID),
  ])
  resetForegroundTree([window])
  return getLogicalTreeOrder()
}

describe('tree keyboard interaction', () => {
  beforeEach(() => {
    resetForegroundTree()
    Selection.clearSelection()
    closeModal()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    closeModal()
  })

  it('accepts a close shortcut while activation is waiting for Firefox to finish reopening', async () => {
    installFakeBrowser()
    let listener!: (event: KeyboardEvent) => void
    vi.stubGlobal('window', {
      addEventListener: (_name: string, callback: typeof listener) => {
        listener = callback
      },
      removeEventListener: vi.fn(),
    })
    const items = fixture()
    selectKeyboardItem(items[1])
    Settings.values.shortcutClose = 'C'
    let finishOpening!: () => void
    vi.spyOn(Messages, 'treeItemDoubleClick').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishOpening = resolve
        }),
    )
    const close = vi.spyOn(Messages, 'closeTab').mockResolvedValue()
    const dispose = setupTreeKeyboard(() => items)
    try {
      listener(key('Enter'))
      const event = key('c')
      listener(event)
      await flushMicrotasks()
      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect(close).toHaveBeenCalledWith(
        (items[1] as { id: number }).id,
        items[1].uid,
      )
    } finally {
      finishOpening()
      await flushMicrotasks()
      dispose()
    }
  })

  it('waits for a sibling move before computing another, while allowing selection navigation', async () => {
    installFakeBrowser()
    let listener!: (event: KeyboardEvent) => void
    vi.stubGlobal('window', {
      addEventListener: (_name: string, callback: typeof listener) => {
        listener = callback
      },
      removeEventListener: vi.fn(),
    })
    const items = fixture()
    selectKeyboardItem(items[4])
    let finishMoving!: () => void
    const move = vi.spyOn(Messages, 'moveTreeItems').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishMoving = resolve
        }),
    )
    const dispose = setupTreeKeyboard(() => items)
    try {
      listener(key('ArrowUp', { ctrlKey: true }))
      listener(key('ArrowUp', { ctrlKey: true, repeat: true }))
      listener(key('ArrowDown'))
      await flushMicrotasks()
      expect(move).toHaveBeenCalledOnce()
      expect(Selection.selectedItems.value[0].item.uid).toBe(items[5].uid)
    } finally {
      finishMoving()
      await flushMicrotasks()
      dispose()
    }
  })

  it('navigates only visible rows and wraps at the tree ends', async () => {
    const [window, parent, child, sibling, note, separator] = fixture()
    const visible = [window, parent, sibling, note, separator]
    selectKeyboardItem(parent)
    await handleTreeKeydown(key('ArrowDown'), visible)
    expect(Selection.selectedItems.value[0].item.uid).toBe(sibling.uid)
    expect(child.selected).toBe(false)
    await handleTreeKeydown(key('ArrowUp'), visible)
    expect(Selection.selectedItems.value[0].item.uid).toBe(parent.uid)
    expect(navigationTarget(window, 'ArrowUp', visible)?.uid).toBe(
      separator.uid,
    )
    expect(navigationTarget(separator, 'ArrowDown', visible)?.uid).toBe(
      window.uid,
    )
    expect(navigationTarget(window, 'ArrowDown', [window])?.uid).toBe(
      window.uid,
    )
    expect(navigationTarget(window, 'ArrowDown', [])).toBeUndefined()
    expectForegroundIndexes()
  })

  it('selects parents and first visible children without expanding collapsed branches', async () => {
    const [window, parent, child, ...rest] = fixture()
    const visible = [window, parent, child, ...rest]
    selectKeyboardItem(parent)
    await handleTreeKeydown(key('ArrowRight'), visible)
    expect(Selection.selectedItems.value[0].item.uid).toBe(child.uid)
    await handleTreeKeydown(key('ArrowLeft'), visible)
    expect(Selection.selectedItems.value[0].item.uid).toBe(parent.uid)
    expect(navigationTarget(parent, 'ArrowLeft', visible)?.uid).toBe(window.uid)
    expect(
      navigationTarget(parent, 'ArrowRight', [window, parent, ...rest]),
    ).toBeUndefined()
  })

  it('skips saved items and notes with Alt+arrows and includes unloaded open tabs', async () => {
    const items = fixture()
    selectKeyboardItem(items[1])
    await handleTreeKeydown(key('ArrowDown', { altKey: true }), items)
    expect(Selection.selectedItems.value[0].item.uid).toBe('sibling')
    await handleTreeKeydown(key('ArrowUp', { altKey: true }), items)
    expect(Selection.selectedItems.value[0].item.uid).toBe('parent')
    await handleTreeKeydown(key('ArrowUp', { altKey: true }), items)
    expect(Selection.selectedItems.value[0].item.uid).toBe('sibling')
    await handleTreeKeydown(key('ArrowDown', { altKey: true }), items)
    expect(Selection.selectedItems.value[0].item.uid).toBe('parent')
    expect(navigationTarget(items[1], 'ArrowUp', [items[1]], true)?.uid).toBe(
      'parent',
    )
    expect(
      navigationTarget(items[0], 'ArrowDown', [items[0], items[4]], true),
    ).toBeUndefined()
  })

  it('uses the same activation as double-click, and opens notes for editing', async () => {
    const items = fixture()
    const activate = vi
      .spyOn(Messages, 'treeItemDoubleClick')
      .mockResolvedValue()
    selectKeyboardItem(items[1])
    await handleTreeKeydown(key('Enter'), items)
    expect(activate).toHaveBeenCalledWith(items[1])
    selectKeyboardItem(items[4])
    await handleTreeKeydown(key('Enter'), items)
    expect(ModalState.active?.kind).toBe('editNote')
  })

  it('remaps activation and collapse, and leaves the old keys inactive', async () => {
    const items = fixture()
    const activate = vi
      .spyOn(Messages, 'treeItemDoubleClick')
      .mockResolvedValue()
    const collapse = vi
      .spyOn(Messages, 'toggleCollapseTab')
      .mockImplementation(() => undefined)
    Settings.values.shortcutActivate = 'A'
    Settings.values.shortcutCollapse = 'Ctrl+K'
    selectKeyboardItem(items[1])
    const enter = key('Enter')
    await handleTreeKeydown(enter, items)
    await handleTreeKeydown(key(' '), items)
    expect(enter.preventDefault).not.toHaveBeenCalled()
    expect(activate).not.toHaveBeenCalled()
    expect(collapse).not.toHaveBeenCalled()
    await handleTreeKeydown(key('a'), items)
    await handleTreeKeydown(key('k', { ctrlKey: true }), items)
    expect(activate).toHaveBeenCalledOnce()
    expect(collapse).toHaveBeenCalledWith(items[1].uid)
  })

  it('never handles typing, dialogs, composition, or already handled events', async () => {
    const items = fixture()
    const activate = vi
      .spyOn(Messages, 'treeItemDoubleClick')
      .mockResolvedValue()
    selectKeyboardItem(items[1])
    for (const overrides of [
      { target: { closest: () => ({}) } as unknown as HTMLElement },
      { isComposing: true },
      { defaultPrevented: true },
    ]) {
      const event = key('Enter', overrides)
      await handleTreeKeydown(event, items)
      expect(event.preventDefault).not.toHaveBeenCalled()
    }
    ModalState.active = {
      kind: 'editNote',
      note: makeForegroundNote('editing' as UID),
    }
    await handleTreeKeydown(key('Enter'), items)
    expect(activate).not.toHaveBeenCalled()
  })

  it('uses existing indent commands for Ctrl+Left/Right', async () => {
    const items = fixture()
    const increase = vi
      .spyOn(Messages, 'treeItemIndentIncrease')
      .mockImplementation(() => undefined)
    const decrease = vi
      .spyOn(Messages, 'treeItemIndentDecrease')
      .mockImplementation(() => undefined)
    selectKeyboardItem(items[3])
    await handleTreeKeydown(key('ArrowRight', { ctrlKey: true }), items)
    expect(increase).toHaveBeenCalledWith(['sibling'])
    selectKeyboardItem(items[2])
    await handleTreeKeydown(key('ArrowLeft', { ctrlKey: true }), items)
    expect(decrease).toHaveBeenCalledWith(['child'])
  })

  it('moves after a sibling subtree, never into it, using drag descendant settings', async () => {
    const items = fixture()
    const move = vi.spyOn(Messages, 'moveTreeItems').mockResolvedValue()
    selectKeyboardItem(items[3])
    await handleTreeKeydown(key('ArrowUp', { ctrlKey: true }), items)
    expect(move).toHaveBeenLastCalledWith(
      ['sibling'],
      0,
      undefined,
      'window',
      false,
      false,
    )
    selectKeyboardItem(items[1])
    items[1].collapsed = true
    await handleTreeKeydown(key('ArrowDown', { ctrlKey: true }), items)
    expect(move).toHaveBeenLastCalledWith(
      ['parent'],
      3,
      undefined,
      'window',
      false,
      true,
    )
    Settings.values.includeChildrenOfSelectedItems = 'never'
    await handleTreeKeydown(key('ArrowDown', { ctrlKey: true }), items)
    expect(move).toHaveBeenLastCalledWith(
      ['parent'],
      3,
      undefined,
      'window',
      false,
      false,
    )
  })

  it('outdents at either sibling boundary and keeps tabs inside windows', () => {
    const items = fixture()
    expect(keyboardMoveTarget(items[2], -1)).toEqual({
      targetIndex: 0,
      parentUid: undefined,
      targetWindowUid: 'window',
    })
    expect(keyboardMoveTarget(items[2], 1)).toEqual({
      targetIndex: 2,
      parentUid: undefined,
      targetWindowUid: 'window',
    })
    expect(keyboardMoveTarget(items[1], -1)).toBeUndefined()
    expect(keyboardMoveTarget(items[0], -1)).toBeUndefined()
    expect(keyboardMoveTarget(items[5], 1)).toEqual({
      targetIndex: 1,
      parentUid: undefined,
      targetWindowUid: undefined,
    })
    expectForegroundIndexes()
  })

  it('moves selected siblings together according to the drag selection preference', async () => {
    const items = fixture()
    const move = vi.spyOn(Messages, 'moveTreeItems').mockResolvedValue()
    selectKeyboardItem(items[3])
    Selection.selectItem(items[4], SelectionType.NOTE, {
      ctrlKey: true,
    } as MouseEvent)
    await handleTreeKeydown(key('ArrowUp', { ctrlKey: true }), items)
    expect(move).toHaveBeenLastCalledWith(
      ['sibling', 'note'],
      0,
      undefined,
      'window',
      false,
      false,
    )
    Settings.values.includeSelectedItemsWithDraggedItem = false
    await handleTreeKeydown(key('ArrowUp', { ctrlKey: true }), items)
    expect(move).toHaveBeenLastCalledWith(
      ['note'],
      2,
      undefined,
      'window',
      false,
      false,
    )
  })

  it('keeps selection on canonical foreground objects after snapshots and drops deleted selections', () => {
    const items = fixture()
    selectKeyboardItem(items[1])
    const snapshot = structuredClone(toRaw(SessionTree.reactiveItems.value))
    snapshot[0].selected = false
    if ('children' in snapshot[0])
      snapshot[0].children.forEach((item) => {
        item.selected = false
      })
    SessionTree.replaceSessionTree(snapshot)
    Selection.reconcileSelection()
    expect(SessionTree.tabsByUid.get('parent' as UID)?.selected).toBe(true)
    SessionTree.replaceSessionTree([])
    Selection.reconcileSelection()
    expect(Selection.selectedItems.value).toEqual([])
    expect(Selection.anchor.value).toBeUndefined()
    expectForegroundIndexes()
  })

  it('runs opt-in close/save/reload/pin actions and edits the selected kind', async () => {
    const items = fixture()
    selectKeyboardItem(items[1])
    const close = vi.spyOn(Messages, 'closeTab').mockResolvedValue()
    const save = vi.spyOn(Messages, 'saveTabs').mockResolvedValue()
    vi.spyOn(Messages, 'saveWindows').mockResolvedValue()
    const reload = vi.spyOn(Messages, 'reloadTabs').mockResolvedValue()
    const pin = vi.spyOn(Messages, 'pinTabs').mockResolvedValue()
    const unpin = vi.spyOn(Messages, 'unpinTabs').mockResolvedValue()
    for (const [setting, letter] of [
      ['shortcutClose', 'C'],
      ['shortcutSave', 'S'],
      ['shortcutReload', 'R'],
      ['shortcutPin', 'P'],
      ['shortcutEdit', 'E'],
    ] as const)
      Settings.values[setting] = letter
    for (const letter of ['c', 's', 'r', 'p'])
      await handleTreeKeydown(key(letter), items)
    expect(close).toHaveBeenCalledWith(
      (items[1] as { id: number }).id,
      'parent',
    )
    expect(save).toHaveBeenCalledWith([items[1]])
    expect(reload).toHaveBeenCalledWith([items[1]])
    expect(pin).toHaveBeenCalledWith([items[1]])
    ;(items[1] as { pinned: boolean }).pinned = true
    await handleTreeKeydown(key('p'), items)
    expect(unpin).toHaveBeenCalledWith([items[1]])
    await handleTreeKeydown(key('e'), items)
    expect(ModalState.active?.kind).toBe('editCustomLabel')
  })

  it('closes saved items immediately, like the close button, without opening a modal', async () => {
    const items = fixture()
    Settings.values.shortcutClose = 'Delete'
    const closeTab = vi.spyOn(Messages, 'closeTab').mockResolvedValue()
    const closeWindow = vi.spyOn(Messages, 'closeWindow').mockResolvedValue()
    SessionTree.windowsByUid.get('window' as UID)!.state = State.SAVED
    for (const target of [items[2], items[0]]) {
      selectKeyboardItem(target)
      await handleTreeKeydown(key('Delete'), items)
      expect(ModalState.active).toBeNull()
    }
    expect(closeTab).toHaveBeenCalledWith(
      (items[2] as { id: number }).id,
      items[2].uid,
    )
    expect(closeWindow).toHaveBeenCalledWith(
      (items[0] as { id: number }).id,
      items[0].uid,
    )
    expectForegroundIndexes()
  })

  it('deletes notes and separators immediately with the same commands as their delete buttons', async () => {
    const items = fixture()
    Settings.values.shortcutClose = 'Delete'
    const removeNote = vi
      .spyOn(Messages, 'removeNote')
      .mockImplementation(() => {})
    const removeSeparator = vi
      .spyOn(Messages, 'removeSeparator')
      .mockImplementation(() => {})
    for (const item of items.slice(4)) {
      selectKeyboardItem(item)
      await handleTreeKeydown(key('Delete'), items)
      expect(ModalState.active).toBeNull()
    }
    expect(removeNote).toHaveBeenCalledWith('note')
    expect(removeSeparator).toHaveBeenCalledWith('separator')
    expectForegroundIndexes()
  })

  it('matches row deletion without applying the context menu descendant preference', async () => {
    const items = fixture()
    Settings.values.shortcutClose = 'Delete'
    Settings.values.contextMenuDeleteDescendants = 'always'
    items[4].isParent = true
    items[5].parentUid = items[4].uid
    items[5].indentLevel = 2
    const closeTab = vi.spyOn(Messages, 'closeTab').mockResolvedValue()
    const removeNote = vi
      .spyOn(Messages, 'removeNote')
      .mockImplementation(() => {})
    const removeSeparator = vi
      .spyOn(Messages, 'removeSeparator')
      .mockImplementation(() => {})
    for (const item of [items[1], items[4]]) {
      selectKeyboardItem(item)
      await handleTreeKeydown(key('Delete'), items)
    }
    expect(closeTab).toHaveBeenCalledExactlyOnceWith(
      (items[1] as { id: number }).id,
      items[1].uid,
    )
    expect(removeNote).toHaveBeenCalledExactlyOnceWith(items[4].uid)
    expect(removeSeparator).not.toHaveBeenCalled()
    expectForegroundIndexes()
  })

  it.each([
    ['note', 'separator'],
    ['separator', 'note'],
  ])(
    'focuses a surviving neighbor after deleting %s without selecting it',
    async (deletedUid, neighborUid) => {
      installFakeBrowser()
      vi.stubGlobal('window', {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })
      const items = fixture()
      const body = {}
      const documentMock = { activeElement: body, body, querySelector: vi.fn() }
      const rows = new Map(
        items.map((item) => {
          const row = {
            closest: (selector: string) =>
              selector === '[drag-and-drop-id]' ? row : null,
            getAttribute: () => item.uid,
            focus: vi.fn(() => {
              documentMock.activeElement = row
            }),
            scrollIntoView: vi.fn(),
          }
          return [item.uid, row] as const
        }),
      )
      documentMock.querySelector.mockImplementation((selector: string) =>
        rows.get(selector.split('"')[1] as UID),
      )
      vi.stubGlobal('document', documentMock)
      vi.stubGlobal('CSS', { escape: (value: string) => value })
      const visible = () => getLogicalTreeOrder()
      const dispose = setupTreeKeyboard(visible)
      try {
        selectKeyboardItem(items.find((item) => item.uid === deletedUid)!)
        await nextTick()
        const snapshot = structuredClone(toRaw(SessionTree.reactiveItems.value))
        if ('children' in snapshot[0])
          snapshot[0].children = snapshot[0].children.filter(
            (item) => item.uid !== deletedUid,
          )
        SessionTree.replaceSessionTree(snapshot)
        Selection.reconcileSelection()
        await nextTick()
        await nextTick()
        expect(documentMock.activeElement).toBe(rows.get(neighborUid as UID))
        expect(Selection.selectedItems.value).toEqual([])
        expect(visible().some((item) => item.selected)).toBe(false)
        await handleTreeKeydown(
          key('ArrowDown', {
            target: rows.get(neighborUid as UID) as unknown as EventTarget,
          }),
          visible(),
        )
        expect(Selection.selectedItems.value).toHaveLength(1)
        expect(Selection.selectedItems.value[0].item.uid).toBe(
          navigationTarget(
            visible().find((item) => item.uid === neighborUid)!,
            'ArrowDown',
            visible(),
          )?.uid,
        )
        expectForegroundIndexes()
      } finally {
        dispose()
        await nextTick()
      }
    },
  )
})
