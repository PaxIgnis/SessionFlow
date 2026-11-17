import type { SessionSnapshotRepository } from '@/services/session-snapshot-repository'
import type {
  SessionSnapshotMetadata,
  SessionSnapshotPayload,
  SessionSnapshotRecord,
} from '@/types/session-snapshots'

/** Keeps snapshots in memory, so services can be tested without IndexedDB. */
export class MemoryRepository implements SessionSnapshotRepository {
  initialized = false
  records = new Map<string, SessionSnapshotRecord>()

  async initialize() {
    this.initialized = true
  }
  async create(
    metadata: SessionSnapshotMetadata,
    payload: SessionSnapshotPayload,
  ) {
    this.records.set(metadata.id, { metadata, payload })
  }
  async listMetadata() {
    return [...this.records.values()]
      .map((record) => record.metadata)
      .sort((a, b) => b.createdAt - a.createdAt)
  }
  async get(id: string) {
    const record = this.records.get(id)
    if (!record) throw new Error('missing')
    return record
  }
  async setProtected(id: string, value: boolean) {
    const record = await this.get(id)
    record.metadata.protected = value
  }
  async delete(id: string) {
    this.records.delete(id)
  }
  async clear() {
    this.records.clear()
  }
  async deleteExcept(retainedIds: ReadonlySet<string>) {
    for (const id of this.records.keys()) {
      if (!retainedIds.has(id)) this.records.delete(id)
    }
  }
  async approximateBytes() {
    return [...this.records.values()].reduce(
      (sum, record) => sum + record.metadata.sizeBytes,
      0,
    )
  }
}
