import { describe, expect, it } from 'vitest'
import {
  buildDragImagePreview,
  collectDraggedItemsWithIncludedChildren,
  collectSelectedDragItems,
  getDragImageTextWidth,
  populateInternalDragData,
} from '@/services/drag-and-drop-actions'
import { DragType, SelectionType } from '@/types/session-tree'
import {
  makeForegroundNote,
  makeForegroundSeparator,
  makeForegroundTab,
  makeForegroundWindow,
} from '../../helpers/foreground-tree-fixtures'

describe('drag start item collection', () => {
  describe('drag image preview', () => {
    it('summarizes mixed items in first-occurrence type order and keeps tab URLs', () => {
      const note = makeForegroundNote('note-1' as UID)
      const firstTab = makeForegroundTab('tab-1' as UID)
      const secondTab = makeForegroundTab('tab-2' as UID)

      expect(buildDragImagePreview([note, firstTab, secondTab])).toEqual({
        title: '1 note and 2 tabs',
        body: [firstTab.url, secondTab.url],
      })
    })

    it('summarizes every selected type and aggregates selected window contents', () => {
      const windowTabOne = makeForegroundTab('window-tab-1' as UID)
      const windowTabTwo = makeForegroundTab('window-tab-2' as UID)
      const windowNote = makeForegroundNote('window-note' as UID)
      const windowSeparator = makeForegroundSeparator('window-separator' as UID)
      const window = makeForegroundWindow(
        'window-1' as UID,
        [windowTabOne, windowTabTwo, windowNote, windowSeparator],
        { title: 'Project window' },
      )
      const selectedNote = makeForegroundNote('selected-note' as UID)
      const selectedTab = makeForegroundTab('selected-tab' as UID)

      expect(
        buildDragImagePreview([window, selectedNote, selectedTab]),
      ).toEqual({
        title: '1 window, 1 note and 1 tab',
        metadata: '(Window contents: 2 tabs, 1 note and 1 separator)',
        body: [selectedTab.url],
      })
    })

    it.each([
      {
        label: 'tab',
        item: makeForegroundTab('single-tab' as UID, {
          title: 'Single tab',
          url: 'https://single.example/',
        }),
        expected: {
          title: 'Single tab',
          body: ['https://single.example/'],
        },
      },
      {
        label: 'note',
        item: makeForegroundNote('single-note' as UID, {
          text: 'Single note',
        }),
        expected: { title: 'Single note', body: [] },
      },
      {
        label: 'separator',
        item: makeForegroundSeparator('single-separator' as UID),
        expected: { title: 'Separator', body: [] },
      },
      {
        label: 'empty window',
        item: makeForegroundWindow('empty-window' as UID, [], {
          title: 'Empty window',
        }),
        expected: {
          title: 'Empty window',
          metadata: '(Window contents: 0 items)',
          body: [],
        },
      },
    ])('retains the existing single-$label title', ({ item, expected }) => {
      expect(buildDragImagePreview([item])).toEqual(expected)
    })

    it('aggregates contents from multiple selected windows', () => {
      const firstWindow = makeForegroundWindow('window-1' as UID, [
        makeForegroundTab('tab-1' as UID),
        makeForegroundNote('note-1' as UID),
      ])
      const secondWindow = makeForegroundWindow('window-2' as UID, [
        makeForegroundTab('tab-2' as UID),
        makeForegroundSeparator('separator-1' as UID),
      ])

      expect(buildDragImagePreview([firstWindow, secondWindow])).toEqual({
        title: '2 windows',
        metadata: '(Window contents: 2 tabs, 1 note and 1 separator)',
        body: [],
      })
    })

    it('returns an empty preview for an empty drag payload', () => {
      expect(buildDragImagePreview([])).toEqual({ title: '', body: [] })
    })

    it('caps the body at 15 lines while keeping the window summary first', () => {
      const window = makeForegroundWindow('window-1' as UID, [
        makeForegroundNote('window-note' as UID),
      ])
      const tabs = Array.from({ length: 16 }, (_, index) =>
        makeForegroundTab(`tab-${index}` as UID),
      )

      const preview = buildDragImagePreview([window, ...tabs])

      expect(preview.metadata).toBe('(Window contents: 1 note)')
      expect(preview.body).toHaveLength(14)
      expect(preview.body).toEqual(tabs.slice(0, 14).map((tab) => tab.url))
    })

    it('keeps 354 pixels of text inside the 370-pixel canvas width', () => {
      expect(getDragImageTextWidth(320, 8)).toBe(320)
      expect(getDragImageTextWidth(354, 8)).toBe(354)
      expect(getDragImageTextWidth(500, 8)).toBe(354)
    })
  })

  it.each([
    {
      setting: 'always' as const,
      collapsed: false,
      expected: ['tab-parent', 'note-child', 'tab-grandchild'],
    },
    {
      setting: 'always' as const,
      collapsed: true,
      expected: ['tab-parent', 'note-child', 'tab-grandchild'],
    },
    {
      setting: 'collapsed' as const,
      collapsed: true,
      expected: ['tab-parent', 'note-child', 'tab-grandchild'],
    },
    {
      setting: 'collapsed' as const,
      collapsed: false,
      expected: ['tab-parent'],
    },
    {
      setting: 'never' as const,
      collapsed: true,
      expected: ['tab-parent'],
    },
  ])(
    'uses $setting to decide whether tab descendants join the drag payload',
    ({ setting, collapsed, expected }) => {
      const parent = makeForegroundTab('tab-parent' as UID, {
        collapsed,
        isParent: true,
      })
      const childNote = makeForegroundNote('note-child' as UID, {
        parentUid: parent.uid,
        indentLevel: 2,
      })
      const grandchildTab = makeForegroundTab('tab-grandchild' as UID, {
        parentUid: childNote.uid,
        indentLevel: 3,
      })
      const sibling = makeForegroundTab('tab-sibling' as UID)
      const window = makeForegroundWindow('window-1' as UID, [
        parent,
        childNote,
        grandchildTab,
        sibling,
      ])
      const windowsByUid = new Map([[window.uid, window]])

      const items = collectDraggedItemsWithIncludedChildren(
        [parent],
        SelectionType.TAB,
        setting,
        windowsByUid,
      )

      expect(items.map((item) => item.uid)).toEqual(expected)
    },
  )

  it.each(['always', 'collapsed', 'never'] as const)(
    'does not expand note descendants into drag payload when setting is %s',
    (setting) => {
      const note = makeForegroundNote('note-root' as UID, {
        collapsed: true,
        isParent: true,
      })
      const childWindow = makeForegroundWindow('window-child' as UID, [], {
        parentUid: note.uid,
        indentLevel: 1,
      })

      const items = collectDraggedItemsWithIncludedChildren(
        [note],
        SelectionType.NOTE,
        setting,
        new Map([[childWindow.uid, childWindow]]),
      )

      expect(items).toEqual([note])
    },
  )

  it('serializes Unicode and markup-looking tab data without creating executable HTML', () => {
    const tab = makeForegroundTab('tab-1' as UID, {
      title: 'Snowman ☃\n<img src=x onerror="alert(1)">',
      url: 'https://example.test/path?quote=%22value%22',
    })
    const written = new Map<string, string>()
    const dataTransfer = {
      setData: (type: string, value: string) => written.set(type, value),
    } as unknown as DataTransfer
    const dragInfo = { dragType: DragType.TAB, items: [tab] }

    expect(() => populateInternalDragData(null, dragInfo)).not.toThrow()
    populateInternalDragData(dataTransfer, dragInfo)

    expect(
      JSON.parse(written.get('application/x-sessionflow-draganddrop')!),
    ).toMatchObject({ items: [{ uid: tab.uid, title: tab.title }] })
    expect(written.get('text/html')).toContain('&lt;img')
    expect(written.get('text/html')).not.toContain('<img')
    expect(written.get('text/plain')).toBe(tab.url)
  })

  it('continues writing safe formats when one native setData call fails', () => {
    const tab = makeForegroundTab('tab-1' as UID)
    const written = new Map<string, string>()
    const dataTransfer = {
      setData: (type: string, value: string) => {
        if (type === 'text/x-moz-url') throw new DOMException('unsupported')
        written.set(type, value)
      },
    } as unknown as DataTransfer

    expect(() =>
      populateInternalDragData(dataTransfer, {
        dragType: DragType.TAB,
        items: [tab],
      }),
    ).not.toThrow()
    expect(written.get('text/plain')).toBe(tab.url)
    expect(written.get('text/html')).toContain('<a ')
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://example.test/path\nInjected',
  ])('omits an unsafe tab URL from native formats: %s', (url) => {
    const tab = makeForegroundTab('tab-unsafe' as UID, { url })
    const written = new Map<string, string>()

    populateInternalDragData(
      {
        setData: (type: string, value: string) => written.set(type, value),
      } as unknown as DataTransfer,
      { dragType: DragType.TAB, items: [tab] },
    )

    expect(written.get('text/x-moz-url')).toBe('')
    expect(written.get('text/uri-list')).toBe('')
    expect(written.get('text/html')).toBe('')
    expect(written.get('text/plain')).toBe('')
  })

  it('keeps every selected item type when starting a mixed compatible drag', () => {
    const tab = makeForegroundTab('tab-1' as UID)
    const note = makeForegroundNote('note-1' as UID)
    const window = makeForegroundWindow('window-1' as UID, [tab, note])

    expect(
      collectSelectedDragItems(tab, [tab, note, tab], true).map(
        (item) => item.uid,
      ),
    ).toEqual([tab.uid, note.uid])
    expect(
      collectSelectedDragItems(tab, [tab, note], false).map((item) => item.uid),
    ).toEqual([tab.uid])
    expect(window.children).toHaveLength(2)

    expect(
      collectSelectedDragItems(note, [tab], true).map((item) => item.uid),
    ).toEqual([tab.uid, note.uid])
  })
})
