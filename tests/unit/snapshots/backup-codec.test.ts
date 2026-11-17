import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import {
  countInvalidSettings,
  createSessionFlowBackup,
  parseSessionFlowBackup,
} from '@/services/backup-codec'
import type { SessionSnapshotPayload } from '@/types/session-snapshots'
import { State, TreeItemType } from '@/types/session-tree'

const payload: SessionSnapshotPayload = {
  schemaVersion: 1,
  items: [
    {
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      incognito: false,
      state: State.SAVED,
      indentLevel: 0,
      children: [
        {
          type: TreeItemType.TAB,
          uid: 'tab-1' as UID,
          state: State.SAVED,
          title: 'Example',
          url: 'https://example.test/',
          windowUid: 'window-1' as UID,
          indentLevel: 1,
          pinned: false,
        },
      ],
    },
  ],
}

function snapshotExport(id: string, overrides: Record<string, unknown> = {}) {
  return {
    format: 'session-flow-snapshot',
    schemaVersion: 1,
    metadata: {
      id,
      schemaVersion: 1,
      createdAt: 1_000,
      trigger: 'manual',
      protected: true,
      digest: 'stale',
      sizeBytes: 1,
      counts: { windows: 9, tabs: 9, notes: 9, separators: 9 },
      containsPrivateWindows: false,
      available: true,
      ...overrides,
    },
    payload,
  }
}

function backupJson(sections: Record<string, unknown>, extra = {}) {
  return JSON.stringify({
    format: 'session-flow-backup',
    version: 1,
    exportedAt: 5_000,
    extensionVersion: '1.2.3',
    sections,
    ...extra,
  })
}

describe('backup codec', () => {
  it('reads back every section of a backup it wrote', () => {
    const backup = createSessionFlowBackup({
      exportedAt: 5_000,
      extensionVersion: '1.2.3',
      sections: {
        sessionTree: payload,
        snapshots: [snapshotExport('snapshot-1')] as never,
        settings: { ...DEFAULT_SETTINGS, focusTabOnOpen: false },
        favicons: [
          {
            url: 'example.test',
            dataUrl: 'data:image/png;base64,AAAA',
            timestamp: 10,
          },
        ],
      },
    })

    const parsed = parseSessionFlowBackup(JSON.stringify(backup))

    expect(parsed.invalidSections).toEqual([])
    expect(parsed.skippedSnapshots).toBe(0)
    expect(parsed.backup.exportedAt).toBe(5_000)
    expect(parsed.backup.extensionVersion).toBe('1.2.3')
    expect(parsed.backup.sections.sessionTree).toEqual(payload)
    expect(parsed.backup.sections.settings?.focusTabOnOpen).toBe(false)
    expect(parsed.backup.sections.favicons).toHaveLength(1)
    expect(parsed.backup.sections.snapshots?.[0].metadata).toMatchObject({
      id: 'snapshot-1',
      createdAt: 1_000,
      trigger: 'manual',
      protected: true,
    })
  })

  it('omits sections the backup does not contain', () => {
    const parsed = parseSessionFlowBackup(backupJson({ sessionTree: payload }))

    expect(Object.keys(parsed.backup.sections)).toEqual(['sessionTree'])
  })

  it.each([
    ['not JSON', '{'],
    ['another format', JSON.stringify({ format: 'session-flow-snapshot' })],
    ['an array', '[]'],
    ['missing sections', backupJson({}, { sections: undefined })],
    ['a missing export date', backupJson({}, { exportedAt: 'yesterday' })],
  ])('rejects %s', (_name, json) => {
    expect(() => parseSessionFlowBackup(json)).toThrow(
      'This file is not a Session Flow backup.',
    )
  })

  it('rejects backups from a newer format version', () => {
    expect(() =>
      parseSessionFlowBackup(backupJson({}, { version: 2 })),
    ).toThrow('newer version')
  })

  it('reports a damaged section without dropping the others', () => {
    const parsed = parseSessionFlowBackup(
      backupJson({
        sessionTree: { schemaVersion: 1, items: 'broken' },
        settings: 'broken',
        snapshots: {},
        favicons: 'broken',
      }),
    )

    expect(parsed.invalidSections).toEqual([
      'sessionTree',
      'snapshots',
      'settings',
      'favicons',
    ])
    expect(parsed.backup.sections).toEqual({})
  })

  it('skips unreadable snapshots and keeps the rest', () => {
    const parsed = parseSessionFlowBackup(
      backupJson({
        snapshots: [
          snapshotExport('good'),
          snapshotExport('bad-trigger', { trigger: 'whenever' }),
          snapshotExport('', {}),
          { ...snapshotExport('bad-payload'), payload: { schemaVersion: 9 } },
        ],
      }),
    )

    expect(parsed.invalidSections).toEqual([])
    expect(parsed.skippedSnapshots).toBe(3)
    expect(
      parsed.backup.sections.snapshots?.map((entry) => entry.metadata.id),
    ).toEqual(['good'])
  })

  it('keeps a valid import summary and drops a malformed one', () => {
    const summary = {
      source: 'onetab',
      sourceCreatedAt: 3,
      counts: { windows: 1, tabs: 1, notes: 0, separators: 0 },
      warnings: [{ code: 'tab-order', count: 1, message: 'Reordered' }],
    }
    const parsed = parseSessionFlowBackup(
      backupJson({
        snapshots: [
          snapshotExport('with-summary', { importSummary: summary }),
          snapshotExport('bad-summary', {
            importSummary: { source: 'unknown-extension' },
          }),
        ],
      }),
    )

    const [withSummary, badSummary] = parsed.backup.sections.snapshots ?? []
    expect(withSummary.metadata.importSummary).toEqual(summary)
    expect(badSummary.metadata).not.toHaveProperty('importSummary')
  })

  it('keeps only known settings keys', () => {
    const parsed = parseSessionFlowBackup(
      backupJson({
        settings: { focusTabOnOpen: false, removedInAnOlderVersion: true },
      }),
    )

    expect(parsed.backup.sections.settings).toEqual({ focusTabOnOpen: false })
  })

  it('counts settings that would fall back to their defaults', () => {
    expect(
      countInvalidSettings({
        ...DEFAULT_SETTINGS,
        focusTabOnOpen: 'yes' as never,
        doubleClickOnOpenTab: 'explode' as never,
      }),
    ).toBe(2)
    expect(countInvalidSettings(DEFAULT_SETTINGS)).toBe(0)
  })

  it('drops favicon entries that are not images', () => {
    const parsed = parseSessionFlowBackup(
      backupJson({
        favicons: [
          { url: 'a.test', dataUrl: 'data:image/png;base64,AA', timestamp: 1 },
          { url: 'b.test', dataUrl: 'javascript:alert(1)', timestamp: 1 },
          { url: 'c.test', dataUrl: 'data:image/png;base64,AA', timestamp: -1 },
          'junk',
        ],
      }),
    )

    expect(parsed.backup.sections.favicons?.map((entry) => entry.url)).toEqual([
      'a.test',
    ])
  })
})
