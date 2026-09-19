import { describe, expect, it } from 'vitest'
import backup from '../../fixtures/tab-session-manager-export.json'
import { parseSessionSnapshotImport } from '@/services/session-snapshot-import'
import { projectSnapshotForRestore } from '@/services/session-snapshot-restore'
import { State, TreeItemType } from '@/types/session-tree'

const parse = (value: unknown) =>
  parseSessionSnapshotImport(JSON.stringify(value))
const session = (tabs: Record<string, unknown>, extra = {}) => ({
  name: 'Example session',
  date: 1700000000000,
  sessionStartTime: 1699999900000,
  tag: [],
  tabsNumber: Object.keys(tabs).length,
  windows: { '1': tabs },
  ...extra,
})
const tab = { url: 'https://example.com', title: 'Example' }
const windowsOf = (value: unknown) =>
  parse(value).payload.items.filter((item) => item.type === TreeItemType.WINDOW)

describe('Tab Session Manager snapshot import', () => {
  it('preserves sessions, tags, tab order, hierarchy, groups, dates, and window metadata', () => {
    const imported = parse(backup)
    expect(imported.summary).toMatchObject({
      source: 'tab-session-manager',
      counts: { windows: 2, tabs: 4, notes: 3, separators: 0 },
      warnings: expect.arrayContaining([
        expect.objectContaining({ code: 'sessions-as-notes', count: 2 }),
        expect.objectContaining({ code: 'containers-not-imported', count: 1 }),
        expect.objectContaining({ code: 'tab-group-metadata', count: 1 }),
        expect.objectContaining({ code: 'browser-specific-urls', count: 1 }),
      ]),
    })
    expect(imported.summary).not.toHaveProperty('sourceCreatedAt')
    const [research, tags, window, privateSession, privateWindow] =
      imported.payload.items
    expect(research).toMatchObject({
      text: 'Research',
      type: TreeItemType.NOTE,
      isParent: true,
    })
    expect(tags).toMatchObject({
      text: 'Tags: Work, Read later',
      parentUid: research.uid,
      indentLevel: 1,
    })
    expect(privateSession).toMatchObject({ text: 'Private reading' })
    expect(privateWindow).toMatchObject({
      incognito: true,
      parentUid: privateSession.uid,
    })
    expect(window).toMatchObject({
      title: 'Project',
      parentUid: research.uid,
      state: State.SAVED,
      indentLevel: 1,
      savedTime: 1700000000000,
      windowPosition: { left: 10, top: 20, width: 1200, height: 800 },
    })
    if (
      window.type !== TreeItemType.WINDOW ||
      privateWindow.type !== TreeItemType.WINDOW
    )
      throw new Error('Expected windows')
    const [root, child, sibling] = window.children
    expect(
      window.children.map(
        (item) => item.type === TreeItemType.TAB && item.title,
      ),
    ).toEqual(['Example', 'Article', 'Settings'])
    expect(root).toMatchObject({
      pinned: true,
      isParent: true,
      indentLevel: 2,
      state: State.SAVED,
    })
    expect(child).toMatchObject({ parentUid: root.uid, indentLevel: 3 })
    expect(sibling).not.toHaveProperty('parentUid')
    expect(window.savedActiveTabUid).toBe(root.uid)
    expect(root).toMatchObject({
      tabGroup: { title: 'Reading', color: 'blue', collapsed: true },
    })
    if (
      root.type !== TreeItemType.TAB ||
      child.type !== TreeItemType.TAB ||
      privateWindow.children[0].type !== TreeItemType.TAB
    )
      throw new Error('Expected tabs')
    expect(root.tabGroup).toEqual(child.tabGroup)
    expect(root.uid).not.toBe(privateWindow.children[0].uid)
    expect(root.tabGroup?.uid).not.toBe(privateWindow.children[0].tabGroup?.uid)
    for (const item of window.children) {
      for (const field of [
        'id',
        'active',
        'index',
        'openerTabId',
        'cookieStoreId',
        'container',
        'favIconUrl',
      ])
        expect(item).not.toHaveProperty(field)
    }
    const restored = projectSnapshotForRestore({
      payload: imported.payload,
      mode: 'all',
      selectedUids: new Set(),
      existingUids: new Set(),
    })
    expect(restored.counts).toEqual(imported.summary.counts)
    const restoredWindow = restored.items.find(
      (item) => item.type === TreeItemType.WINDOW,
    )!
    if (restoredWindow.type !== TreeItemType.WINDOW)
      throw new Error('Expected window')
    expect(restoredWindow.children[1].parentUid).toBe(
      restoredWindow.children[0].uid,
    )
    expect(restoredWindow.children[0].uid).not.toBe(root.uid)
  })

  it('preserves a single session date, empty sessions and windows, and pending URLs', () => {
    const imported = parse([
      session(
        {
          '1': { url: '', pendingUrl: 'https://example.org' },
          '2': { url: '' },
        },
        { name: '' },
      ),
    ])
    expect(imported.summary.sourceCreatedAt).toBe(1700000000000)
    expect(imported.payload.items[0]).toMatchObject({ text: 'Session 1' })
    expect(windowsOf([session({})])[0].children).toEqual([])
    expect(parse([session({}, { windows: {} })]).summary.counts).toEqual({
      windows: 0,
      tabs: 0,
      notes: 1,
      separators: 0,
    })
    expect(
      windowsOf([
        session({
          '1': { url: '', pendingUrl: 'https://example.org' },
          '2': { url: '' },
        }),
      ])[0].children,
    ).toMatchObject([{ url: 'https://example.org' }, { url: '' }])
  })

  it('repairs missing, self, cross-window and cyclic parent links without dropping tabs', () => {
    const imported = parse([
      session(
        {
          '1': { ...tab, openerTabId: 1 },
          '2': { ...tab, openerTabId: 99 },
          '3': { ...tab, openerTabId: 4 },
          '4': { ...tab, openerTabId: 3 },
          '5': { ...tab, openerTabId: 6 },
        },
        {
          windows: {
            '1': {
              '1': { ...tab, openerTabId: 1 },
              '2': { ...tab, openerTabId: 99 },
              '3': { ...tab, openerTabId: 4 },
              '4': { ...tab, openerTabId: 3 },
              '5': { ...tab, openerTabId: 6 },
            },
            '2': { '6': tab },
          },
        },
      ),
    ])
    expect(imported.summary.counts.tabs).toBe(6)
    expect(imported.summary.warnings).toContainEqual(
      expect.objectContaining({ code: 'invalid-parent-links', count: 4 }),
    )
    const window = imported.payload.items[1]
    if (window.type !== TreeItemType.WINDOW) throw new Error('Expected window')
    expect(window.children.filter((item) => item.parentUid)).toHaveLength(1)
  })

  it('places descendants beside their parents and reports necessary order changes', () => {
    const input = [
      session({
        '1': { ...tab, index: 0 },
        '2': { ...tab, index: 1 },
        '3': { ...tab, index: 2, openerTabId: 1 },
      }),
    ]
    const imported = parse(input)
    const window = windowsOf(input)[0]
    expect(window.children[1].parentUid).toBe(window.children[0].uid)
    expect(window.children[2]).not.toHaveProperty('parentUid')
    expect(imported.summary.warnings).toContainEqual(
      expect.objectContaining({ code: 'tab-order', count: 1 }),
    )
  })

  it('defaults unavailable group appearance and warns about window display state', () => {
    const imported = parse([
      session(
        { '1': { ...tab, groupId: 0 } },
        {
          tabGroups: [{ id: 0, title: 'Unknown color', color: 'future-color' }],
          windowsInfo: {
            '1': { type: 'popup', state: 'minimized', width: 500 },
          },
        },
      ),
    ])
    const window = imported.payload.items[1]
    if (window.type !== TreeItemType.WINDOW) throw new Error('Expected window')
    expect(window.children[0]).toMatchObject({
      tabGroup: { title: 'Unknown color', color: 'grey', collapsed: false },
    })
    expect(window).not.toHaveProperty('windowPosition')
    expect(imported.summary.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'tab-group-metadata', count: 1 }),
        expect.objectContaining({ code: 'window-presentation', count: 1 }),
      ]),
    )
  })

  it.each([
    { name: 42 },
    { date: 'yesterday' },
    { date: 1e20 },
    { sessionStartTime: null },
    { tag: [42] },
    { windows: [] },
    { windows: { '1': [] } },
    { windows: { '1': { '1': null } } },
    { windows: { '1': { '1': {} } } },
    { windows: { 'bad-id': {} } },
    { windows: { '1': { '1': { ...tab, id: 2 } } } },
    { windows: { '1': { '1': { ...tab, windowId: 2 } } } },
    { windows: { '1': { '1': { ...tab, index: -1 } } } },
    { windows: { '1': { '1': { ...tab, pinned: 'true' } } } },
    { windows: { '1': { '1': { ...tab, url: 42 } } } },
    { windows: { '1': { '1': { ...tab, openerTabId: '1' } } } },
    { windows: { '1': { '1': { ...tab, groupId: 1.5 } } } },
    { windowsInfo: [] },
    { tabGroups: {} },
    { tabGroups: [{ id: 1 }, { id: 1 }] },
  ])('rejects malformed data atomically: %j', (extra) => {
    expect(() =>
      parse([session({ '1': tab }), session({ '1': tab }, extra)]),
    ).toThrow('Tab Session Manager')
  })

  it('keeps Session Buddy and native Session Flow detection separate', () => {
    expect(parse([{ windows: [{ tabs: [tab] }] }]).summary.source).toBe(
      'session-buddy',
    )
    expect(parse([]).summary.source).toBe('session-flow')
    expect(() =>
      parse([session({ '1': tab }), { windows: [{ tabs: [tab] }] }]),
    ).toThrow('Tab Session Manager')
  })
})
