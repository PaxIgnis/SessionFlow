import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  coordinateCommand,
  resetCommandCoordinatorForTests,
} from '@/services/background-command-coordinator'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('background command coordinator', () => {
  beforeEach(() => {
    resetCommandCoordinatorForTests()
  })

  it('coalesces identical commands for the same item', async () => {
    const pending = deferred<string>()
    const run = vi.fn(() => pending.promise)

    const first = coordinateCommand({
      itemUids: ['tab-1' as UID],
      operationKey: 'open:tab-1',
      coalesce: true,
      run,
    })
    const second = coordinateCommand({
      itemUids: ['tab-1' as UID],
      operationKey: 'open:tab-1',
      coalesce: true,
      run,
    })

    expect(second).toBe(first)
    await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(1)

    pending.resolve('opened')
    await expect(Promise.all([first, second])).resolves.toEqual([
      'opened',
      'opened',
    ])
  })

  it('serializes conflicting commands for the same item', async () => {
    const firstPending = deferred()
    const order: string[] = []

    const first = coordinateCommand({
      itemUids: ['tab-1' as UID],
      operationKey: 'open:tab-1',
      coalesce: true,
      run: async () => {
        order.push('open-start')
        await firstPending.promise
        order.push('open-end')
      },
    })
    const second = coordinateCommand({
      itemUids: ['tab-1' as UID],
      operationKey: 'save:tab-1',
      coalesce: true,
      run: async () => {
        order.push('save')
      },
    })

    await Promise.resolve()
    expect(order).toEqual(['open-start'])

    firstPending.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['open-start', 'open-end', 'save'])
  })

  it('runs queued moves in request order', async () => {
    const firstPending = deferred()
    const destinations: string[] = []

    const first = coordinateCommand({
      itemUids: ['tab-1' as UID],
      operationKey: 'move:tab-1:window-2',
      coalesce: false,
      run: async () => {
        destinations.push('window-2')
        await firstPending.promise
      },
    })
    const second = coordinateCommand({
      itemUids: ['tab-1' as UID],
      operationKey: 'move:tab-1:window-3',
      coalesce: false,
      run: async () => {
        destinations.push('window-3')
      },
    })

    await Promise.resolve()
    expect(destinations).toEqual(['window-2'])
    firstPending.resolve()
    await Promise.all([first, second])
    expect(destinations).toEqual(['window-2', 'window-3'])
  })

  it('allows commands for unrelated items to overlap', async () => {
    const firstPending = deferred()
    const order: string[] = []

    const first = coordinateCommand({
      itemUids: ['tab-1' as UID],
      operationKey: 'save:tab-1',
      coalesce: true,
      run: async () => {
        order.push('first-start')
        await firstPending.promise
        order.push('first-end')
      },
    })
    const second = coordinateCommand({
      itemUids: ['tab-2' as UID],
      operationKey: 'save:tab-2',
      coalesce: true,
      run: async () => {
        order.push('second')
      },
    })

    await second
    expect(order).toEqual(['first-start', 'second'])
    firstPending.resolve()
    await first
  })

  it.each([
    ['rejection', () => Promise.reject(new Error('failed'))],
    [
      'synchronous exception',
      () => {
        throw new Error('failed')
      },
    ],
  ])('releases item ownership after %s', async (_, failingRun) => {
    await expect(
      coordinateCommand({
        itemUids: ['tab-1' as UID],
        operationKey: 'open:tab-1',
        coalesce: true,
        run: failingRun,
      }),
    ).rejects.toThrow('failed')

    const retry = vi.fn().mockResolvedValue('retried')
    await expect(
      coordinateCommand({
        itemUids: ['tab-1' as UID],
        operationKey: 'open:tab-1',
        coalesce: true,
        run: retry,
      }),
    ).resolves.toBe('retried')
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('waits for every item owned by a multi-item command', async () => {
    const tabPending = deferred()
    const windowPending = deferred()
    const order: string[] = []

    const tabCommand = coordinateCommand({
      itemUids: ['tab-1' as UID],
      operationKey: 'save:tab-1',
      coalesce: false,
      run: async () => {
        await tabPending.promise
        order.push('tab')
      },
    })
    const windowCommand = coordinateCommand({
      itemUids: ['window-1' as UID],
      operationKey: 'save:window-1',
      coalesce: false,
      run: async () => {
        await windowPending.promise
        order.push('window')
      },
    })
    const combined = coordinateCommand({
      itemUids: ['window-1' as UID, 'tab-1' as UID, 'tab-1' as UID],
      operationKey: 'move:tab-1:window-1',
      coalesce: false,
      run: async () => {
        order.push('combined')
      },
    })

    tabPending.resolve()
    await tabCommand
    await Promise.resolve()
    expect(order).toEqual(['tab'])

    windowPending.resolve()
    await Promise.all([windowCommand, combined])
    expect(order).toEqual(['tab', 'window', 'combined'])
  })
})
