import { describe, expect, it } from 'vitest'
import backup from '../../fixtures/simple-tab-groups-backup.json'
import { parseSessionSnapshotImport } from '@/services/session-snapshot-import'
import { projectSnapshotForRestore } from '@/services/session-snapshot-restore'
import type { SnapshotWindow } from '@/types/session-snapshots'
import { State, TreeItemType } from '@/types/session-tree'

const parse = (value: unknown) =>
  parseSessionSnapshotImport(JSON.stringify(value))
const tab = { url: 'https://example.com', title: 'Example' }
const backupWith = (tabs: unknown[], extra = {}) => ({
  version: '6.0',
  groups: [{ id: 1, title: 'Group', tabs, ...extra }],
})
const windowsOf = (value: unknown) =>
  parse(value).payload.items.filter(
    (item): item is SnapshotWindow => item.type === TreeItemType.WINDOW,
  )

describe('Simple Tab Groups snapshot import', () => {
  it('converts groups, pinned tabs, openers, sub-groups and containers', () => {
    const imported = parse(backup)
    expect(imported.summary).toMatchObject({
      source: 'simple-tab-groups',
      counts: { windows: 3, tabs: 6, notes: 0, separators: 0 },
    })
    expect(imported.summary).not.toHaveProperty('sourceCreatedAt')
    expect(imported.summary.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'pinned-tabs-window', count: 1 }),
        expect.objectContaining({ code: 'groups-as-windows', count: 2 }),
        expect.objectContaining({ code: 'containers-not-imported', count: 1 }),
        expect.objectContaining({ code: 'unsupported-appearance', count: 1 }),
        expect.objectContaining({ code: 'tab-order', count: 1 }),
      ]),
    )
    expect(imported.summary.warnings).not.toContainEqual(
      expect.objectContaining({ code: 'tab-group-metadata' }),
    )

    const [pinned, research, unnamed] = imported.payload.items
    if (
      pinned.type !== TreeItemType.WINDOW ||
      research.type !== TreeItemType.WINDOW ||
      unnamed.type !== TreeItemType.WINDOW
    )
      throw new Error('Expected windows')
    expect(pinned).toMatchObject({ title: 'Pinned tabs', indentLevel: 0 })
    expect(pinned.children).toMatchObject([
      { url: 'https://mail.example.com/', pinned: true, indentLevel: 1 },
    ])

    expect(research).toMatchObject({
      title: 'Research',
      state: State.SAVED,
      incognito: false,
      indentLevel: 0,
      isParent: true,
      savedTime: 1700000100000,
    })
    const [root, child, sibling] = research.children
    expect(research.children).toHaveLength(3)
    expect(root).toMatchObject({
      title: 'Example',
      isParent: true,
      indentLevel: 1,
      savedTime: 1700000000000,
      container: {
        cookieStoreId: 'firefox-container-1',
        name: 'Work',
        color: 'blue',
        colorCode: '#37adff',
        icon: 'briefcase',
        iconUrl: 'resource://usercontext-content/briefcase.svg',
      },
    })
    expect(child).toMatchObject({
      title: 'Article',
      parentUid: root.uid,
      indentLevel: 2,
      tabGroup: { title: 'Reading', color: 'blue', collapsed: true },
    })
    expect(sibling).not.toHaveProperty('parentUid')
    expect(sibling).not.toHaveProperty('container')
    if (child.type !== TreeItemType.TAB || sibling.type !== TreeItemType.TAB)
      throw new Error('Expected tabs')
    expect(sibling.tabGroup).toEqual(child.tabGroup)

    // The second group's first tab was opened from the tab after it.
    expect(unnamed.title).toBe('Group 2')
    expect(
      unnamed.children.map(
        (item) => item.type === TreeItemType.TAB && item.title,
      ),
    ).toEqual(['Example Net', 'Docs'])
    expect(unnamed.children[1].parentUid).toBe(unnamed.children[0].uid)
    expect(unnamed.children[0]).not.toHaveProperty('container')

    for (const window of [pinned, research, unnamed])
      for (const item of window.children)
        for (const field of [
          'id',
          'cookieStoreId',
          'subGroupId',
          'openerOffset',
          'lastAccessed',
          'favIconUrl',
          'thumbnail',
        ])
          expect(item).not.toHaveProperty(field)

    const restored = projectSnapshotForRestore({
      payload: imported.payload,
      mode: 'all',
      selectedUids: new Set(),
      existingUids: new Set(),
    })
    expect(restored.counts).toEqual(imported.summary.counts)
  })

  it('imports minimal and empty backups', () => {
    expect(parse({ version: '6.0', groups: [] }).summary).toMatchObject({
      source: 'simple-tab-groups',
      counts: { windows: 0, tabs: 0, notes: 0, separators: 0 },
      warnings: [],
    })
    const [window] = windowsOf(backupWith([{ url: 'about:blank' }]))
    expect(window).toMatchObject({ title: 'Group', isParent: true })
    expect(window).not.toHaveProperty('savedTime')
    expect(window.children[0]).toMatchObject({
      url: 'about:blank',
      title: 'about:blank',
    })
    expect(windowsOf(backupWith([]))[0]).toMatchObject({
      isParent: false,
      children: [],
    })
  })

  it('repairs out-of-range, self and cyclic opener offsets without dropping tabs', () => {
    const imported = parse(
      backupWith([
        { ...tab, openerOffset: 0 },
        { ...tab, openerOffset: 5 },
        { ...tab, openerOffset: 1 },
        { ...tab, openerOffset: -1 },
        { ...tab, openerOffset: -99 },
      ]),
    )
    expect(imported.summary.counts.tabs).toBe(5)
    expect(imported.summary.warnings).toContainEqual(
      expect.objectContaining({ code: 'invalid-parent-links', count: 4 }),
    )
    const window = imported.payload.items[0]
    if (window.type !== TreeItemType.WINDOW) throw new Error('Expected window')
    expect(window.children.filter((item) => item.parentUid)).toHaveLength(1)
  })

  it('defaults missing sub-group details and keeps groups separate per window', () => {
    const imported = parse({
      groups: [
        {
          title: 'One',
          subGroups: [{ id: 'x', title: 'Future', color: 'future-color' }],
          tabs: [
            { ...tab, subGroupId: 'x' },
            { ...tab, subGroupId: 'missing' },
          ],
        },
        { title: 'Two', tabs: [{ ...tab, subGroupId: 'x' }] },
      ],
    })
    const [one, two] = imported.payload.items as SnapshotWindow[]
    expect(one.children).toMatchObject([
      { tabGroup: { title: 'Future', color: 'grey', collapsed: false } },
      { tabGroup: { color: 'grey', collapsed: false } },
    ])
    const first = one.children[0]
    const other = two.children[0]
    if (first.type !== TreeItemType.TAB || other.type !== TreeItemType.TAB)
      throw new Error('Expected tabs')
    expect(other.tabGroup?.uid).not.toBe(first.tabGroup?.uid)
    expect(imported.summary.warnings).toContainEqual(
      expect.objectContaining({ code: 'tab-group-metadata', count: 3 }),
    )
  })

  it('imports referenced containers and fills a missing color code', () => {
    const imported = parse({
      groups: [
        {
          title: 'Containers',
          tabs: [
            { ...tab, cookieStoreId: 'firefox-container-2' },
            { ...tab, cookieStoreId: 'firefox-container-3' },
            { ...tab, cookieStoreId: 'firefox-default' },
            { ...tab, cookieStoreId: 'firefox-container-9' },
          ],
        },
      ],
      containers: {
        'firefox-container-2': { name: 'Shop', color: 'green', icon: 'cart' },
        'firefox-container-3': { name: 'Odd', color: 'unknown', icon: 'cart' },
      },
    })
    const [window] = imported.payload.items as SnapshotWindow[]
    expect(window.children[0]).toMatchObject({
      container: {
        cookieStoreId: 'firefox-container-2',
        name: 'Shop',
        color: 'green',
        colorCode: '#51cd00',
        icon: 'cart',
      },
    })
    for (const item of window.children.slice(1))
      expect(item).not.toHaveProperty('container')
    expect(imported.summary.warnings).toContainEqual(
      expect.objectContaining({ code: 'containers-not-imported', count: 2 }),
    )
  })

  it.each([
    { groups: [null] },
    { groups: [{ title: 'No tabs' }] },
    { groups: [{ tabs: {} }] },
    { groups: [{ tabs: [null] }] },
    { groups: [{ tabs: [{}] }] },
    { groups: [{ tabs: [{ url: 42 }] }] },
    { groups: [{ title: 42, tabs: [] }] },
    { groups: [{ isArchive: 'yes', tabs: [] }] },
    { groups: [{ tabs: [{ ...tab, openerOffset: 1.5 }] }] },
    { groups: [{ tabs: [{ ...tab, openerOffset: '1' }] }] },
    { groups: [{ tabs: [{ ...tab, lastAccessed: 1e20 }] }] },
    { groups: [{ tabs: [{ ...tab, cookieStoreId: 1 }] }] },
    { groups: [{ tabs: [{ ...tab, subGroupId: 1 }] }] },
    { groups: [{ subGroups: {}, tabs: [] }] },
    { groups: [{ subGroups: [{ id: 1 }], tabs: [] }] },
    { groups: [{ subGroups: [{ id: 'a' }, { id: 'a' }], tabs: [] }] },
    { groups: [], pinnedTabs: {} },
    { groups: [], pinnedTabs: [{ title: 'No URL' }] },
    { groups: [], containers: [] },
  ])('rejects malformed data atomically: %j', (value) => {
    expect(() => parse({ version: '6.0', ...value })).toThrow(
      'Simple Tab Groups',
    )
  })

  it('keeps other formats on their own parsers', () => {
    expect(
      parse({ collections: [{ folders: [{ links: [tab] }] }] }).summary.source,
    ).toBe('session-buddy')
    expect(parse({ sessionTree: [] }).summary.source).toBe('session-flow')
    expect(parse([]).summary.source).toBe('session-flow')
  })
})
