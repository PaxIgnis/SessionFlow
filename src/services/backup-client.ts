import { i18n } from '@/services/i18n'
import type {
  BackgroundRestoreSection,
  BackupPreview,
  BackupRequest,
  BackupResponse,
  BackupRestoreResult,
  SessionFlowBackup,
} from '@/types/backup'

async function request<T>(message: BackupRequest): Promise<T> {
  const response = (await browser.runtime.sendMessage(message)) as
    | BackupResponse<T>
    | undefined
  if (!response) throw new Error(i18n.t('backupNoResponse'))
  if (!response.ok) {
    const error = new Error(response.error) as Error & { code?: string }
    error.code = response.code
    throw error
  }
  return response.data
}

export const BackupClient = {
  create: (includeFavicons: boolean) =>
    request<SessionFlowBackup>({
      action: 'createSessionFlowBackup',
      includeFavicons,
    }),
  preview: (json: string) =>
    request<BackupPreview>({ action: 'previewSessionFlowBackup', json }),
  restore: (options: {
    json: string
    sections: BackgroundRestoreSection[]
    allowWithoutSafetySnapshot: boolean
  }) =>
    request<BackupRestoreResult>({
      action: 'restoreSessionFlowBackup',
      ...options,
      sections: [...options.sections],
    }),
}
