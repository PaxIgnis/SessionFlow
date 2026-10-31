import { DEFAULT_SETTINGS } from '@/defaults/settings'
import type { SessionSnapshotMetadata } from '@/types/session-snapshots'
import type { Settings } from '@/types/settings'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export interface SnapshotRetentionPolicy {
  enabled: boolean
  recentHours: number
  newest: number
  days: number
  weeks: number
  months: number
  years: number
}

export function snapshotRetentionPolicy(
  settings: Pick<
    Settings,
    | 'pruneSessionSnapshots'
    | 'sessionSnapshotKeepRecentHours'
    | 'sessionSnapshotKeepNewest'
    | 'sessionSnapshotKeepDays'
    | 'sessionSnapshotKeepWeeks'
    | 'sessionSnapshotKeepMonths'
    | 'sessionSnapshotKeepYears'
  >,
): SnapshotRetentionPolicy {
  return {
    enabled: settings.pruneSessionSnapshots,
    recentHours: settings.sessionSnapshotKeepRecentHours,
    newest: settings.sessionSnapshotKeepNewest,
    days: settings.sessionSnapshotKeepDays,
    weeks: settings.sessionSnapshotKeepWeeks,
    months: settings.sessionSnapshotKeepMonths,
    years: settings.sessionSnapshotKeepYears,
  }
}

export const DEFAULT_SNAPSHOT_RETENTION =
  snapshotRetentionPolicy(DEFAULT_SETTINGS)

export function snapshotIdsToRetain(
  metadata: readonly SessionSnapshotMetadata[],
  now: number = Date.now(),
  policy: SnapshotRetentionPolicy = DEFAULT_SNAPSHOT_RETENTION,
): Set<string> {
  const newestFirst = [...metadata].sort(
    (left, right) => right.createdAt - left.createdAt,
  )
  if (!policy.enabled) return new Set(newestFirst.map((item) => item.id))
  const retained = new Set<string>()

  for (const item of newestFirst) {
    if (
      item.protected ||
      now - item.createdAt <= policy.recentHours * HOUR_MS
    ) {
      retained.add(item.id)
    }
  }
  for (const item of newestFirst.slice(0, policy.newest)) retained.add(item.id)

  retainNewestCalendarBuckets(newestFirst, retained, (date) =>
    dailyBucket(date, now, policy.days),
  )
  retainNewestCalendarBuckets(newestFirst, retained, (date) =>
    weeklyBucket(date, now, policy.weeks),
  )
  retainNewestCalendarBuckets(newestFirst, retained, (date) =>
    monthlyBucket(date, now, policy.months),
  )
  retainNewestCalendarBuckets(newestFirst, retained, (date) =>
    yearlyBucket(date, now, policy.years),
  )

  return new Set(
    newestFirst.filter((item) => retained.has(item.id)).map((item) => item.id),
  )
}

function retainNewestCalendarBuckets(
  metadata: readonly SessionSnapshotMetadata[],
  retained: Set<string>,
  bucketFor: (date: Date) => string | undefined,
): void {
  const seen = new Set<string>()
  for (const item of metadata) {
    const bucket = bucketFor(new Date(item.createdAt))
    if (bucket === undefined || seen.has(bucket)) continue
    seen.add(bucket)
    retained.add(item.id)
  }
}

function dailyBucket(
  date: Date,
  now: number,
  limit: number,
): string | undefined {
  const difference = localDayNumber(new Date(now)) - localDayNumber(date)
  if (difference < 0 || difference >= limit) return undefined
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function weeklyBucket(
  date: Date,
  now: number,
  limit: number,
): string | undefined {
  const candidateStart = isoWeekStartDayNumber(date)
  const currentStart = isoWeekStartDayNumber(new Date(now))
  const difference = Math.round((currentStart - candidateStart) / 7)
  if (difference < 0 || difference >= limit) return undefined
  return String(candidateStart)
}

function monthlyBucket(
  date: Date,
  now: number,
  limit: number,
): string | undefined {
  const current = new Date(now)
  const difference =
    current.getFullYear() * 12 +
    current.getMonth() -
    (date.getFullYear() * 12 + date.getMonth())
  if (difference < 0 || difference >= limit) return undefined
  return `${date.getFullYear()}-${date.getMonth()}`
}

function yearlyBucket(
  date: Date,
  now: number,
  limit: number,
): string | undefined {
  const difference = new Date(now).getFullYear() - date.getFullYear()
  if (difference < 0 || difference >= limit) return undefined
  return String(date.getFullYear())
}

function localDayNumber(date: Date): number {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS,
  )
}

function isoWeekStartDayNumber(date: Date): number {
  const dayNumber = localDayNumber(date)
  const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay()
  return dayNumber - (dayOfWeek - 1)
}
