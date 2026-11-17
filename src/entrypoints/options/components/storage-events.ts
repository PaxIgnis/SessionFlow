// Snapshots live in IndexedDB, which storage.onChanged does not report, so the
// Snapshots section announces changes for the Storage section to re-measure.
export const SNAPSHOTS_CHANGED_EVENT = 'session-flow:snapshots-changed'

// A backup restore changes snapshots and settings behind the Snapshots
// section's back, so it asks that section to reload.
export const BACKUP_RESTORED_EVENT = 'session-flow:backup-restored'
