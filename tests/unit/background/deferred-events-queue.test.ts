import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeferredEventsQueue } from '@/services/background-deferred-events-queue'

describe('deferred events queue', () => {
  beforeEach(() => {
    DeferredEventsQueue.initializeDeferredEventsQueue()
  })

  it('queues and processes multiple window events in insertion order', () => {
    const calls: string[] = []

    DeferredEventsQueue.addDeferredWindowEvent(10, () => calls.push('first'))
    DeferredEventsQueue.addDeferredWindowEvent(10, () => calls.push('second'))
    DeferredEventsQueue.processDeferredWindowEvents(10)

    expect(calls).toEqual(['first', 'second'])
    expect(DeferredEventsQueue.windows.has(10)).toBe(false)
  })

  it('queues and processes tab events independently by id', () => {
    const tabOne = vi.fn()
    const tabTwo = vi.fn()

    DeferredEventsQueue.addDeferredTabEvent(1, tabOne)
    DeferredEventsQueue.addDeferredTabEvent(2, tabTwo)
    DeferredEventsQueue.processDeferredTabEvents(1)

    expect(tabOne).toHaveBeenCalledTimes(1)
    expect(tabTwo).not.toHaveBeenCalled()
    expect(DeferredEventsQueue.tabs.has(1)).toBe(false)
    expect(DeferredEventsQueue.tabs.has(2)).toBe(true)
  })

  it('does nothing when processing missing window or tab ids', () => {
    expect(() => DeferredEventsQueue.processDeferredWindowEvents(999)).not.toThrow()
    expect(() => DeferredEventsQueue.processDeferredTabEvents(999)).not.toThrow()
    expect(DeferredEventsQueue.windows.size).toBe(0)
    expect(DeferredEventsQueue.tabs.size).toBe(0)
  })
})
