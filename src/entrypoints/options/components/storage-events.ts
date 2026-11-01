// Snapshots live in IndexedDB, which storage.onChanged does not report, so the
// Snapshots section announces changes for the Storage section to re-measure.
export const SNAPSHOTS_CHANGED_EVENT = 'session-flow:snapshots-changed'
