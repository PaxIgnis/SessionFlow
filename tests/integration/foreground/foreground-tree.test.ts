import { beforeEach, describe, expect, it } from 'vitest'
import { SessionTree } from '@/services/foreground-tree'
import { TreeItemType } from '@/types/session-tree'
import {
  makeForegroundNote,
  makeForegroundSeparator,
  makeForegroundTab,
  makeForegroundWindow,
  resetForegroundTree,
} from '../../helpers/foreground-tree-fixtures'
import { expectForegroundIndexes } from '../../helpers/foreground-invariants'

describe('foreground SessionTree deltas', () => {
  beforeEach(() => {
    resetForegroundTree()
  })

  it('replaces the tree and rebuilds foreground maps', () => {
    const tab = makeForegroundTab('tab-1' as UID)
    const note = makeForegroundNote('note-1' as UID)
    const separator = makeForegroundSeparator('separator-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [
      tab,
      separator,
      note,
    ])

    SessionTree.applyDelta({
      op: 'treeReplaced',
      treeItems: [window],
    })

    expect(SessionTree.reactiveItems.value.map((item) => item.uid)).toEqual([
      window.uid,
    ])
    expect(SessionTree.windowsByUid.get(window.uid)?.uid).toBe(window.uid)
    expect(SessionTree.tabsByUid.get(tab.uid)?.uid).toBe(tab.uid)
    expect(SessionTree.separatorsByUid.get(separator.uid)?.uid).toBe(
      separator.uid,
    )
    expect(SessionTree.notesByUid.get(note.uid)?.uid).toBe(note.uid)
    expectForegroundIndexes()
  })

  it('replaces a note-heavy tree with root note child windows indexed by parentUid', () => {
    const rootNote = makeForegroundNote('note-root' as UID, {
      indentLevel: 0,
      isParent: true,
    })
    const firstWindow = makeForegroundWindow(
      'window-first' as UID,
      [
        makeForegroundNote('note-window-child' as UID),
        makeForegroundTab('tab-window-child' as UID),
      ],
      {
        parentUid: rootNote.uid,
        indentLevel: 1,
      },
    )
    const secondWindow = makeForegroundWindow(
      'window-second' as UID,
      [makeForegroundTab('tab-second-child' as UID)],
      {
        parentUid: rootNote.uid,
        indentLevel: 1,
      },
    )

    SessionTree.replaceSessionTree([rootNote, firstWindow, secondWindow])

    expect(SessionTree.reactiveItems.value.map((item) => item.uid)).toEqual([
      rootNote.uid,
      firstWindow.uid,
      secondWindow.uid,
    ])
    expect(SessionTree.notesByUid.get(rootNote.uid)).toBeDefined()
    expect(SessionTree.windowsByUid.get(firstWindow.uid)?.parentUid).toBe(
      rootNote.uid,
    )
    expect(
      SessionTree.notesByUid.get('note-window-child' as UID)?.windowUid,
    ).toBe(firstWindow.uid)
    expect(
      SessionTree.tabsByUid.get('tab-second-child' as UID)?.windowUid,
    ).toBe(secondWindow.uid)
    expectForegroundIndexes()
  })

  it('updates a window in place and reconciles mixed children', () => {
    const tab = makeForegroundTab('tab-1' as UID)
    const note = makeForegroundNote('note-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [tab, note], {
      title: 'before',
    })
    resetForegroundTree([window])
    const existingWindow = SessionTree.windowsByUid.get(window.uid)
    const existingTab = SessionTree.tabsByUid.get(tab.uid)
    const replacementNote = makeForegroundNote('note-2' as UID, {
      windowUid: window.uid,
    })

    SessionTree.applyDelta({
      op: 'windowUpdated',
      window: {
        ...window,
        title: 'after',
        children: [{ ...tab, title: 'updated tab' }, replacementNote],
      },
    })

    const updatedWindow = SessionTree.windowsByUid.get(window.uid)
    expect(updatedWindow).toBe(existingWindow)
    expect(SessionTree.tabsByUid.get(tab.uid)).toBe(existingTab)
    expect(SessionTree.tabsByUid.get(tab.uid)?.title).toBe('updated tab')
    expect(SessionTree.notesByUid.has(note.uid)).toBe(false)
    expect(SessionTree.notesByUid.get(replacementNote.uid)?.text).toBe(
      replacementNote.text,
    )
    expectForegroundIndexes()
  })

  it('applies treeReplaced over a mixed note/window tree and drops stale indexes', () => {
    const staleTab = makeForegroundTab('tab-stale' as UID)
    const staleWindow = makeForegroundWindow('window-stale' as UID, [staleTab])
    resetForegroundTree([staleWindow])

    const note = makeForegroundNote('note-root' as UID, {
      indentLevel: 0,
      isParent: true,
    })
    const childWindow = makeForegroundWindow(
      'window-child' as UID,
      [makeForegroundNote('note-child' as UID)],
      {
        parentUid: note.uid,
        indentLevel: 1,
      },
    )

    SessionTree.applyDelta({
      op: 'treeReplaced',
      treeItems: [note, childWindow],
    })

    expect(SessionTree.tabsByUid.has(staleTab.uid)).toBe(false)
    expect(SessionTree.windowsByUid.has(staleWindow.uid)).toBe(false)
    expect(SessionTree.notesByUid.get(note.uid)).toBeDefined()
    expect(SessionTree.windowsByUid.get(childWindow.uid)?.parentUid).toBe(
      note.uid,
    )
    expectForegroundIndexes()
  })

  it('applies tab create, update, and remove deltas', () => {
    const window = makeForegroundWindow('window-1' as UID)
    const tab = makeForegroundTab('tab-1' as UID, { windowUid: window.uid })
    resetForegroundTree([window])

    SessionTree.applyDelta({
      op: 'tabCreated',
      windowUid: window.uid,
      tab,
      index: 0,
    })
    SessionTree.applyDelta({
      op: 'tabUpdated',
      tab: { ...tab, title: 'updated' },
    })

    const indexedWindow = SessionTree.windowsByUid.get(window.uid)
    expect(indexedWindow?.children.map((item) => item.uid)).toEqual([tab.uid])
    expect(SessionTree.tabsByUid.get(tab.uid)?.title).toBe('updated')

    SessionTree.applyDelta({
      op: 'tabRemoved',
      windowUid: window.uid,
      tabUid: tab.uid,
    })

    expect(indexedWindow?.children).toEqual([])
    expect(SessionTree.tabsByUid.has(tab.uid)).toBe(false)
    expectForegroundIndexes()
  })

  it('clears a stale tab parent when a tab update explicitly sets parentUid undefined', () => {
    const parent = makeForegroundTab('tab-parent' as UID, { isParent: true })
    const child = makeForegroundTab('tab-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const window = makeForegroundWindow('window-1' as UID, [child, parent])
    resetForegroundTree([window])

    SessionTree.applyDelta({
      op: 'tabUpdated',
      tab: {
        ...child,
        parentUid: undefined,
        indentLevel: 1,
      },
    })

    const updatedChild = SessionTree.tabsByUid.get(child.uid)
    expect(updatedChild?.uid).toBe(child.uid)
    expect(
      Object.prototype.hasOwnProperty.call(updatedChild, 'parentUid'),
    ).toBe(true)
    expect(updatedChild?.parentUid).toBeUndefined()
    expect(updatedChild?.indentLevel).toBe(1)
    expectForegroundIndexes()
  })

  it('applies window create/remove and note update deltas', () => {
    const note = makeForegroundNote('note-1' as UID, { text: 'before' })
    const window = makeForegroundWindow('window-1' as UID, [note])

    SessionTree.applyDelta({
      op: 'windowCreated',
      window,
      index: 0,
    })
    SessionTree.applyDelta({
      op: 'noteUpdated',
      note: { ...note, text: 'after' },
    })

    expect(SessionTree.notesByUid.get(note.uid)?.text).toBe('after')
    expectForegroundIndexes()

    SessionTree.applyDelta({
      op: 'windowRemoved',
      windowUid: window.uid,
    })

    expect(SessionTree.reactiveItems.value).toEqual([])
    expect(SessionTree.windowsByUid.has(window.uid)).toBe(false)
    expect(SessionTree.notesByUid.has(note.uid)).toBe(false)
    expectForegroundIndexes()
  })

  it('leaves note create/remove deltas as no-ops because note mutations emit treeReplaced', () => {
    const note = makeForegroundNote('note-1' as UID)

    SessionTree.applyDelta({
      op: 'noteCreated',
      note,
      index: 0,
      parentUid: undefined,
    })
    SessionTree.applyDelta({
      op: 'noteRemoved',
      noteUid: note.uid,
    })

    expect(SessionTree.reactiveItems.value).toEqual([])
    expect(SessionTree.notesByUid.has(note.uid)).toBe(false)
  })

  it('leaves separator create/remove deltas as no-ops because separator mutations emit treeReplaced', () => {
    const separator = makeForegroundSeparator('separator-1' as UID)

    SessionTree.applyDelta({
      op: 'separatorCreated',
      separator,
      index: 0,
      parentUid: undefined,
    })
    SessionTree.applyDelta({
      op: 'separatorRemoved',
      separatorUid: separator.uid,
    })

    expect(SessionTree.reactiveItems.value).toEqual([])
    expect(SessionTree.separatorsByUid.has(separator.uid)).toBe(false)
  })

  it('does not duplicate existing tabs when a repeated tabCreated delta arrives', () => {
    const window = makeForegroundWindow('window-1' as UID)
    const tab = makeForegroundTab('tab-1' as UID, { windowUid: window.uid })
    resetForegroundTree([window])

    SessionTree.applyDelta({
      op: 'tabCreated',
      windowUid: window.uid,
      tab,
      index: 0,
    })
    SessionTree.applyDelta({
      op: 'tabCreated',
      windowUid: window.uid,
      tab,
      index: 0,
    })

    const indexedWindow = SessionTree.windowsByUid.get(window.uid)
    expect(
      indexedWindow?.children.filter((item) => item.uid === tab.uid),
    ).toHaveLength(1)
    expect(indexedWindow?.children[0].type).toBe(TreeItemType.TAB)
    expectForegroundIndexes()
  })

  it('ignores deltas for missing windows, tabs, and notes', () => {
    const tab = makeForegroundTab('tab-1' as UID)
    const note = makeForegroundNote('note-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [tab, note])
    resetForegroundTree([window])

    SessionTree.applyDelta({
      op: 'windowUpdated',
      window: makeForegroundWindow('missing-window' as UID),
    })
    SessionTree.applyDelta({
      op: 'tabCreated',
      windowUid: 'missing-window' as UID,
      tab: makeForegroundTab('new-tab' as UID),
      index: 0,
    })
    SessionTree.applyDelta({
      op: 'tabRemoved',
      windowUid: 'missing-window' as UID,
      tabUid: tab.uid,
    })
    SessionTree.applyDelta({
      op: 'tabUpdated',
      tab: makeForegroundTab('missing-tab' as UID, { title: 'missing' }),
    })
    SessionTree.applyDelta({
      op: 'noteUpdated',
      note: makeForegroundNote('missing-note' as UID, { text: 'missing' }),
    })

    expect(SessionTree.reactiveItems.value.map((item) => item.uid)).toEqual([
      window.uid,
    ])
    expect(SessionTree.tabsByUid.get(tab.uid)?.title).toBe(tab.title)
    expect(SessionTree.notesByUid.get(note.uid)?.text).toBe(note.text)
    expectForegroundIndexes()
  })

  it('does not overwrite existing fields when optional fields are omitted during updates', () => {
    const tab = makeForegroundTab('tab-1' as UID, {
      title: 'Title',
      customLabel: 'Label',
    })
    const note = makeForegroundNote('note-1' as UID, {
      text: 'Note',
    })
    const window = makeForegroundWindow('window-1' as UID, [tab, note])
    resetForegroundTree([window])

    const { customLabel: _customLabel, ...tabUpdateWithoutCustomLabel } = {
      ...tab,
      title: 'Updated',
    }
    SessionTree.applyDelta({
      op: 'tabUpdated',
      tab: tabUpdateWithoutCustomLabel,
    })
    SessionTree.applyDelta({
      op: 'noteUpdated',
      note: {
        ...note,
        text: 'Updated note',
        parentUid: undefined,
      },
    })

    expect(SessionTree.tabsByUid.get(tab.uid)?.title).toBe('Updated')
    expect(SessionTree.tabsByUid.get(tab.uid)?.customLabel).toBe('Label')
    expect(SessionTree.notesByUid.get(note.uid)?.text).toBe('Updated note')
    expectForegroundIndexes()
  })

  it('clears optional fields when updates explicitly set them to undefined', () => {
    const tab = makeForegroundTab('tab-1' as UID, {
      customLabel: 'Label',
    })
    const separator = makeForegroundSeparator('separator-1' as UID, {
      parentUid: tab.uid,
      windowUid: 'window-1' as UID,
      indentLevel: 2,
    })
    const window = makeForegroundWindow('window-1' as UID, [tab, separator])
    resetForegroundTree([window])

    SessionTree.applyDelta({
      op: 'tabUpdated',
      tab: {
        ...tab,
        customLabel: undefined,
      },
    })
    SessionTree.applyDelta({
      op: 'separatorUpdated',
      separator: {
        ...separator,
        parentUid: undefined,
        indentLevel: 1,
      },
    })

    expect(SessionTree.tabsByUid.get(tab.uid)?.customLabel).toBeUndefined()
    expect(
      SessionTree.separatorsByUid.get(separator.uid)?.parentUid,
    ).toBeUndefined()
    expect(SessionTree.separatorsByUid.get(separator.uid)?.indentLevel).toBe(1)
    expectForegroundIndexes()
  })
})
