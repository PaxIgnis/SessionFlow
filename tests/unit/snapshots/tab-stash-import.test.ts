import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSessionSnapshotImport } from '@/services/session-snapshot-import'
import { projectSnapshotForRestore } from '@/services/session-snapshot-restore'
import type { SnapshotWindow } from '@/types/session-snapshots'
import { State, TreeItemType } from '@/types/session-tree'

const exportMarkdown = readFileSync(
  new URL('../../fixtures/tab-stash-export.md', import.meta.url),
  'utf8',
)
const windowsOf = (text: string) =>
  parseSessionSnapshotImport(text).payload.items as SnapshotWindow[]

describe('Tab Stash snapshot import', () => {
  it('converts stash folders, sub-folders, dates and escaped links', () => {
    const imported = parseSessionSnapshotImport(exportMarkdown)
    expect(imported.summary).toEqual({
      source: 'tab-stash',
      counts: { windows: 4, tabs: 7, notes: 3, separators: 0 },
      warnings: [
        expect.objectContaining({ code: 'groups-as-windows', count: 4 }),
      ],
    })
    const [loose, saved, renamed, empty] = imported.payload
      .items as SnapshotWindow[]
    for (const window of [loose, saved, renamed, empty])
      expect(window).toMatchObject({
        type: TreeItemType.WINDOW,
        state: State.SAVED,
        incognito: false,
        indentLevel: 0,
      })

    // Links outside any folder come first, in an untitled window.
    expect(loose).not.toHaveProperty('title')
    expect(loose.children).toMatchObject([
      { url: 'https://loose.example/', title: 'Loose link', indentLevel: 1 },
    ])

    // Default folder names become the saved time instead of a title.
    const savedTime = new Date(2026, 10, 17, 1, 23, 45).getTime()
    expect(saved).not.toHaveProperty('title')
    expect(saved).toMatchObject({ savedTime, isParent: true })
    expect(saved.children).toMatchObject([
      {
        url: 'https://en.wikipedia.org/wiki/Sleep_deprivation',
        title: 'Sleep deprivation - Wikipedia',
        savedTime,
      },
      { url: 'https://example.net/', title: 'https://example.net/' },
    ])

    expect(renamed.title).toBe('Reading [draft] & notes')
    expect(renamed).not.toHaveProperty('savedTime')
    const [search, mercury, articles, insomnia, later, example, emptySub] =
      renamed.children
    expect(search).toMatchObject({
      url: 'https://example.org/search?q=a%7Cb&page=2',
      title: 'Search <results>',
      indentLevel: 1,
    })
    expect(mercury).toMatchObject({
      url: 'https://en.wikipedia.org/wiki/Mercury_(disambiguation)',
      title: 'Mercury (disambiguation)',
    })
    expect(articles).toMatchObject({
      type: TreeItemType.NOTE,
      text: 'Articles',
      indentLevel: 1,
      isParent: true,
    })
    expect(articles).not.toHaveProperty('parentUid')
    expect(insomnia).toMatchObject({
      title: 'Insomnia - Wikipedia',
      parentUid: articles.uid,
      indentLevel: 2,
    })
    expect(later).toMatchObject({
      type: TreeItemType.NOTE,
      text: 'Later',
      parentUid: articles.uid,
      indentLevel: 2,
      isParent: true,
    })
    expect(example).toMatchObject({
      title: 'Example',
      parentUid: later.uid,
      indentLevel: 3,
    })
    expect(emptySub).toMatchObject({
      type: TreeItemType.NOTE,
      text: 'Empty sub-folder',
      indentLevel: 1,
      isParent: false,
    })
    expect(emptySub).not.toHaveProperty('parentUid')

    expect(empty).toMatchObject({
      title: 'Empty stash',
      isParent: false,
      children: [],
    })

    const restored = projectSnapshotForRestore({
      payload: imported.payload,
      mode: 'all',
      selectedUids: new Set(),
      existingUids: new Set(),
    })
    expect(restored.counts).toEqual(imported.summary.counts)
  })

  it('imports a real export with sub-folders nested down to the deepest heading', () => {
    const imported = parseSessionSnapshotImport(
      readFileSync(
        new URL('../../fixtures/tab-stash-export-nested.md', import.meta.url),
        'utf8',
      ),
    )
    expect(imported.summary.counts).toEqual({
      windows: 1,
      tabs: 5,
      notes: 4,
      separators: 0,
    })
    const [window] = imported.payload.items as SnapshotWindow[]
    expect(window.title).toBe('This is a good title')
    const [addons, amo, child, newTab, grandchild, reddit, deep, wiki, empty] =
      window.children
    expect(addons).toMatchObject({
      url: 'about:addons',
      title: 'Add-ons Manager',
      indentLevel: 1,
    })
    expect(amo).toMatchObject({
      url: 'https://addons.mozilla.org/en-US/firefox/addon/tab-stash/',
      title: 'Tab Stash – Get this Extension for \u{1F98A} Firefox (en-US)',
    })
    expect(child).toMatchObject({ text: 'This is child group', indentLevel: 1 })
    expect(newTab).toMatchObject({ url: 'about:newtab', parentUid: child.uid })
    expect(grandchild).toMatchObject({
      text: 'Child of child group',
      parentUid: child.uid,
      indentLevel: 2,
    })
    expect(reddit).toMatchObject({
      title:
        'Reddit - The heart of the internet And this is an edit to the name',
      parentUid: grandchild.uid,
      indentLevel: 3,
    })
    expect(deep).toMatchObject({
      text: 'Groups all the way down',
      parentUid: grandchild.uid,
      indentLevel: 3,
    })
    expect(wiki).toMatchObject({ parentUid: deep.uid, indentLevel: 4 })
    expect(empty).toMatchObject({
      type: TreeItemType.NOTE,
      text: 'And tis is an empty group',
      parentUid: deep.uid,
      indentLevel: 4,
      isParent: false,
    })
  })

  it('keeps default names it cannot date and reports them', () => {
    const imported = parseSessionSnapshotImport(
      '## Saved 17.11.2026, 01:23:45\r\n- [A](https://a.example)\r\n',
    )
    expect(imported.payload.items[0]).toMatchObject({
      title: 'Saved 17.11.2026, 01:23:45',
    })
    expect(imported.payload.items[0]).not.toHaveProperty('savedTime')
    expect(imported.summary.warnings).toContainEqual(
      expect.objectContaining({ code: 'dates-not-imported', count: 1 }),
    )
  })

  it('nests sub-folders by heading level even when levels are skipped', () => {
    const [window] = windowsOf(
      '## Stash\n#### Deep\n- [A](https://a.example)\n### Shallow\n- [B](https://b.example)',
    )
    const [deep, a, shallow, b] = window.children
    expect(deep).toMatchObject({ text: 'Deep', indentLevel: 1 })
    expect(a).toMatchObject({ parentUid: deep.uid, indentLevel: 2 })
    expect(shallow).toMatchObject({ text: 'Shallow', indentLevel: 1 })
    expect(shallow).not.toHaveProperty('parentUid')
    expect(b).toMatchObject({ parentUid: shallow.uid })
  })

  it.each([
    '## Only headings\n### No links',
    '# Notes\nSome paragraph text',
    '- [Missing url]()',
    '- [Relative](/path)',
    '- [Unclosed](https://a.example',
    '- [A](https://a.example) trailing',
    '* [Star bullet](https://a.example)',
  ])('rejects text that is not a Tab Stash export: %j', (text) => {
    expect(() => parseSessionSnapshotImport(text)).toThrow(
      'not a valid snapshot file',
    )
  })

  it('leaves OneTab text to the OneTab parser', () => {
    expect(
      parseSessionSnapshotImport('https://a.example | A').summary.source,
    ).toBe('onetab')
  })
})
