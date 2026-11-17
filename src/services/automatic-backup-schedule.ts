import { DEFAULT_SETTINGS } from '@/defaults/settings'
import type { AutomaticBackupState } from '@/types/backup'
import type { Settings } from '@/types/settings'

const HOUR = 60 * 60 * 1000
const UNIT_MS = {
  hours: HOUR,
  days: 24 * HOUR,
  weeks: 7 * 24 * HOUR,
} as const satisfies Record<Settings['automaticBackupIntervalUnit'], number>

/** A failed run is retried sooner than the schedule, but not in a tight loop. */
export const AUTOMATIC_BACKUP_RETRY_MS = HOUR

// Characters Windows rejects in file names; other systems accept a subset.
const INVALID_CHARACTERS = /[<>:"|?*\p{Cc}]/gu
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const MAX_SEGMENT_LENGTH = 100

export function automaticBackupIntervalMs(
  settings: Pick<
    Settings,
    'automaticBackupInterval' | 'automaticBackupIntervalUnit'
  >,
): number {
  return (
    Math.max(1, settings.automaticBackupInterval) *
    UNIT_MS[settings.automaticBackupIntervalUnit]
  )
}

/**
 * Turns a user-entered folder into a path Firefox accepts inside Downloads.
 * Subfolders separated by / or \ are kept; parts that would leave Downloads
 * or that Windows cannot create are removed or adjusted.
 */
export function sanitizeBackupFolder(folder: string): string {
  const segments = folder
    .split(/[\\/]+/)
    .map((segment) =>
      segment
        .replace(INVALID_CHARACTERS, '')
        .slice(0, MAX_SEGMENT_LENGTH)
        // Windows drops trailing dots and spaces; leading dots hide folders.
        .replace(/^[.\s]+|[.\s]+$/g, ''),
    )
    .filter((segment) => segment !== '')
    .map((segment) => (RESERVED_NAMES.test(segment) ? `${segment}_` : segment))
  return segments.length > 0
    ? segments.join('/')
    : DEFAULT_SETTINGS.automaticBackupFolder
}

export function automaticBackupFileName(folder: string, slot: number): string {
  return `${sanitizeBackupFolder(folder)}/session-flow-backup-${slot}.json`
}

/** The slot to write next; a lowered keep count starts again from 1. */
export function currentSlot(
  state: Pick<AutomaticBackupState, 'nextSlot'>,
  keepCount: number,
): number {
  const slot = Math.trunc(state.nextSlot)
  return slot >= 1 && slot <= keepCount ? slot : 1
}

export function slotAfter(slot: number, keepCount: number): number {
  return slot >= keepCount ? 1 : slot + 1
}

/**
 * When the next run is due. A backup that has never run is due now; a failed
 * run is retried after an hour, or sooner when the schedule is shorter.
 */
export function nextAutomaticBackupAt(
  state: AutomaticBackupState,
  settings: Pick<
    Settings,
    'automaticBackupInterval' | 'automaticBackupIntervalUnit'
  >,
  now: number,
): number {
  const interval = automaticBackupIntervalMs(settings)
  if (
    state.lastErrorAt !== undefined &&
    state.lastErrorAt >= (state.lastRunAt ?? 0)
  ) {
    return state.lastErrorAt + Math.min(interval, AUTOMATIC_BACKUP_RETRY_MS)
  }
  if (state.lastRunAt === undefined) return now
  return state.lastRunAt + interval
}

export function normalizeAutomaticBackupState(
  value: unknown,
): AutomaticBackupState {
  const state: AutomaticBackupState = { nextSlot: 1 }
  if (typeof value !== 'object' || value === null) return state
  const stored = value as Record<string, unknown>
  if (isNonNegativeNumber(stored.nextSlot) && stored.nextSlot >= 1) {
    state.nextSlot = Math.trunc(stored.nextSlot)
  }
  for (const key of ['lastRunAt', 'lastBackupAt', 'lastErrorAt'] as const) {
    if (isNonNegativeNumber(stored[key])) state[key] = stored[key]
  }
  for (const key of ['lastFile', 'lastDigest', 'lastError'] as const) {
    if (typeof stored[key] === 'string') state[key] = stored[key]
  }
  return state
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
