import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSessionSnapshotImport } from '@/services/session-snapshot-import'
import { projectSnapshotForRestore } from '@/services/session-snapshot-restore'
import type { SnapshotWindow } from '@/types/session-snapshots'
import { State, TreeItemType } from '@/types/session-tree'

const exportHtml = readFileSync(
  new URL('../../fixtures/onetab-export.html', import.meta.url),
  'utf8',
)
const page = (groups: string) =>
  `<!DOCTYPE html><html><head><title>OneTab export</title></head><body><div id="tabGroupsDiv">${groups}</div></body></html>`
const group = (header: string, list: string) =>
  `<div class="tabGroup"><div class="tabGroupHeader">${header}</div><div class="tabList">${list}</div></div>`
const titleOf = (item: SnapshotWindow['children'][number]) =>
  item.type === TreeItemType.TAB ? item.title : undefined

describe('OneTab HTML snapshot import', () => {
  it('converts groups, names, dates, inner groups and links from a saved HTML file', () => {
    const imported = parseSessionSnapshotImport(exportHtml)
    expect(imported.summary).toEqual({
      source: 'onetab',
      counts: { windows: 4, tabs: 8, notes: 2, separators: 0 },
      warnings: [
        expect.objectContaining({ code: 'browser-specific-urls', count: 1 }),
      ],
    })
    const windows = imported.payload.items as SnapshotWindow[]
    for (const window of windows)
      expect(window).toMatchObject({
        type: TreeItemType.WINDOW,
        state: State.SAVED,
        incognito: false,
        indentLevel: 0,
        isParent: true,
      })
    // Unnamed groups show only their tab count, which is not kept as a title.
    expect(windows.map((window) => window.title)).toEqual([
      undefined,
      'This is a named group',
      'Yeah, a group for reddit tabs',
      undefined,
    ])
    expect(windows[0].savedTime).toBe(
      new Date(2026, 10, 17, 1, 26, 59).getTime(),
    )
    expect(windows[3].savedTime).toBe(
      new Date(2026, 10, 17, 13, 21, 42).getTime(),
    )

    const [before, inner, innerTab, empty, after] = windows[0].children
    expect(before).toMatchObject({
      type: TreeItemType.TAB,
      url: 'https://en.wikipedia.org/wiki/Sleep_deprivation',
      title: 'Sleep deprivation - Wikipedia',
      indentLevel: 1,
      savedTime: windows[0].savedTime,
    })
    expect(before).not.toHaveProperty('parentUid')
    expect(inner).toMatchObject({
      type: TreeItemType.NOTE,
      text: 'This is a test inner group',
      indentLevel: 1,
      isParent: true,
    })
    expect(innerTab).toMatchObject({
      url: 'https://google.com',
      parentUid: inner.uid,
      indentLevel: 2,
    })
    expect(empty).toMatchObject({
      type: TreeItemType.NOTE,
      text: 'And another group, but with no tabs',
      isParent: false,
    })
    expect(after).toMatchObject({
      title: 'Insomnia - Wikipedia This is an edit to the title.',
      indentLevel: 1,
    })
    expect(after).not.toHaveProperty('parentUid')

    expect(windows[3].children.map(titleOf)).toEqual([
      'Extensions',
      'Example & Co',
      'Search results',
    ])
    expect(windows[3].children[2]).toMatchObject({
      url: 'https://example.org/search?q=a%7Cb&page=2',
    })

    const restored = projectSnapshotForRestore({
      payload: imported.payload,
      mode: 'all',
      selectedUids: new Set(),
      existingUids: new Set(),
    })
    expect(restored.counts).toEqual(imported.summary.counts)
  })

  it('reports dates in other locale formats instead of guessing them', () => {
    const imported = parseSessionSnapshotImport(
      page(
        group(
          '<div class="tabGroupTitleText">1 Tab</div><div class="createdDate">Erstellt 17.11.26, 01:26:59</div>',
          '<div class="tab"><a class="tabLink" href="https://a.example">A</a></div>',
        ),
      ),
    )
    expect(imported.payload.items[0]).not.toHaveProperty('savedTime')
    expect(imported.payload.items[0]).not.toHaveProperty('title')
    expect(imported.summary.warnings).toEqual([
      expect.objectContaining({ code: 'dates-not-imported', count: 1 }),
    ])
  })

  it('skips rows without a link and imports empty groups as empty windows', () => {
    const [window] = parseSessionSnapshotImport(
      page(group('', '<div class="tab"><a class="tabLink">No link</a></div>')),
    ).payload.items as SnapshotWindow[]
    expect(window).toMatchObject({ isParent: false, children: [] })
  })

  it('rejects other HTML pages', () => {
    expect(() =>
      parseSessionSnapshotImport(
        '<!DOCTYPE html><html><body><a href="https://a.example">A</a></body></html>',
      ),
    ).toThrow('not a valid snapshot file')
  })
})
