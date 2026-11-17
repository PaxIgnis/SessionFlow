import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { i18n } from '@/services/i18n'
import { validateSessionSnapshotPayload } from '@/services/session-snapshot-codec'
import { normalizeSettings } from '@/services/settings-actions'
import type {
  BackupSection,
  ParsedSessionFlowBackup,
  SessionFlowBackup,
  SessionFlowBackupSections,
} from '@/types/backup'
import {
  SESSION_FLOW_BACKUP_FORMAT,
  SESSION_FLOW_BACKUP_VERSION,
} from '@/types/backup'
import type { FaviconCacheEntry } from '@/types/favicons'
import type {
  SessionSnapshotExport,
  SessionSnapshotImportSummary,
  SessionSnapshotMetadata,
  SessionSnapshotTrigger,
} from '@/types/session-snapshots'
import {
  SESSION_SNAPSHOT_IMPORT_SOURCE_LABELS,
  SESSION_SNAPSHOT_SCHEMA_VERSION,
} from '@/types/session-snapshots'
import type { Settings } from '@/types/settings'

const SNAPSHOT_TRIGGERS = new Set<SessionSnapshotTrigger>([
  'periodic',
  'startup',
  'before-restore',
  'manual',
  'import',
])

export function createSessionFlowBackup(options: {
  exportedAt: number
  extensionVersion: string
  sections: SessionFlowBackupSections
}): SessionFlowBackup {
  return {
    format: SESSION_FLOW_BACKUP_FORMAT,
    version: SESSION_FLOW_BACKUP_VERSION,
    exportedAt: options.exportedAt,
    extensionVersion: options.extensionVersion,
    sections: options.sections,
  }
}

/**
 * Reads a backup file. The envelope must be valid; each section is checked on
 * its own, so one damaged section does not stop the others from restoring.
 */
export function parseSessionFlowBackup(json: string): ParsedSessionFlowBackup {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new Error(i18n.t('backupFileInvalid'))
  }
  if (!isRecord(value) || value.format !== SESSION_FLOW_BACKUP_FORMAT) {
    throw new Error(i18n.t('backupFileInvalid'))
  }
  if (value.version !== SESSION_FLOW_BACKUP_VERSION) {
    throw new Error(i18n.t('backupVersionUnsupported'))
  }
  if (!isFiniteNumber(value.exportedAt) || !isRecord(value.sections)) {
    throw new Error(i18n.t('backupFileInvalid'))
  }

  const source = value.sections
  const sections: SessionFlowBackupSections = {}
  const invalidSections: BackupSection[] = []
  let skippedSnapshots = 0

  const readSection = <T>(
    key: BackupSection,
    read: (raw: unknown) => T,
  ): T | undefined => {
    if (source[key] === undefined) return undefined
    try {
      return read(source[key])
    } catch {
      invalidSections.push(key)
      return undefined
    }
  }

  sections.sessionTree = readSection('sessionTree', (raw) =>
    validateSessionSnapshotPayload(raw),
  )
  sections.snapshots = readSection('snapshots', (raw) => {
    if (!Array.isArray(raw)) throw new Error('snapshots')
    const snapshots: SessionSnapshotExport[] = []
    for (const entry of raw) {
      try {
        snapshots.push(validateSnapshotExport(entry))
      } catch {
        skippedSnapshots += 1
      }
    }
    return snapshots
  })
  sections.settings = readSection('settings', (raw) => readSettings(raw))
  sections.favicons = readSection('favicons', (raw) => {
    if (!Array.isArray(raw)) throw new Error('favicons')
    return raw.filter(isFaviconCacheEntry).map((entry) => ({
      url: entry.url,
      dataUrl: entry.dataUrl,
      timestamp: entry.timestamp,
    }))
  })

  for (const key of Object.keys(sections) as BackupSection[]) {
    if (sections[key] === undefined) delete sections[key]
  }

  return {
    backup: createSessionFlowBackup({
      exportedAt: value.exportedAt,
      extensionVersion:
        typeof value.extensionVersion === 'string'
          ? value.extensionVersion
          : '',
      sections,
    }),
    invalidSections,
    skippedSnapshots,
  }
}

