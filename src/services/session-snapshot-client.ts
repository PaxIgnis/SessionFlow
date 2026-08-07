import type {
  SessionSnapshotExport,
  SessionSnapshotListResult,
  SessionSnapshotMetadata,
  SessionSnapshotRecord,
  SessionSnapshotRequest,
  SessionSnapshotResponse,
  SessionSnapshotRestoreMode,
  SessionSnapshotCounts,
} from '@/types/session-snapshots'

async function request<T>(message: SessionSnapshotRequest): Promise<T> {
  const response = (await browser.runtime.sendMessage(message)) as
    | SessionSnapshotResponse<T>
    | undefined
  if (!response) throw new Error('No response from session snapshot service')
  if (!response.ok) {
    const error = new Error(response.error) as Error & { code?: string }
    error.code = response.code
    throw error
  }
  return response.data
}

export const SessionSnapshotClient = {
  list: () =>
    request<SessionSnapshotListResult>({ action: 'listSessionSnapshots' }),
  get: (snapshotId: string) =>
    request<SessionSnapshotRecord>({
      action: 'getSessionSnapshot',
      snapshotId,
    }),
  create: () =>
    request<SessionSnapshotMetadata | undefined>({
      action: 'createSessionSnapshot',
    }),
  setProtected: (snapshotId: string, protectedValue: boolean) =>
    request<Record<string, never>>({
      action: 'setSessionSnapshotProtected',
      snapshotId,
      protected: protectedValue,
    }),
  delete: (snapshotId: string) =>
    request<Record<string, never>>({
      action: 'deleteSessionSnapshot',
      snapshotId,
    }),
  clear: () =>
    request<Record<string, never>>({ action: 'clearSessionSnapshots' }),
  export: (snapshotId: string) =>
    request<SessionSnapshotExport>({
      action: 'getSessionSnapshotExport',
      snapshotId,
    }),
  restoreSummary: (options: {
    snapshotId: string
    mode: SessionSnapshotRestoreMode
    selectedUids: UID[]
  }) =>
    request<SessionSnapshotCounts>({
      action: 'getSessionSnapshotRestoreSummary',
      ...options,
      selectedUids: [...options.selectedUids],
    }),
  restore: (options: {
    snapshotId: string
    mode: SessionSnapshotRestoreMode
    selectedUids: UID[]
    allowWithoutSafetySnapshot: boolean
  }) =>
    request<SessionSnapshotCounts>({
      action: 'restoreSessionSnapshot',
      ...options,
      selectedUids: [...options.selectedUids],
    }),
}
