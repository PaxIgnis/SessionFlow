import { describe, expect, it } from 'vitest'
import backup from '../../fixtures/tabs-outliner-backup.json'
import { parseSessionSnapshotImport } from '@/services/session-snapshot-import'
import { State, TreeItemType } from '@/types/session-tree'

const parse = (value: unknown) =>
  parseSessionSnapshotImport(JSON.stringify(value))
const wrap = (...records: unknown[]) => [
  backup.data[0],
  ...records,
  backup.data.at(-1),
]

describe('Tabs Outliner snapshot import', () => {
  it.each([
    ['', 'https://example.com/pending', 'https://example.com/pending'],
    ['   ', 'https://example.com/pending', 'https://example.com/pending'],
    [
      'https://example.com/current',
      'https://example.com/pending',
      'https://example.com/current',
    ],
    ['', undefined, ''],
  ])(
    'uses a pending destination only when the tab URL is empty',
    (url, pendingUrl, expected) => {
      const { payload } = parse(
        wrap(
          [2001, { type: 'win', data: {} }, [0]],
          [
            2001,
            { type: 'tab', data: { url, pendingUrl, title: 'Loading tab' } },
            [0, 0],
          ],
        ),
      )
      const window = payload.items[0]
      if (window.type !== TreeItemType.WINDOW)
        throw new Error('Expected window')
      expect(window.children[0]).toMatchObject({
        url: expected,
        title: 'Loading tab',
      })
    },
  )

  it('accepts raw dumps and wrapped backups with the same source summary', () => {
    const imported = parse(backup)
    expect(parse(backup.data)).toEqual(imported)
    expect(imported.summary).toMatchObject({
      source: 'tabs-outliner',
      sourceCreatedAt: 1700000000000,
      counts: { windows: 3, tabs: 4, notes: 4, separators: 1 },
      warnings: expect.arrayContaining([
        expect.objectContaining({ code: 'nested-windows', count: 2 }),
        expect.objectContaining({ code: 'groups-as-notes', count: 1 }),
        expect.objectContaining({ code: 'separator-children', count: 1 }),
        expect.objectContaining({ code: 'browser-specific-urls', count: 1 }),
        expect.objectContaining({ code: 'unsupported-appearance', count: 2 }),
      ]),
    })
  })

  it('moves nested windows below their containing window as siblings without losing tabs', () => {
    const { items } = parse(backup).payload
    expect(
      items.map((item) =>
        item.type === TreeItemType.WINDOW
          ? item.title
          : item.type === TreeItemType.NOTE
            ? item.text
            : '',
      ),
    ).toEqual(['Projects', 'Main', 'Nested', 'Deep', 'End'])
    const windows = items.filter((item) => item.type === TreeItemType.WINDOW)
    for (const window of windows) {
      expect(window).toMatchObject({
        state: State.SAVED,
        parentUid: items[0].uid,
        indentLevel: 1,
      })
      expect(window).not.toHaveProperty('id')
      expect(
        window.children.every((child) => child.windowUid === window.uid),
      ).toBe(true)
    }
    const [main, nested, deep] = windows
    expect(main.children.map((child) => child.type)).toEqual([
      TreeItemType.TAB,
      TreeItemType.TAB,
      TreeItemType.NOTE,
      TreeItemType.SEPARATOR,
      TreeItemType.NOTE,
    ])
    expect(nested.children).toHaveLength(1)
    expect(deep.children).toHaveLength(1)
    expect(main.children[0]).toMatchObject({
      title: 'A',
      customLabel: 'Read later',
      pinned: true,
      collapsed: true,
      isParent: true,
      state: State.SAVED,
      indentLevel: 2,
    })
    expect(main.children[1]).toMatchObject({
      parentUid: main.children[0].uid,
      indentLevel: 3,
      url: 'chrome://settings',
    })
    expect(main.savedActiveTabUid).toBe(main.children[0].uid)
    expect(main.children[2].isParent).toBe(false)
    expect(main.children[4]).toMatchObject({
      text: 'Below separator',
      indentLevel: 2,
    })
    expect(main.children[4]).not.toHaveProperty('parentUid')
    expect(main.children[0]).not.toHaveProperty('id')
    expect(main.children[0]).not.toHaveProperty('active')
    expect(items[0]).toMatchObject({ collapsed: true, isParent: true })
  })

  it('uses numeric path order even if records arrive out of order', () => {
    expect(parse(wrap(...backup.data.slice(1, -1).reverse()))).toEqual(
      parse(backup),
    )
  })

  it('places orphan tabs in saved windows under their top-level note', () => {
    const imported = parse(
      wrap(
        [2001, { type: 'textnote', data: { note: 'Loose tabs' } }, [0]],
        [2001, { data: { url: 'https://example.com' } }, [0, 0]],
        [2001, { data: { url: 'https://example.com/child' } }, [0, 0, 0]],
      ),
    )
    expect(imported.summary.counts).toEqual({
      windows: 1,
      tabs: 2,
      notes: 1,
      separators: 0,
    })
    expect(imported.summary.warnings).toEqual([
      expect.objectContaining({ code: 'tabs-without-window', count: 1 }),
    ])
    expect(imported.payload.items[1]).toMatchObject({
      parentUid: imported.payload.items[0].uid,
      indentLevel: 1,
    })
  })

  it.each([
    [
      'duplicate path',
      wrap(
        [2001, { type: 'group', data: {} }, [0]],
        [2001, { type: 'group', data: {} }, [0]],
      ),
    ],
    ['missing parent', wrap([2001, { type: 'group', data: {} }, [0, 0]])],
    ['negative path', wrap([2001, { type: 'group', data: {} }, [-1]])],
    ['empty path', wrap([2001, { type: 'group', data: {} }, []])],
    ['unknown node', wrap([2001, { type: 'future-node', data: {} }, [0]])],
    ['unknown operation', wrap([2002, { type: 'group', data: {} }, [0]])],
    [
      'missing URL',
      wrap([2001, { type: 'tab', data: { title: 'Broken' } }, [0]]),
    ],
    ['missing note', wrap([2001, { type: 'textnote', data: {} }, [0]])],
    [
      'invalid pinned value',
      wrap([
        2001,
        { data: { url: 'https://example.com', pinned: 'true' } },
        [0],
      ]),
    ],
    ['missing footer', backup.data.slice(0, -1)],
    [
      'invalid timestamp',
      [...backup.data.slice(0, -1), { type: 11111, time: 'yesterday' }],
    ],
    ['invalid wrapper', { key: 'currentSessionSnapshot', data: {} }],
  ])('rejects %s without silently dropping records', (_name, value) => {
    expect(() => parse(value)).toThrow(/Tabs Outliner/)
  })
})
