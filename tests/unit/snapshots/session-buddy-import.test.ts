import { describe, expect, it } from 'vitest'
import backup from '../../fixtures/session-buddy-export.json'
import { parseSessionSnapshotImport } from '@/services/session-snapshot-import'
import { projectSnapshotForRestore } from '@/services/session-snapshot-restore'
import { State, TreeItemType } from '@/types/session-tree'

const parse = (value: unknown) =>
  parseSessionSnapshotImport(JSON.stringify(value))
const link = { url: 'https://example.com', title: 'Example', pinned: true }

describe('Session Buddy snapshot import', () => {
  it('preserves collections, folders, tab order, titles, pinning, private flags, and geometry', () => {
    const imported = parse(backup)
    expect(imported.summary).toMatchObject({
      source: 'session-buddy',
      counts: { windows: 3, tabs: 4, notes: 2, separators: 0 },
      warnings: expect.arrayContaining([
        expect.objectContaining({ code: 'collections-as-notes', count: 2 }),
        expect.objectContaining({ code: 'tab-group-metadata', count: 1 }),
        expect.objectContaining({ code: 'browser-specific-urls', count: 1 }),
      ]),
    })
    expect(imported.summary).not.toHaveProperty('sourceCreatedAt')
    const [research, reading, privateReading, tools, browser] =
      imported.payload.items
    expect(research).toMatchObject({
      type: TreeItemType.NOTE,
      text: 'Research',
      isParent: true,
    })
    expect(tools).toMatchObject({ text: 'Tools' })
    expect(browser).toMatchObject({ parentUid: tools.uid })
    expect(reading).toMatchObject({
      title: 'Reading',
      parentUid: research.uid,
      indentLevel: 1,
      state: State.SAVED,
      windowPosition: { left: 10, top: 20, width: 1200, height: 800 },
      savedTime: 1700000010000,
    })
    expect(privateReading).toMatchObject({
      incognito: true,
      parentUid: research.uid,
    })
    if (reading.type !== TreeItemType.WINDOW) throw new Error('Expected window')
    expect(reading.children[0]).toMatchObject({
      title: 'Example article',
      customLabel: 'Read this first',
      url: 'https://example.com/article',
      pinned: true,
      indentLevel: 2,
      state: State.SAVED,
      windowUid: reading.uid,
    })
    expect(reading.savedActiveTabUid).toBe(reading.children[0].uid)
    expect(reading.children[0]).not.toHaveProperty('active')
    expect(reading.children[0]).not.toHaveProperty('id')
    expect(reading.children[0]).not.toHaveProperty('favIconUrl')
    const [first, second] = reading.children
    if (first.type !== TreeItemType.TAB || second.type !== TreeItemType.TAB)
      throw new Error('Expected tabs')
    expect(first.tabGroup).toEqual(second.tabGroup)
    expect(first.tabGroup).toMatchObject({ color: 'grey', collapsed: false })
    expect(first.tabGroup).not.toHaveProperty('id')
  })

  it('accepts older session/window/tab aliases, honoring name over title', () => {
    const imported = parse({
      sessions: [
        {
          title: 'Old title',
          name: 'Saved work',
          created: 1700000000000,
          windows: [{ title: 'Old window title', name: 'Work', tabs: [link] }],
        },
      ],
    })
    expect(imported.summary).toMatchObject({
      source: 'session-buddy',
      sourceCreatedAt: 1700000000000,
      counts: { windows: 1, tabs: 1, notes: 1, separators: 0 },
    })
    expect(imported.payload.items[0]).toMatchObject({ text: 'Saved work' })
    expect(imported.payload.items[1]).toMatchObject({ title: 'Work' })
  })

  it.each([
    { folders: [{ links: [link] }] },
    { windows: [{ tabs: [link] }] },
    { links: [link] },
    { tabs: [link] },
    [{ links: [link] }],
    [{ tabs: [link] }],
    [link],
  ])('accepts standalone folders and links: %j', (value) => {
    const imported = parse(value)
    expect(imported.summary).toMatchObject({
      source: 'session-buddy',
      counts: { windows: 1, tabs: 1, notes: 0, separators: 0 },
    })
  })

  it('accepts collection arrays and keeps group identity local to each window', () => {
    const imported = parse([
      {
        folders: [
          { links: [{ ...link, groupId: 1 }] },
          { links: [{ ...link, groupId: 1 }] },
        ],
      },
    ])
    const tabs = imported.payload.items
      .flatMap((item) =>
        item.type === TreeItemType.WINDOW ? item.children : [],
      )
      .filter((item) => item.type === TreeItemType.TAB)
    expect(tabs[0].tabGroup?.uid).not.toBe(tabs[1].tabGroup?.uid)
    expect(imported.payload.items[0]).toMatchObject({ text: 'Collection 1' })
  })

  it('warns about backup history and refuses history-only backups', () => {
    const imported = parse({ ...backup, events: [{ id: 1 }, { id: 2 }] })
    expect(imported.summary.warnings).toContainEqual(
      expect.objectContaining({ code: 'history-not-imported', count: 2 }),
    )
    expect(() => parse({ collections: [], events: [{ id: 1 }] })).toThrow(
      'only history',
    )
  })

  it('preserves empty collections and folders', () => {
    const imported = parse({
      collections: [{ folders: [] }, { folders: [{ links: [] }] }],
    })
    expect(imported.summary.counts).toEqual({
      windows: 1,
      tabs: 0,
      notes: 2,
      separators: 0,
    })
  })

  it('produces a restorable tree', () => {
    const { payload, summary } = parse(backup)
    const restored = projectSnapshotForRestore({
      payload,
      mode: 'all',
      selectedUids: new Set(),
      existingUids: new Set(),
    })
    expect(restored.counts).toEqual(summary.counts)
  })

  it.each([
    { collections: null },
    { collections: [{}] },
    { collections: [], sessions: [] },
    { windows: [], tabs: [] },
    { collections: [{ folders: null }] },
    { windows: [{ tabs: [{}] }] },
    { tabs: [link, null] },
    { tabs: [{ url: 42 }] },
    { tabs: [{ ...link, pinned: 'true' }] },
    { tabs: [{ ...link, groupId: 1.5 }] },
    { windows: [{ tabs: [link], incognito: 'true' }] },
    { collections: [{ folders: [], created: 'yesterday' }] },
    [{ folders: [] }, link],
    { tabs: [link], format: 'unknown-extension' },
  ])('rejects malformed or conflicting data atomically: %j', (value) => {
    expect(() => parse(value)).toThrow()
  })
})
