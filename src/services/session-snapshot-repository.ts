import { validateSessionSnapshotPayload } from '@/services/session-snapshot-codec'
import type {
  SessionSnapshotMetadata,
  SessionSnapshotPayload,
  SessionSnapshotRecord,
} from '@/types/session-snapshots'

const DATABASE_NAME = 'session-flow-snapshots'
const DATABASE_VERSION = 1
const METADATA_STORE = 'snapshotMetadata'
const PAYLOAD_STORE = 'snapshotPayloads'

export interface SessionSnapshotRepository {
  initialize(): Promise<void>
  create(
    metadata: SessionSnapshotMetadata,
    payload: SessionSnapshotPayload,
  ): Promise<void>
  listMetadata(): Promise<SessionSnapshotMetadata[]>
  get(id: string): Promise<SessionSnapshotRecord>
  setProtected(id: string, value: boolean): Promise<void>
  delete(id: string): Promise<void>
  clear(): Promise<void>
  deleteExcept(retainedIds: ReadonlySet<string>): Promise<void>
  approximateBytes(): Promise<number>
}

interface RepositoryOptions {
  indexedDB?: IDBFactory
  databaseName?: string
}

export class IndexedDbSessionSnapshotRepository implements SessionSnapshotRepository {
  private database?: IDBDatabase
  private readonly factory?: IDBFactory
  private readonly databaseName: string

  constructor(options: RepositoryOptions = {}) {
    this.factory = options.indexedDB
    this.databaseName = options.databaseName ?? DATABASE_NAME
  }

  async initialize(): Promise<void> {
    await this.open()
    await this.repairRecords()
  }

  close(): void {
    this.database?.close()
    this.database = undefined
  }

  async create(
    metadata: SessionSnapshotMetadata,
    payload: SessionSnapshotPayload,
  ): Promise<void> {
    const validatedPayload = validateSessionSnapshotPayload(payload)
    const database = await this.open()
    const transaction = database.transaction(
      [METADATA_STORE, PAYLOAD_STORE],
      'readwrite',
    )
    transaction.objectStore(METADATA_STORE).put(structuredClone(metadata))
    transaction.objectStore(PAYLOAD_STORE).put(validatedPayload, metadata.id)
    await transactionDone(transaction)
  }

  async listMetadata(): Promise<SessionSnapshotMetadata[]> {
    const database = await this.open()
    const transaction = database.transaction(METADATA_STORE)
    const metadata = await requestResult<SessionSnapshotMetadata[]>(
      transaction.objectStore(METADATA_STORE).getAll(),
    )
    await transactionDone(transaction)
    return metadata.sort((left, right) => right.createdAt - left.createdAt)
  }

  async get(id: string): Promise<SessionSnapshotRecord> {
    const database = await this.open()
    const transaction = database.transaction([METADATA_STORE, PAYLOAD_STORE])
    const metadataRequest = transaction.objectStore(METADATA_STORE).get(id)
    const payloadRequest = transaction.objectStore(PAYLOAD_STORE).get(id)
    const [metadata, payload] = await Promise.all([
      requestResult<SessionSnapshotMetadata | undefined>(metadataRequest),
      requestResult<unknown>(payloadRequest),
    ])
    await transactionDone(transaction)
    if (!metadata) throw new Error(`Session snapshot not found: ${id}`)
    if (!metadata.available || payload === undefined) {
      if (metadata.available && payload === undefined) {
        await this.markUnavailable(id)
      }
      throw new Error(`Session snapshot payload is unavailable: ${id}`)
    }
    let validatedPayload: SessionSnapshotPayload
    try {
      validatedPayload = validateSessionSnapshotPayload(payload)
    } catch (error) {
      await this.markUnavailable(id).catch(() => undefined)
      throw error
    }
    return {
      metadata,
      payload: validatedPayload,
    }
  }

  async setProtected(id: string, value: boolean): Promise<void> {
    const database = await this.open()
    const transaction = database.transaction(METADATA_STORE, 'readwrite')
    const store = transaction.objectStore(METADATA_STORE)
    const metadata = await requestResult<SessionSnapshotMetadata | undefined>(
      store.get(id),
    )
    if (!metadata) {
      transaction.abort()
      throw new Error(`Session snapshot not found: ${id}`)
    }
    store.put({ ...metadata, protected: value })
    await transactionDone(transaction)
  }

