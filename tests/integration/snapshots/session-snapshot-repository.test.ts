import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { IndexedDbSessionSnapshotRepository } from '@/services/session-snapshot-repository'
import type {
  SessionSnapshotMetadata,
  SessionSnapshotPayload,
} from '@/types/session-snapshots'

describe('IndexedDB session snapshot repository', () => {
  let factory: IDBFactory
  let repository: IndexedDbSessionSnapshotRepository
  let databaseName: string

  beforeEach(() => {
    factory = new IDBFactory()
    databaseName = `session-flow-test-${crypto.randomUUID()}`
    repository = new IndexedDbSessionSnapshotRepository({
      indexedDB: factory,
      databaseName,
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    repository.close()
    await deleteDatabase(factory, databaseName)
  })

  it('creates and retrieves paired metadata and payload records', async () => {
    await repository.initialize()
    await repository.create(metadata('snapshot-1', 100), payload('note-1'))

    await expect(repository.get('snapshot-1')).resolves.toEqual({
      metadata: metadata('snapshot-1', 100),
      payload: payload('note-1'),
    })
  })

  it('does not write metadata when payload validation fails', async () => {
    await repository.initialize()
    const invalidPayload = payload('duplicate')
    invalidPayload.items.push(structuredClone(invalidPayload.items[0]))

    await expect(
      repository.create(metadata('invalid-create', 100), invalidPayload),
    ).rejects.toThrow('Duplicate snapshot UID')

    await expect(repository.listMetadata()).resolves.toEqual([])
    await expect(
      readRaw(factory, databaseName, 'snapshotMetadata', 'invalid-create'),
    ).resolves.toBeUndefined()
    await expect(
      readRaw(factory, databaseName, 'snapshotPayloads', 'invalid-create'),
    ).resolves.toBeUndefined()
  })

  it('lists metadata newest-first and calculates stored bytes', async () => {
    await repository.initialize()
    await repository.create(metadata('older', 100, false, 20), payload('old'))
    await repository.create(metadata('newer', 200, false, 30), payload('new'))

    expect((await repository.listMetadata()).map((item) => item.id)).toEqual([
      'newer',
      'older',
    ])
    await expect(repository.approximateBytes()).resolves.toBe(50)
  })

  it('updates protection and deletes records transactionally', async () => {
    await repository.initialize()
    await repository.create(metadata('snapshot-1', 100), payload('note-1'))

    await repository.setProtected('snapshot-1', true)
    expect((await repository.get('snapshot-1')).metadata.protected).toBe(true)
    await repository.delete('snapshot-1')
    await expect(repository.get('snapshot-1')).rejects.toThrow(
      'Session snapshot not found',
    )
  })

  it('deletes every record outside the retained set and can clear all records', async () => {
    await repository.initialize()
    await repository.create(metadata('keep', 200), payload('keep-note'))
    await repository.create(metadata('remove', 100), payload('remove-note'))

    await repository.deleteExcept(new Set(['keep']))
    expect((await repository.listMetadata()).map((item) => item.id)).toEqual([
      'keep',
    ])
    await repository.clear()
    await expect(repository.listMetadata()).resolves.toEqual([])
  })

  it('repairs orphan payloads and marks missing payload metadata unavailable', async () => {
    await repository.initialize()
    await repository.create(
      metadata('missing-payload', 200),
      payload('missing'),
    )
    await writeRaw(
      factory,
      databaseName,
      'snapshotPayloads',
      'missing-payload',
      undefined,
    )
    await writeRaw(
      factory,
      databaseName,
      'snapshotPayloads',
      'orphan',
      payload('orphan'),
    )
    repository.close()
    repository = new IndexedDbSessionSnapshotRepository({
      indexedDB: factory,
      databaseName,
    })

    await repository.initialize()

    expect(await repository.listMetadata()).toEqual([
      expect.objectContaining({ id: 'missing-payload', available: false }),
    ])
    await expect(repository.get('missing-payload')).rejects.toThrow(
      'Session snapshot payload is unavailable',
    )
    expect(
      await readRaw(factory, databaseName, 'snapshotPayloads', 'orphan'),
    ).toBeUndefined()
  })

  it('defers invalid payload validation until the record is requested', async () => {
    await repository.initialize()
    await repository.create(metadata('invalid', 200), payload('invalid'))
    await writeRaw(factory, databaseName, 'snapshotPayloads', 'invalid', {
      schemaVersion: 999,
      items: [],
    })
    repository.close()
    repository = new IndexedDbSessionSnapshotRepository({
      indexedDB: factory,
      databaseName,
    })

    await repository.initialize()

    expect(await repository.listMetadata()).toEqual([
      expect.objectContaining({ id: 'invalid', available: true }),
    ])
    await expect(repository.get('invalid')).rejects.toThrow(
      'Unsupported session snapshot schema version',
    )
    expect(await repository.listMetadata()).toEqual([
      expect.objectContaining({ id: 'invalid', available: false }),
    ])
  })

  it('quarantines malformed payloads when the record is requested', async () => {
    await repository.initialize()
    await repository.create(metadata('malformed', 200), payload('malformed'))
    const duplicate = payload('duplicate')
    await writeRaw(factory, databaseName, 'snapshotPayloads', 'malformed', {
      schemaVersion: 1,
      items: [...duplicate.items, structuredClone(duplicate.items[0])],
    })
    repository.close()
    repository = new IndexedDbSessionSnapshotRepository({
      indexedDB: factory,
      databaseName,
    })

    await repository.initialize()

    expect(await repository.listMetadata()).toEqual([
      expect.objectContaining({ id: 'malformed', available: true }),
    ])
    await expect(repository.get('malformed')).rejects.toThrow(
      'Duplicate snapshot UID',
    )
    expect(await repository.listMetadata()).toEqual([
      expect.objectContaining({ id: 'malformed', available: false }),
    ])
  })

  it('does not deserialize payloads during startup repair', async () => {
    await repository.initialize()
    await repository.create(metadata('large-history', 200), payload('large'))

    const getAllSpy = vi.spyOn(IDBObjectStore.prototype, 'getAll')
    repository.close()
    repository = new IndexedDbSessionSnapshotRepository({
      indexedDB: factory,
      databaseName,
    })

    await repository.initialize()

    expect(
      getAllSpy.mock.instances.some(
        (store) => (store as IDBObjectStore).name === 'snapshotPayloads',
      ),
    ).toBe(false)
  })
})

function metadata(
  id: string,
  createdAt: number,
  protectedValue = false,
  sizeBytes = 10,
): SessionSnapshotMetadata {
  return {
    id,
    schemaVersion: 1,
    createdAt,
    trigger: 'periodic',
    protected: protectedValue,
    digest: id,
    sizeBytes,
    counts: { windows: 0, tabs: 0, notes: 1, separators: 0 },
    containsPrivateWindows: false,
    available: true,
  }
}

function payload(uid: string): SessionSnapshotPayload {
  return {
    schemaVersion: 1,
    items: [
      {
        type: 2,
        uid: uid as UID,
        text: uid,
        collapsed: false,
        indentLevel: 0,
        isParent: false,
      },
    ],
  }
}

function deleteDatabase(factory: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function writeRaw(
  factory: IDBFactory,
  name: string,
  storeName: string,
  key: string,
  value: unknown,
): Promise<void> {
  const database = await openDatabase(factory, name)
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite')
    if (value === undefined) transaction.objectStore(storeName).delete(key)
    else transaction.objectStore(storeName).put(value, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

async function readRaw(
  factory: IDBFactory,
  name: string,
  storeName: string,
  key: string,
): Promise<unknown> {
  const database = await openDatabase(factory, name)
  const value = await new Promise((resolve, reject) => {
    const request = database
      .transaction(storeName)
      .objectStore(storeName)
      .get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  database.close()
  return value
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
