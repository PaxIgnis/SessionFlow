import { beforeEach, describe, expect, it } from 'vitest'
import { Tree } from '@/services/background-tree'
import { captureSessionSnapshot } from '@/services/session-snapshot-codec'
import { parseSessionSnapshotImport } from '@/services/session-snapshot-import'
import { State, TreeItemType } from '@/types/session-tree'
import {
  createNote,
  createSeparator,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'

describe('Session Flow snapshot import', () => {
  beforeEach(() => resetTree())

  async function source() {
    const tab = createTab('tab-1' as UID, {
      state: State.DISCARDED,
      tabGroup: {
        uid: 'group-1' as UID,
        id: 42,
        color: 'blue',
        collapsed: false,
      },
    })
    createWindow(
      'window-1' as UID,
      [tab, createNote('note-1' as UID), createSeparator('separator-1' as UID)],
      {
        incognito: true,
      },
    )
    return (
      await captureSessionSnapshot(Tree.Items, { includePrivateWindows: true })
    ).payload
  }

  it('accepts exported snapshots and bare snapshot payloads, including a UTF-8 BOM', async () => {
    const payload = await source()
    const exported = {
      format: 'session-flow-snapshot',
      schemaVersion: 1,
      payload,
      metadata: { id: 'untrusted' },
    }
    expect(
      parseSessionSnapshotImport(JSON.stringify(exported)).payload,
    ).toEqual(payload)
    expect(
      parseSessionSnapshotImport('\uFEFF' + JSON.stringify(payload)).payload,
    ).toEqual(payload)
  })

  it('normalizes native trees and storage exports without losing saved content', async () => {
    const payload = await source()
    for (const value of [Tree.Items, { sessionTree: Tree.Items }]) {
      const imported = parseSessionSnapshotImport(JSON.stringify(value)).payload
      expect(imported).toEqual(payload)
      const window = imported.items[0]
      if (window.type !== TreeItemType.WINDOW)
        throw new Error('Expected window')
      expect(window).not.toHaveProperty('id')
      expect(window.children[0]).not.toHaveProperty('selected')
      expect(window.children[0]).not.toHaveProperty('tabGroup.id')
    }
  })

  it.each([
    ['{', 'not a valid snapshot file'],
    ['null', 'Unsupported import format'],
    ['{"unrecognized":[]}', 'Unsupported import format'],
    [
      '{"format":"other-extension","schemaVersion":1,"payload":{"schemaVersion":1,"items":[]}}',
      'Unsupported import format',
    ],
    [
      '{"format":"session-flow-snapshot","schemaVersion":2,"payload":{"schemaVersion":1,"items":[]}}',
      'Unsupported session snapshot schema version',
    ],
    [
      '{"schemaVersion":2,"items":[]}',
      'Unsupported session snapshot schema version',
    ],
    ['{"schemaVersion":1,"items":[null]}', 'Invalid snapshot tree item'],
    ['[{}]', 'Invalid snapshot tree item'],
  ])('rejects invalid or unsupported input: %s', (json, error) => {
    expect(() => parseSessionSnapshotImport(json)).toThrow(error)
  })

  it('rejects duplicate UIDs and broken relationships before importing', async () => {
    const payload = await source()
    payload.items.push(structuredClone(payload.items[0]))
    expect(() => parseSessionSnapshotImport(JSON.stringify(payload))).toThrow(
      'Duplicate snapshot UID',
    )
    payload.items.pop()
    const window = payload.items[0]
    if (window.type !== TreeItemType.WINDOW) throw new Error('Expected window')
    window.children[0].windowUid = 'missing-window' as UID
    expect(() => parseSessionSnapshotImport(JSON.stringify(payload))).toThrow(
      'Invalid snapshot child relationship',
    )
  })
})
