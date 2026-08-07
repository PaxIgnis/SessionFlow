import { beforeEach, describe, expect, it } from 'vitest'
import { Tree } from '@/services/background-tree'
import {
  captureSessionSnapshot,
  createSessionSnapshotExport,
  validateSessionSnapshotPayload,
} from '@/services/session-snapshot-codec'
import { State, TreeItemType } from '@/types/session-tree'
import {
  createNote,
  createSeparator,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'

describe('session snapshot codec', () => {
  beforeEach(() => resetTree())

  it('captures historical tree data while removing transient runtime fields', async () => {
    const tab = createTab('tab-1' as UID, {
      active: true,
      id: 10,
      isVisible: true,
      selected: true,
      state: State.DISCARDED,
      tabGroup: {
        uid: 'group-1' as UID,
        id: 99,
        color: 'blue',
        collapsed: false,
        title: 'Research',
      },
    })
    const note = createNote('note-1' as UID, { text: 'Remember this' })
    const separator = createSeparator('separator-1' as UID)
    createWindow('window-1' as UID, [tab, note, separator], {
      active: true,
      activeTabId: tab.id,
      id: 20,
      incognito: false,
      selected: true,
      title: 'Snapshot source',
      windowPosition: { left: -100, top: 0, width: 800, height: 600 },
    })

    const result = await captureSessionSnapshot(Tree.Items, {
      includePrivateWindows: true,
    })
    const window = result.payload.items[0]
    expect(window).toMatchObject({
      type: TreeItemType.WINDOW,
      title: 'Snapshot source',
      windowPosition: { left: -100, top: 0, width: 800, height: 600 },
    })
    expect(window).not.toHaveProperty('id')
    expect(window).not.toHaveProperty('active')
    expect(window).not.toHaveProperty('selected')
    if (window.type !== TreeItemType.WINDOW) throw new Error('Expected window')
    expect(window.children[0]).toMatchObject({
      type: TreeItemType.TAB,
      state: State.DISCARDED,
      tabGroup: {
        uid: 'group-1',
        color: 'blue',
        collapsed: false,
        title: 'Research',
      },
    })
    expect(window.children[0]).not.toHaveProperty('id')
    expect(window.children[0]).not.toHaveProperty('active')
    expect(window.children[0]).not.toHaveProperty('selected')
    expect(window.children[0]).not.toHaveProperty('isVisible')
    expect(result.counts).toEqual({
      windows: 1,
      tabs: 1,
      notes: 1,
      separators: 1,
    })
    expect(result.sizeBytes).toBeGreaterThan(0)
  })

  it('omits private windows when private snapshot capture is disabled', async () => {
    createWindow('normal-window' as UID, [], { incognito: false })
    createWindow('private-window' as UID, [], { incognito: true })

    const result = await captureSessionSnapshot(Tree.Items, {
      includePrivateWindows: false,
    })

    expect(result.payload.items).toHaveLength(1)
    expect(result.containsPrivateWindows).toBe(false)
    expect(result.counts.windows).toBe(1)
  })

  it('uses a stable digest that ignores Firefox ids and active state', async () => {
    const tab = createTab('tab-1' as UID, { active: true, id: 10 })
    const window = createWindow('window-1' as UID, [tab], {
      active: true,
      activeTabId: 10,
      id: 20,
    })
    const first = await captureSessionSnapshot(Tree.Items, {
      includePrivateWindows: true,
    })
    tab.id = 100
    tab.active = false
    window.id = 200
    window.active = false
    window.activeTabId = undefined

    const second = await captureSessionSnapshot(Tree.Items, {
      includePrivateWindows: true,
    })

    expect(second.digest).toBe(first.digest)
  })

  it('validates and exports the versioned snapshot envelope', async () => {
    createNote('note-1' as UID, { text: 'Export me' })
    const capture = await captureSessionSnapshot(Tree.Items, {
      includePrivateWindows: true,
    })
    const metadata = {
      id: 'snapshot-1',
      schemaVersion: 1 as const,
      createdAt: 123,
      trigger: 'manual' as const,
      protected: true,
      digest: capture.digest,
      sizeBytes: capture.sizeBytes,
      counts: capture.counts,
      containsPrivateWindows: false,
      available: true,
    }

    expect(validateSessionSnapshotPayload(capture.payload)).toEqual(
      capture.payload,
    )
    expect(createSessionSnapshotExport(metadata, capture.payload)).toEqual({
      format: 'session-flow-snapshot',
      schemaVersion: 1,
      metadata,
      payload: capture.payload,
    })
    expect(() =>
      validateSessionSnapshotPayload({ schemaVersion: 2, items: [] }),
    ).toThrow('Unsupported session snapshot schema version')
    expect(() =>
      validateSessionSnapshotPayload({
        schemaVersion: 1,
        items: [
          {
            type: TreeItemType.WINDOW,
            uid: 'bad-window',
            incognito: false,
            state: State.SAVED,
            indentLevel: 0,
            children: [{ type: TreeItemType.TAB, uid: 'bad-tab' }],
          },
        ],
      }),
    ).toThrow('Invalid snapshot tab')
  })

  it('rejects duplicate item UIDs', () => {
    const note = createSnapshotNote('note-1')

    expect(() =>
      validateSessionSnapshotPayload({
        schemaVersion: 1,
        items: [note, structuredClone(note)],
      }),
    ).toThrow('Duplicate snapshot UID')
  })

  it('rejects children whose window UID does not match their container', () => {
    expect(() =>
      validateSessionSnapshotPayload({
        schemaVersion: 1,
        items: [
          createSnapshotWindow('window-1', [
            createSnapshotNote('note-1', { windowUid: 'window-2' }),
          ]),
        ],
      }),
    ).toThrow('Invalid snapshot child relationship')
  })

  it('rejects self-parenting items', () => {
    expect(() =>
      validateSessionSnapshotPayload({
        schemaVersion: 1,
        items: [
          createSnapshotNote('note-1', {
            indentLevel: 1,
            parentUid: 'note-1',
          }),
        ],
      }),
    ).toThrow('Cyclic snapshot parent relationship')
  })

  it('rejects parent cycles across multiple items', () => {
    expect(() =>
      validateSessionSnapshotPayload({
        schemaVersion: 1,
        items: [
          createSnapshotNote('note-1', {
            indentLevel: 1,
            parentUid: 'note-2',
          }),
          createSnapshotNote('note-2', {
            indentLevel: 1,
            parentUid: 'note-1',
          }),
        ],
      }),
    ).toThrow('Cyclic snapshot parent relationship')
  })

  it('rejects top-level items whose parent is not a note', () => {
    expect(() =>
      validateSessionSnapshotPayload({
        schemaVersion: 1,
        items: [
          createSnapshotWindow('window-1', []),
          createSnapshotNote('note-1', {
            indentLevel: 1,
            parentUid: 'window-1',
          }),
        ],
      }),
    ).toThrow('Invalid snapshot top-level parent relationship')
  })

  it('accepts root-level window children relative to a nested window', () => {
    expect(() =>
      validateSessionSnapshotPayload({
        schemaVersion: 1,
        items: [
          createSnapshotNote('note-1'),
          {
            ...createSnapshotWindow('window-1', [
              {
                type: TreeItemType.TAB,
                uid: 'tab-1',
                state: State.SAVED,
                title: 'Tab 1',
                url: 'https://example.test/',
                windowUid: 'window-1',
                indentLevel: 2,
                pinned: false,
              },
            ]),
            indentLevel: 1,
            parentUid: 'note-1',
          },
        ],
      }),
    ).not.toThrow()
  })

  it('rejects window children whose parent is a separator', () => {
    expect(() =>
      validateSessionSnapshotPayload({
        schemaVersion: 1,
        items: [
          createSnapshotWindow('window-1', [
            {
              type: TreeItemType.SEPARATOR,
              uid: 'separator-1',
              windowUid: 'window-1',
              indentLevel: 1,
            },
            {
              ...createSnapshotNote('note-1'),
              windowUid: 'window-1',
              indentLevel: 2,
              parentUid: 'separator-1',
            },
          ]),
        ],
      }),
    ).toThrow('Invalid snapshot window child parent relationship')
  })
})

function createSnapshotNote(
  uid: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: TreeItemType.NOTE,
    uid,
    text: uid,
    indentLevel: 0,
    ...overrides,
  }
}

function createSnapshotWindow(
  uid: string,
  children: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    type: TreeItemType.WINDOW,
    uid,
    incognito: false,
    state: State.SAVED,
    indentLevel: 0,
    children,
  }
}
