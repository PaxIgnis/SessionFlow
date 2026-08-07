import type { SessionSnapshotMetadata } from '@/types/session-snapshots'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const SIX_HOURS_MS = 6 * HOUR_MS

export function snapshotIdsToRetain(
  metadata: readonly SessionSnapshotMetadata[],
  now: number = Date.now(),
): Set<string> {
  const newestFirst = [...metadata].sort(
    (left, right) => right.createdAt - left.createdAt,
  )
  const retained = new Set<string>()

  for (const item of newestFirst) {
    if (item.protected || now - item.createdAt <= SIX_HOURS_MS) {
      retained.add(item.id)
    }
  }
  for (const item of newestFirst.slice(0, 10)) retained.add(item.id)

  retainNewestCalendarBuckets(newestFirst, retained, (date) =>
    dailyBucket(date, now),
  )
  retainNewestCalendarBuckets(newestFirst, retained, (date) =>
    weeklyBucket(date, now),
  )
  retainNewestCalendarBuckets(newestFirst, retained, (date) =>
    monthlyBucket(date, now),
  )
  retainNewestCalendarBuckets(newestFirst, retained, (date) =>
    yearlyBucket(date, now),
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

function dailyBucket(date: Date, now: number): string | undefined {
  const difference = localDayNumber(new Date(now)) - localDayNumber(date)
  if (difference < 0 || difference >= 10) return undefined
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function weeklyBucket(date: Date, now: number): string | undefined {
  const candidateStart = isoWeekStartDayNumber(date)
  const currentStart = isoWeekStartDayNumber(new Date(now))
  const difference = Math.round((currentStart - candidateStart) / 7)
  if (difference < 0 || difference >= 8) return undefined
  return String(candidateStart)
}

function monthlyBucket(date: Date, now: number): string | undefined {
  const current = new Date(now)
  const difference =
    current.getFullYear() * 12 +
    current.getMonth() -
    (date.getFullYear() * 12 + date.getMonth())
  if (difference < 0 || difference >= 12) return undefined
  return `${date.getFullYear()}-${date.getMonth()}`
}

function yearlyBucket(date: Date, now: number): string | undefined {
  const difference = new Date(now).getFullYear() - date.getFullYear()
  if (difference < 0 || difference >= 5) return undefined
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
