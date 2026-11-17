import type { FaviconCacheEntry } from '@/types/favicons'
import type {
  SessionSnapshotCounts,
  SessionSnapshotExport,
  SessionSnapshotPayload,
} from '@/types/session-snapshots'
import type { Settings } from '@/types/settings'

export const SESSION_FLOW_BACKUP_FORMAT = 'session-flow-backup' as const
export const SESSION_FLOW_BACKUP_VERSION = 1 as const

export const BACKUP_SECTIONS = [
  'sessionTree',
  'snapshots',
  'settings',
  'favicons',
] as const

export type BackupSection = (typeof BACKUP_SECTIONS)[number]

/**
 * Every section is optional, so one reader handles backups made without the
 * favicon cache and files that only some sections could be read from.
 */
export interface SessionFlowBackupSections {
  sessionTree?: SessionSnapshotPayload
  snapshots?: SessionSnapshotExport[]
  settings?: Partial<Settings>
  favicons?: FaviconCacheEntry[]
}

export interface SessionFlowBackup {
  format: typeof SESSION_FLOW_BACKUP_FORMAT
  version: typeof SESSION_FLOW_BACKUP_VERSION
  exportedAt: number
  extensionVersion: string
  sections: SessionFlowBackupSections
}

export interface ParsedSessionFlowBackup {
  backup: SessionFlowBackup
  /** Sections present in the file that failed validation and were dropped. */
  invalidSections: BackupSection[]
  /** Snapshots dropped from an otherwise valid snapshot history. */
  skippedSnapshots: number
}

export interface BackupPreview {
  exportedAt: number
  extensionVersion: string
  sessionTree?: { counts: SessionSnapshotCounts }
  snapshots?: { total: number; new: number }
  settings?: { invalidKeys: number }
  favicons?: { count: number }
  invalidSections: BackupSection[]
  skippedSnapshots: number
}

export interface BackupRestoreResult {
  sessionTree?: SessionSnapshotCounts
  snapshots?: { added: number; skipped: number }
  favicons?: { merged: number }
}

export interface CreateBackupOptions {
  includeFavicons: boolean
}

/** Settings are restored by the settings page; the rest by the background. */
export type BackgroundRestoreSection = Exclude<BackupSection, 'settings'>

export type BackupRequest =
  | { action: 'createSessionFlowBackup'; includeFavicons: boolean }
  | { action: 'previewSessionFlowBackup'; json: string }
  | {
      action: 'restoreSessionFlowBackup'
      json: string
      sections: BackgroundRestoreSection[]
      allowWithoutSafetySnapshot: boolean
    }

export type BackupResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: 'safety-snapshot-failed' }

export const AUTOMATIC_BACKUP_STATE_KEY = 'sessionflow-automatic-backup-state'

/** Kept in storage.local, so the schedule and rotation survive restarts. */
export interface AutomaticBackupState {
  /** The slot the next backup file overwrites, from 1 to the keep count. */
  nextSlot: number
  /** When a run last finished, whether it wrote a file or found no change. */
  lastRunAt?: number
  /** When a backup file was last written, and where. */
  lastBackupAt?: number
  lastFile?: string
  /** Fingerprint of the last written backup, to skip unchanged ones. */
  lastDigest?: string
  /** The most recent failure; cleared by the next successful run. */
  lastError?: string
  lastErrorAt?: number
}

export type AutomaticBackupRequest = { action: 'runAutomaticBackup' }
