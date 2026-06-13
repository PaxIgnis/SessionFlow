import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import {
  FakeBrowser,
  flushMicrotasks,
  installFakeBrowser,
} from '../../helpers/fake-browser'

describe('on-created queue', () => {
  let fakeBrowser: FakeBrowser

  beforeEach(() => {
    vi.useRealTimers()
    fakeBrowser = installFakeBrowser()
    OnCreatedQueue.pendingWindowCount = 0
    OnCreatedQueue.pendingTabCount = 0
    OnCreatedQueue.pendingWindows = new Map()
    OnCreatedQueue.pendingTabs = new Map()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('merges creator and listener state for pending tabs', () => {
    OnCreatedQueue.addPendingTabToQueue(10, true, false)
    OnCreatedQueue.addPendingTabToQueue(10, false, true)

    expect(OnCreatedQueue.pendingTabs.get(10)).toEqual({
      id: 10,
      complete: false,
      creatorResolved: true,
      listenerResolved: true,
    })
  })

  it('merges creator and listener state for pending windows', () => {
    OnCreatedQueue.addPendingWindowToQueue(20, false, true)
    OnCreatedQueue.addPendingWindowToQueue(20, true, false)

    expect(OnCreatedQueue.pendingWindows.get(20)).toEqual({
      id: 20,
      complete: false,
      creatorResolved: true,
      listenerResolved: true,
    })
  })

  it('resolves user-created tab checks as false when no pending tab count exists', async () => {
    vi.useFakeTimers()
    const result = OnCreatedQueue.isNewTabExtensionGenerated(10)

    await vi.advanceTimersByTimeAsync(100)

    await expect(result).resolves.toBe(false)
    expect(OnCreatedQueue.pendingTabs.has(10)).toBe(false)
  })

  it('resolves user-created window checks as false when no pending window count exists', async () => {
    vi.useFakeTimers()
    const result = OnCreatedQueue.isNewWindowExtensionGenerated(20)

    await vi.advanceTimersByTimeAsync(100)

    await expect(result).resolves.toBe(false)
    expect(OnCreatedQueue.pendingWindows.has(20)).toBe(false)
  })

  it('createTabAndWait waits for listener resolution before resolving created tab', async () => {
    vi.useFakeTimers()
    const createdTab = { id: 42, url: 'https://created.test' }
    const properties = { url: 'https://created.test', active: false }
    fakeBrowser.tabs.create.mockResolvedValue(createdTab)

    const result = OnCreatedQueue.createTabAndWait(properties)
    let resolved = false
    result.then(() => {
      resolved = true
    })
    await flushMicrotasks()

    expect(fakeBrowser.tabs.create).toHaveBeenCalledWith(properties)
    expect(OnCreatedQueue.pendingTabCount).toBe(1)
    expect(OnCreatedQueue.pendingTabs.get(42)).toEqual({
      id: 42,
      complete: false,
      creatorResolved: true,
      listenerResolved: false,
    })

    await vi.advanceTimersByTimeAsync(100)
    expect(resolved).toBe(false)

    OnCreatedQueue.addPendingTabToQueue(42, false, true)
    await vi.advanceTimersByTimeAsync(100)

    await expect(result).resolves.toBe(createdTab)
    expect(resolved).toBe(true)
    expect(OnCreatedQueue.pendingTabCount).toBe(1)
    expect(OnCreatedQueue.pendingTabs.get(42)).toEqual({
      id: 42,
      complete: true,
      creatorResolved: true,
      listenerResolved: true,
    })
  })

  it('createTabAndWait rolls back pending tab count and rethrows when creation fails', async () => {
    const error = new Error('tab create failed')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeBrowser.tabs.create.mockRejectedValue(error)

    await expect(
      OnCreatedQueue.createTabAndWait({ url: 'https://failed.test' }),
    ).rejects.toBe(error)

    expect(fakeBrowser.tabs.create).toHaveBeenCalledWith({
      url: 'https://failed.test',
    })
    expect(OnCreatedQueue.pendingTabCount).toBe(0)
    expect(errorSpy).toHaveBeenCalledWith('Error creating tab:', error)
  })

  it('createWindowAndWait creates positioned URL windows and waits for window and tab listeners', async () => {
    vi.useFakeTimers()
    const properties = {
      url: ['https://a.test', 'https://b.test'],
      left: 111,
      top: 222,
    }
    const createdWindow = {
      id: 9,
      tabs: [{ id: 101 }, { id: 102 }],
    }
    fakeBrowser.windows.create.mockResolvedValue(createdWindow)
    fakeBrowser.windows.update.mockResolvedValue(createdWindow)

    const result = OnCreatedQueue.createWindowAndWait(properties)
    let resolved = false
    result.then(() => {
      resolved = true
    })
    await flushMicrotasks()

    expect(fakeBrowser.windows.create).toHaveBeenCalledWith(properties)
    expect(fakeBrowser.windows.update).toHaveBeenCalledWith(9, {
      left: 111,
      top: 222,
    })
    expect(OnCreatedQueue.pendingWindowCount).toBe(1)
    expect(OnCreatedQueue.pendingTabCount).toBe(2)
    expect(OnCreatedQueue.pendingWindows.get(9)).toEqual({
      id: 9,
      complete: false,
      creatorResolved: true,
      listenerResolved: false,
    })

    await vi.advanceTimersByTimeAsync(100)
    expect(resolved).toBe(false)

    OnCreatedQueue.addPendingWindowToQueue(9, false, true)
    await vi.advanceTimersByTimeAsync(100)
    await flushMicrotasks()

    expect(OnCreatedQueue.pendingTabs.get(101)).toEqual({
      id: 101,
      complete: false,
      creatorResolved: true,
      listenerResolved: false,
    })
    expect(OnCreatedQueue.pendingTabs.get(102)).toEqual({
      id: 102,
      complete: false,
      creatorResolved: true,
      listenerResolved: false,
    })
    expect(resolved).toBe(false)

    OnCreatedQueue.addPendingTabToQueue(101, false, true)
    OnCreatedQueue.addPendingTabToQueue(102, false, true)
    await vi.advanceTimersByTimeAsync(100)

    await expect(result).resolves.toBe(createdWindow)
    expect(resolved).toBe(true)
    expect(OnCreatedQueue.pendingWindows.get(9)?.complete).toBe(true)
    expect(OnCreatedQueue.pendingTabs.get(101)?.complete).toBe(true)
    expect(OnCreatedQueue.pendingTabs.get(102)?.complete).toBe(true)
  })

  it('createWindowAndWait restores pinned state for moved pinned tabs', async () => {
    vi.useFakeTimers()
    const properties = { tabId: 7 }
    const createdWindow = {
      id: 10,
      tabs: [{ id: 7, pinned: false }],
    }
    fakeBrowser.tabs.get.mockResolvedValue({ id: 7, pinned: true })
    fakeBrowser.windows.create.mockResolvedValue(createdWindow)

    const result = OnCreatedQueue.createWindowAndWait(properties)
    await flushMicrotasks()

    expect(fakeBrowser.tabs.get).toHaveBeenCalledWith(7)
    expect(fakeBrowser.windows.create).toHaveBeenCalledWith(properties)
    expect(OnCreatedQueue.pendingTabCount).toBe(1)

    OnCreatedQueue.addPendingWindowToQueue(10, false, true)
    await vi.advanceTimersByTimeAsync(100)
    await flushMicrotasks()

    OnCreatedQueue.addPendingTabToQueue(7, false, true)
    await vi.advanceTimersByTimeAsync(100)

    await expect(result).resolves.toBe(createdWindow)
    expect(fakeBrowser.tabs.update).toHaveBeenCalledWith(7, { pinned: true })
    expect(OnCreatedQueue.pendingTabs.get(7)?.complete).toBe(true)
  })
})
