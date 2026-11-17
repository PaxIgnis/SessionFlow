import { nextAutomaticBackupAt } from '@/services/automatic-backup-schedule'
import { getDisplayLocale, i18n } from '@/services/i18n'
import type { AutomaticBackupState } from '@/types/backup'
import type { Settings } from '@/types/settings'

/** Lines describing the last backup, a newer failure and the next run. */
export function describeAutomaticBackups(
  state: AutomaticBackupState,
  settings: Pick<
    Settings,
    | 'automaticBackups'
    | 'automaticBackupInterval'
    | 'automaticBackupIntervalUnit'
  >,
  now = Date.now(),
): string[] {
  const lines = [
    state.lastBackupAt !== undefined && state.lastFile
      ? i18n.t('automaticBackupLast', [
          formatDateTime(state.lastBackupAt),
          state.lastFile,
        ])
      : i18n.t('automaticBackupNone'),
  ]
  if (
    state.lastError &&
    state.lastErrorAt !== undefined &&
    state.lastErrorAt >= (state.lastRunAt ?? 0)
  ) {
    lines.push(
      i18n.t('automaticBackupLastFailed', [
        formatDateTime(state.lastErrorAt),
        state.lastError,
      ]),
    )
  }
  if (settings.automaticBackups) {
    const next = Math.max(nextAutomaticBackupAt(state, settings, now), now)
    lines.push(i18n.t('automaticBackupNext', [formatDateTime(next)]))
  }
  return lines
}

export function formatDateTime(value: number): string {
  return new Date(value).toLocaleString(getDisplayLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