  async delete(id: string): Promise<void> {
    const database = await this.open()
    const transaction = database.transaction(
      [METADATA_STORE, PAYLOAD_STORE],
      'readwrite',
    )
    transaction.objectStore(METADATA_STORE).delete(id)
    transaction.objectStore(PAYLOAD_STORE).delete(id)
    await transactionDone(transaction)
  }

  async clear(): Promise<void> {
    const database = await this.open()
    const transaction = database.transaction(
      [METADATA_STORE, PAYLOAD_STORE],
      'readwrite',
    )
    transaction.objectStore(METADATA_STORE).clear()
    transaction.objectStore(PAYLOAD_STORE).clear()
    await transactionDone(transaction)
  }

  async deleteExcept(retainedIds: ReadonlySet<string>): Promise<void> {
    const database = await this.open()
    const readTransaction = database.transaction(METADATA_STORE)
    const metadata = await requestResult<SessionSnapshotMetadata[]>(
      readTransaction.objectStore(METADATA_STORE).getAll(),
    )
    await transactionDone(readTransaction)
    const idsToDelete = metadata
      .map((item) => item.id)
      .filter((id) => !retainedIds.has(id))
    if (idsToDelete.length === 0) return

    const writeTransaction = database.transaction(
      [METADATA_STORE, PAYLOAD_STORE],
      'readwrite',
    )
    for (const id of idsToDelete) {
      writeTransaction.objectStore(METADATA_STORE).delete(id)
      writeTransaction.objectStore(PAYLOAD_STORE).delete(id)
    }
    await transactionDone(writeTransaction)
  }

  async approximateBytes(): Promise<number> {
    return (await this.listMetadata()).reduce(
      (total, item) => total + item.sizeBytes,
      0,
    )
  }

  private async open(): Promise<IDBDatabase> {
    if (this.database) return this.database
    const factory = this.factory ?? globalThis.indexedDB
    if (!factory) throw new Error('IndexedDB is unavailable')
    this.database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(this.databaseName, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(METADATA_STORE)) {
          database.createObjectStore(METADATA_STORE, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(PAYLOAD_STORE)) {
          database.createObjectStore(PAYLOAD_STORE)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () =>
        reject(request.error ?? new Error('Failed to open snapshot database'))
      request.onblocked = () =>
        reject(new Error('Session snapshot database upgrade is blocked'))
    })
    return this.database
  }

  private async repairRecords(): Promise<void> {
    const database = await this.open()
    const readTransaction = database.transaction([
      METADATA_STORE,
      PAYLOAD_STORE,
    ])
    const [metadata, payloadKeys] = await Promise.all([
      requestResult<SessionSnapshotMetadata[]>(
        readTransaction.objectStore(METADATA_STORE).getAll(),
      ),
      requestResult<IDBValidKey[]>(
        readTransaction.objectStore(PAYLOAD_STORE).getAllKeys(),
      ),
    ])
    await transactionDone(readTransaction)

    const metadataIds = new Set(metadata.map((item) => item.id))
    const payloadIds = new Set(payloadKeys.map(String))
    const orphanPayloadIds = [...payloadIds].filter(
      (id) => !metadataIds.has(id),
    )
    const repairedMetadata = metadata.filter(
      (item) => item.available && !payloadIds.has(item.id),
    )
    if (orphanPayloadIds.length === 0 && repairedMetadata.length === 0) return

    const writeTransaction = database.transaction(
      [METADATA_STORE, PAYLOAD_STORE],
      'readwrite',
    )
    for (const id of orphanPayloadIds) {
      writeTransaction.objectStore(PAYLOAD_STORE).delete(id)
    }
    for (const item of repairedMetadata) {
      writeTransaction
        .objectStore(METADATA_STORE)
        .put({ ...item, available: false })
    }
    await transactionDone(writeTransaction)
  }

  private async markUnavailable(id: string): Promise<void> {
    const database = await this.open()
    const transaction = database.transaction(METADATA_STORE, 'readwrite')
    const store = transaction.objectStore(METADATA_STORE)
    const metadata = await requestResult<SessionSnapshotMetadata | undefined>(
      store.get(id),
    )
    if (metadata?.available) {
      store.put({ ...metadata, available: false })
    }
    await transactionDone(transaction)
  }
}

function requestResult<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}
