import type {
  Note,
  Separator,
  Tab,
  TabGroupMetadata,
  Window,
} from '@/types/session-tree'

export const SESSION_SNAPSHOT_SCHEMA_VERSION = 1 as const

export type SessionSnapshotTrigger =
  | 'periodic'
  | 'startup'
  | 'before-restore'
  | 'manual'

export interface SessionSnapshotCounts {
  windows: number
  tabs: number
  notes: number
  separators: number
}

export interface SessionSnapshotMetadata {
  id: string
  schemaVersion: typeof SESSION_SNAPSHOT_SCHEMA_VERSION
  createdAt: number
  trigger: SessionSnapshotTrigger
  protected: boolean
  digest: string
  sizeBytes: number
  counts: SessionSnapshotCounts
  containsPrivateWindows: boolean
  available: boolean
}

export type SnapshotTabGroupMetadata = Omit<TabGroupMetadata, 'id'>

export type SnapshotTab = Omit<
  Tab,
  'id' | 'active' | 'selected' | 'loadingStatus' | 'isVisible' | 'tabGroup'
> & {
  tabGroup?: SnapshotTabGroupMetadata
}

export type SnapshotNote = Omit<Note, 'selected' | 'isVisible'>
export type SnapshotSeparator = Omit<Separator, 'selected' | 'isVisible'>
export type SnapshotWindowChild = SnapshotTab | SnapshotNote | SnapshotSeparator

export type SnapshotWindow = Omit<
  Window,
  'id' | 'active' | 'activeTabId' | 'selected' | 'children' | 'isVisible'
> & {
  children: SnapshotWindowChild[]
}

export type SnapshotTopLevelItem =
  | SnapshotWindow
  | SnapshotNote
  | SnapshotSeparator
export type SnapshotTreeItem = SnapshotTopLevelItem | SnapshotWindowChild

export interface SessionSnapshotPayload {
  schemaVersion: typeof SESSION_SNAPSHOT_SCHEMA_VERSION
  items: SnapshotTopLevelItem[]
}

export interface SessionSnapshotExport {
  format: 'session-flow-snapshot'
  schemaVersion: typeof SESSION_SNAPSHOT_SCHEMA_VERSION
  metadata: SessionSnapshotMetadata
  payload: SessionSnapshotPayload
}

export type SessionSnapshotRestoreMode = 'all' | 'selected'

export type SessionSnapshotRequest =
  | { action: 'listSessionSnapshots' }
  | { action: 'getSessionSnapshot'; snapshotId: string }
  | { action: 'createSessionSnapshot' }
  | {
      action: 'setSessionSnapshotProtected'
      snapshotId: string
      protected: boolean
    }
  | { action: 'deleteSessionSnapshot'; snapshotId: string }
  | { action: 'clearSessionSnapshots' }
  | { action: 'getSessionSnapshotExport'; snapshotId: string }
  | {
      action: 'getSessionSnapshotRestoreSummary'
      snapshotId: string
      mode: SessionSnapshotRestoreMode
      selectedUids: UID[]
    }
  | {
      action: 'restoreSessionSnapshot'
      snapshotId: string
      mode: SessionSnapshotRestoreMode
      selectedUids: UID[]
      allowWithoutSafetySnapshot: boolean
    }

export interface SessionSnapshotListResult {
  snapshots: SessionSnapshotMetadata[]
  totalBytes: number
  activeTreeEmpty: boolean
}

export interface SessionSnapshotRecord {
  metadata: SessionSnapshotMetadata
  payload: SessionSnapshotPayload
}

export type SessionSnapshotResponse<T = unknown> =
  | { ok: true; data: T }
  | {
      ok: false
      error: string
      code?: 'safety-snapshot-failed'
    }
