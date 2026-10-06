import { describe, expect, it } from 'vitest'
import backup from '../../fixtures/tabs-outliner-backup.json'
import { parseSessionSnapshotImport } from '@/services/session-snapshot-import'
import { projectSnapshotForRestore } from '@/services/session-snapshot-restore'
import { TreeItemType } from '@/types/session-tree'

const parse = (...records: unknown[]) =>
  parseSessionSnapshotImport(
    JSON.stringify([backup.data[0], ...records, backup.data.at(-1)]),
  )

describe('Tabs Outliner group structure', () => {
  it.each(['group', 'savedwin', 'win'])(
    'keeps a %s group branch and wraps consecutive loose tabs in place',
    (type) => {
      const imported = parse(
        [2001, { type: 'textnote', data: { note: 'Courses' } }, [0]],
        [
          2001,
          {
            type,
            data: {},
            marks: { customTitle: 'Term', customFavicon: 'img/group-icon.png' },
            colapsed: true,
          },
          [0, 0],
        ],
        [
          2001,
          { type: 'group', data: {}, marks: { customTitle: 'Subject' } },
          [0, 0, 0],
        ],
        [
          2001,
          { type: 'savedwin', data: {}, marks: { customTitle: 'Reading' } },
          [0, 0, 0, 0],
        ],
        [
          2001,
          { data: { url: 'https://example.com/reading' } },
          [0, 0, 0, 0, 0],
        ],
        [
          2001,
          {
            data: {
              url: 'https://example.com/first',
              active: true,
              pinned: true,
            },
          },
          [0, 0, 1],
        ],
        [2001, { data: { url: 'https://example.com/child' } }, [0, 0, 1, 0]],
        [2001, { data: { url: 'https://example.com/second' } }, [0, 0, 2]],
        [
          2001,
          { type: 'group', data: {}, marks: { customTitle: 'Other subject' } },
          [0, 0, 3],
        ],
        [2001, { data: { url: 'https://example.com/other' } }, [0, 0, 3, 0]],
        [2001, { data: { url: 'https://example.com/last' } }, [0, 0, 4]],
      )
      const { items } = imported.payload
      expect(
        items.map((item) =>
          item.type === TreeItemType.NOTE
            ? item.text
            : item.type === TreeItemType.WINDOW
              ? item.title
              : '',
        ),
      ).toEqual([
        'Courses',
        'Term',
        'Subject',
        'Reading',
        'Imported tabs',
        'Other subject',
        'Imported tabs',
        'Imported tabs',
      ])
      const [
        courses,
        term,
        subject,
        reading,
        tabs,
        other,
        otherTabs,
        lastTabs,
      ] = items
      expect(term).toMatchObject({
        type: TreeItemType.NOTE,
        parentUid: courses.uid,
        indentLevel: 1,
        collapsed: true,
        isParent: true,
      })
      expect(subject).toMatchObject({ parentUid: term.uid, indentLevel: 2 })
      expect(reading).toMatchObject({ parentUid: subject.uid, indentLevel: 3 })
      expect(tabs).toMatchObject({ parentUid: term.uid, indentLevel: 2 })
      expect(other).toMatchObject({ parentUid: term.uid, indentLevel: 2 })
      expect(otherTabs).toMatchObject({ parentUid: other.uid, indentLevel: 3 })
      expect(lastTabs).toMatchObject({ parentUid: term.uid, indentLevel: 2 })
      if (tabs.type !== TreeItemType.WINDOW)
        throw new Error('Expected saved window')
      expect(tabs.children).toHaveLength(3)
      expect(tabs.children[0]).toMatchObject({
        pinned: true,
        indentLevel: 3,
        isParent: true,
      })
      expect(tabs.children[1]).toMatchObject({
        parentUid: tabs.children[0].uid,
        indentLevel: 4,
      })
      expect(tabs.children[2]).not.toHaveProperty('parentUid')
      expect(tabs.savedActiveTabUid).toBe(tabs.children[0].uid)
      expect(imported.summary.counts).toEqual({
        windows: 4,
        tabs: 6,
        notes: 4,
        separators: 0,
      })
      expect(imported.summary.warnings).toContainEqual(
        expect.objectContaining({ code: 'tabs-without-window', count: 3 }),
      )
      expect(
        imported.summary.warnings.some(({ code }) => code === 'nested-windows'),
      ).toBe(false)
      expect(
        projectSnapshotForRestore({
          payload: imported.payload,
          mode: 'all',
          selectedUids: new Set(),
          existingUids: new Set(),
        }).counts,
      ).toEqual(imported.summary.counts)
    },
  )

  it('does not merge loose tabs across separators or different note parents', () => {
    const imported = parse(
      [2001, { data: { url: 'https://example.com/one' } }, [0]],
      [2001, { data: { url: 'https://example.com/two' } }, [1]],
      [2001, { type: 'separatorline', data: {} }, [2]],
      [2001, { data: { url: 'https://example.com/three' } }, [3]],
      [2001, { type: 'textnote', data: { note: 'Note' } }, [4]],
      [2001, { data: { url: 'https://example.com/four' } }, [4, 0]],
    )
    expect(imported.payload.items.map((item) => item.type)).toEqual([
      0, 3, 0, 2, 0,
    ])
    const windows = imported.payload.items.filter(
      (item) => item.type === TreeItemType.WINDOW,
    )
    expect(windows.map((item) => item.children.length)).toEqual([2, 1, 1])
    expect(windows[0]).not.toHaveProperty('parentUid')
    expect(windows[1]).not.toHaveProperty('parentUid')
    expect(windows[2].parentUid).toBe(imported.payload.items[3].uid)
  })

  it.each(['win', 'savedwin'])(
    'preserves incognito status on a %s item',
    (type) => {
      const imported = parse(
        [
          2001,
          { type: 'group', data: {}, marks: { customTitle: 'Group' } },
          [0],
        ],
        [2001, { type, data: { incognito: true } }, [0, 0]],
        [2001, { data: { url: 'https://example.com/private' } }, [0, 0, 0]],
        [2001, { data: { url: 'https://example.com/loose' } }, [0, 1]],
      )
      const [group, privateWindow, looseWindow] = imported.payload.items
      expect(group).toMatchObject({ type: TreeItemType.NOTE, text: 'Group' })
      expect(group).not.toHaveProperty('incognito')
      expect(privateWindow).toMatchObject({
        type: TreeItemType.WINDOW,
        incognito: true,
        parentUid: group.uid,
      })
      expect(looseWindow).toMatchObject({
        type: TreeItemType.WINDOW,
        incognito: false,
        parentUid: group.uid,
      })
    },
  )

  it('keeps ordinary windows with other custom icons as windows', () => {
    const imported = parse(
      [
        2001,
        {
          type: 'savedwin',
          data: {},
          marks: {
            customTitle: 'Window',
            customFavicon: 'https://example.com/group-icon.png',
          },
        },
        [0],
      ],
      [2001, { data: { url: 'https://example.com' } }, [0, 0]],
    )
    expect(imported.payload.items[0]).toMatchObject({
      type: TreeItemType.WINDOW,
      title: 'Window',
    })
    expect(imported.summary.counts).toEqual({
      windows: 1,
      tabs: 1,
      notes: 0,
      separators: 0,
    })
  })
})
