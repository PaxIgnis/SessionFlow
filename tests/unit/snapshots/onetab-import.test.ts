import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSessionSnapshotImport } from '@/services/session-snapshot-import'
import { projectSnapshotForRestore } from '@/services/session-snapshot-restore'
import type { SnapshotWindow } from '@/types/session-snapshots'
import { State, TreeItemType } from '@/types/session-tree'

const exportText = readFileSync(
  new URL('../../fixtures/onetab-export.txt', import.meta.url),
  'utf8',
)
const windowsOf = (text: string) =>
  parseSessionSnapshotImport(text).payload.items as SnapshotWindow[]

describe('OneTab snapshot import', () => {
  it('converts each blank-line separated block into a saved window', () => {
    const imported = parseSessionSnapshotImport(exportText)
    // The export ends a block after inner groups too, so the first OneTab
    // group (tabs, two inner groups, then a tab) arrives as two blocks.
    expect(imported.summary).toEqual({
      source: 'onetab',
      counts: { windows: 5, tabs: 8, notes: 0, separators: 0 },
      warnings: [
        expect.objectContaining({ code: 'groups-as-windows', count: 5 }),
        expect.objectContaining({ code: 'browser-specific-urls', count: 1 }),
      ],
    })
    const windows = imported.payload.items as SnapshotWindow[]
    for (const window of windows) {
      expect(window).toMatchObject({
        type: TreeItemType.WINDOW,
        state: State.SAVED,
        incognito: false,
        indentLevel: 0,
        isParent: true,
      })
      expect(window).not.toHaveProperty('title')
    }
    expect(
      windows.map((window) =>
        window.children.map(
          (tab) => tab.type === TreeItemType.TAB && [tab.url, tab.title],
        ),
      ),
    ).toEqual([
      [
        [
          'https://en.wikipedia.org/wiki/Sleep_deprivation',
          'Sleep deprivation - Wikipedia',
        ],
        ['https://google.com', 'google.com'],
      ],
      [
        [
          'https://en.wikipedia.org/wiki/Insomnia',
          'Insomnia - Wikipedia This is an edit to the title.',
        ],
      ],
      [
        [
          'https://en.wikipedia.org/wiki/Sleep_deprivation',
          'Sleep deprivation - Wikipedia',
        ],
      ],
      [['https://www.reddit.com', 'Reddit - The heart of the internet']],
      [
        ['chrome://extensions', 'Extensions'],
        ['https://example.com/', 'Example & Co'],
        ['https://example.org/search?q=a%7Cb&page=2', 'Search results'],
      ],
    ])
    for (const tab of windows.flatMap((window) => window.children)) {
      expect(tab).toMatchObject({
        state: State.SAVED,
        pinned: false,
        indentLevel: 1,
      })
      expect(tab).not.toHaveProperty('parentUid')
    }
    const restored = projectSnapshotForRestore({
      payload: imported.payload,
      mode: 'all',
      selectedUids: new Set(),
      existingUids: new Set(),
    })
    expect(restored.counts).toEqual(imported.summary.counts)
  })

  it('splits titles at the first separator and accepts Windows line endings', () => {
    const [window] = windowsOf(
      'https://a.example | Article | Part 1\r\nhttps://b.example\r\n',
    )
    expect(window.children).toMatchObject([
      { url: 'https://a.example', title: 'Article | Part 1' },
      { url: 'https://b.example', title: 'https://b.example' },
    ])
  })

  it('tolerates a byte order mark, surrounding whitespace and repeated blank lines', () => {
    const windows = windowsOf(
      String.fromCharCode(0xfeff) +
        '\n\n  https://a.example | A  \n\n\n\nabout:blank\nhttps://b.example |\n\n',
    )
    expect(windows).toHaveLength(2)
    expect(windows[0].children).toMatchObject([
      { url: 'https://a.example', title: 'A' },
    ])
    expect(windows[1].children).toMatchObject([
      { url: 'about:blank', title: 'about:blank' },
      { url: 'https://b.example', title: 'https://b.example' },
    ])
  })

  it.each([
    '',
    '\n\n',
    'not a url',
    'https://example.com | Example\nplain text',
    'Example | https://example.com',
    '{not json',
  ])('rejects text that is not a OneTab export: %j', (text) => {
    expect(() => parseSessionSnapshotImport(text)).toThrow(
      'not a valid snapshot file',
    )
  })

  it('leaves JSON files to the JSON parsers', () => {
    expect(parseSessionSnapshotImport('[]').summary.source).toBe('session-flow')
  })
})