/** Returns the settings keys this version understands, as stored. */
function readSettings(raw: unknown): Partial<Settings> {
  if (!isRecord(raw)) throw new Error('settings')
  const settings: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key in DEFAULT_SETTINGS) settings[key] = structuredClone(value)
  }
  return settings as Partial<Settings>
}

/** Counts stored settings that are unknown or would be reset to a default. */
export function countInvalidSettings(settings: Partial<Settings>): number {
  let invalid = 0
  normalizeSettings(settings, () => {
    invalid += 1
  })
  return invalid
}

function validateSnapshotExport(value: unknown): SessionSnapshotExport {
  if (
    !isRecord(value) ||
    value.format !== 'session-flow-snapshot' ||
    !isRecord(value.metadata)
  ) {
    throw new Error('snapshot')
  }
  const metadata = value.metadata
  if (
    typeof metadata.id !== 'string' ||
    metadata.id.length === 0 ||
    !isFiniteNumber(metadata.createdAt) ||
    !SNAPSHOT_TRIGGERS.has(metadata.trigger as SessionSnapshotTrigger) ||
    typeof metadata.protected !== 'boolean'
  ) {
    throw new Error('snapshot metadata')
  }
  const payload = validateSessionSnapshotPayload(value.payload)
  // Sizes, counts and digests are recomputed from the payload on restore, so
  // only the fields describing the snapshot's history are carried over.
  const restoredMetadata: SessionSnapshotMetadata = {
    id: metadata.id,
    schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
    createdAt: metadata.createdAt,
    trigger: metadata.trigger as SessionSnapshotTrigger,
    protected: metadata.protected,
    digest: '',
    sizeBytes: 0,
    counts: { windows: 0, tabs: 0, notes: 0, separators: 0 },
    containsPrivateWindows: false,
    available: true,
  }
  const importSummary = readImportSummary(metadata.importSummary)
  if (importSummary) restoredMetadata.importSummary = importSummary
  return {
    format: 'session-flow-snapshot',
    schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
    metadata: restoredMetadata,
    payload,
  }
}

function readImportSummary(
  value: unknown,
): SessionSnapshotImportSummary | undefined {
  if (
    !isRecord(value) ||
    typeof value.source !== 'string' ||
    !(value.source in SESSION_SNAPSHOT_IMPORT_SOURCE_LABELS) ||
    !isRecord(value.counts) ||
    !Array.isArray(value.warnings)
  ) {
    return undefined
  }
  const counts = value.counts
  if (
    !isCount(counts.windows) ||
    !isCount(counts.tabs) ||
    !isCount(counts.notes) ||
    !isCount(counts.separators)
  ) {
    return undefined
  }
  const warnings = value.warnings.filter(
    (warning): warning is SessionSnapshotImportSummary['warnings'][number] =>
      isRecord(warning) &&
      typeof warning.code === 'string' &&
      isCount(warning.count) &&
      typeof warning.message === 'string',
  )
  return {
    source: value.source as SessionSnapshotImportSummary['source'],
    ...(isFiniteNumber(value.sourceCreatedAt)
      ? { sourceCreatedAt: value.sourceCreatedAt }
      : {}),
    counts: {
      windows: counts.windows,
      tabs: counts.tabs,
      notes: counts.notes,
      separators: counts.separators,
    },
    warnings: structuredClone(warnings),
  }
}

function isFaviconCacheEntry(value: unknown): value is FaviconCacheEntry {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    typeof value.dataUrl === 'string' &&
    value.dataUrl.startsWith('data:image/') &&
    isFiniteNumber(value.timestamp) &&
    value.timestamp >= 0
  )
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
