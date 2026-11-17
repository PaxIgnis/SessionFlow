import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSessionSnapshotImport } from '@/services/session-snapshot-import'
import { projectSnapshotForRestore } from '@/services/session-snapshot-restore'
import type { SnapshotWindow } from '@/types/session-snapshots'
import { State, TreeItemType } from '@/types/session-tree'

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8')
const pageHtml = fixture('tabs-outliner-page.html')
const pageMhtml = fixture('tabs-outliner-page.mhtml')

const node = (type: string, row: string, children = '') =>
  `<li class="nodeTitleAndSubnodesContainer ${type}NTASC">${row}${children ? `<ul class="subnodeslist">${children}</ul>` : ''}</li>`
const page = (children: string) =>
  `<!DOCTYPE html><html><head><title>Tabs Outliner</title></head><body>${node('session', '<div class="nodeTitleContainer sessionNTC"><span class="node_text">Current Session</span></div>', children)}</body></html>`

describe('Tabs Outliner saved page import', () => {
  it('converts the saved tree like the JSON tree dump', () => {
    const imported = parseSessionSnapshotImport(pageMhtml)
    expect(imported.summary).toEqual({
      source: 'tabs-outliner',
      sourceCreatedAt: Date.UTC(2026, 10, 17, 11, 31, 49),
      counts: { windows: 4, tabs: 6, notes: 3, separators: 1 },
      warnings: expect.arrayContaining([
        expect.objectContaining({ code: 'browser-specific-urls', count: 2 }),
        expect.objectContaining({ code: 'groups-as-notes', count: 2 }),
      ]),
    })
    expect(imported.summary.warnings).toHaveLength(2)

    const [main, music, crashed, separator, courses, term, termWindow, open] =
      imported.payload.items
    expect(main).toMatchObject({
      type: TreeItemType.NOTE,
      text: 'MAIN & more',
      indentLevel: 0,
      isParent: true,
    })
    expect(music).toMatchObject({
      type: TreeItemType.WINDOW,
      title: 'Music',
      state: State.SAVED,
      parentUid: main.uid,
      indentLevel: 1,
    })
    if (music.type !== TreeItemType.WINDOW) throw new Error('Expected window')
    const [newTab, cafe, child] = music.children
    expect(newTab).toMatchObject({
      url: 'chrome://newtab/',
      title: 'New Tab',
      indentLevel: 2,
    })
    expect(cafe).toMatchObject({
      url: 'https://example.com/search?q=music&page=2',
      title: 'Café music – playlist',
      customLabel: 'listen later',
      isParent: true,
    })
    expect(music.savedActiveTabUid).toBe(cafe.uid)
    expect(child).toMatchObject({
      url: 'https://example.org/child',
      parentUid: cafe.uid,
      indentLevel: 3,
    })

    // Lists inside a leftover expand animation wrapper are still read.
    expect(crashed).toMatchObject({
      type: TreeItemType.WINDOW,
      title: 'Window (crashed Tue Apr 20 2021)',
    })
    expect((crashed as SnapshotWindow).children).toMatchObject([
      { url: 'https://example.net/', title: 'example.net' },
    ])
    expect(separator).toMatchObject({
      type: TreeItemType.SEPARATOR,
      indentLevel: 0,
    })

    // Groups, including windows with the group icon, become note branches.
    expect(courses).toMatchObject({ type: TreeItemType.NOTE, text: 'Courses' })
    expect(term).toMatchObject({
      type: TreeItemType.NOTE,
      text: 'Term 1',
      parentUid: courses.uid,
      indentLevel: 1,
    })
    // Untitled windows show "Window", which is not kept as a title.
    expect(termWindow).toMatchObject({
      type: TreeItemType.WINDOW,
      parentUid: term.uid,
      indentLevel: 2,
    })
    expect((termWindow as SnapshotWindow).title).toBeUndefined()
    expect(open).toMatchObject({ type: TreeItemType.WINDOW, indentLevel: 0 })
    expect((open as SnapshotWindow).title).toBeUndefined()
    if (open.type !== TreeItemType.WINDOW) throw new Error('Expected window')
    expect(open.savedActiveTabUid).toBe(open.children[0].uid)

    const restored = projectSnapshotForRestore({
      payload: imported.payload,
      mode: 'all',
      selectedUids: new Set(),
      existingUids: new Set(),
    })
    expect(restored.counts).toEqual(imported.summary.counts)
  })

  it('reads the same tree from MHTML and plain HTML saves', () => {
    const fromHtml = parseSessionSnapshotImport(pageHtml)
    const fromMhtml = parseSessionSnapshotImport(pageMhtml)
    expect(fromHtml.payload).toEqual(fromMhtml.payload)
    expect(fromHtml.summary).not.toHaveProperty('sourceCreatedAt')
  })

  it('keeps collapsed branches collapsed', () => {
    const [window] = parseSessionSnapshotImport(
      page(
        node(
          'savedwin',
          '<div class="nodeTitleContainer savedwinNTC collapsedsubnodes"><span class="node_text">Folded</span></div>',
          node(
            'savedtab',
            '<a class="nodeTitleContainer savedtabNTC" href="https://a.example"><span class="node_text">A</span></a>',
          ),
        ),
      ),
    ).payload.items
    expect(window).toMatchObject({ title: 'Folded', collapsed: true })
  })

  it('rejects unknown node types and pages without a session tree', () => {
    expect(() =>
      parseSessionSnapshotImport(
        page(
          node(
            'gdoc',
            '<div class="nodeTitleContainer"><span class="node_text">Doc</span></div>',
          ),
        ),
      ),
    ).toThrow('Unsupported Tabs Outliner node type')
    expect(() =>
      parseSessionSnapshotImport(
        '<!DOCTYPE html><html><body><li class="nodeTitleAndSubnodesContainer savedtabNTASC"></li></body></html>',
      ),
    ).toThrow('Tabs Outliner')
  })

  it('leaves MHTML from other pages unrecognized', () => {
    expect(() =>
      parseSessionSnapshotImport(
        pageMhtml.replace(/activesessionview\.html/g, 'some-other-page.html'),
      ),
    ).toThrow('not a valid snapshot file')
  })
})
