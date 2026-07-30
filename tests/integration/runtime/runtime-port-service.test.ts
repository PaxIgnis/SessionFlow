import { beforeEach, describe, expect, it, vi } from 'vitest'
import { State, TreeItemType } from '@/types/session-tree'
import { flushMicrotasks, installFakeBrowser } from '../../helpers/fake-browser'
import {
  makeForegroundTab,
  makeForegroundWindow,
} from '../../helpers/foreground-tree-fixtures'

async function loadRuntimePortService() {
  vi.resetModules()
  const browser = installFakeBrowser()
  const treeModule = await import('@/services/background-tree')
  treeModule.Tree.initialized = true
  const runtime = await import('@/services/runtime-port-service')
  return { browser, runtime, Tree: treeModule.Tree }
}

describe('runtime port service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a cloned snapshot to subscribers', async () => {
    const { runtime } = await loadRuntimePortService()
    const window = makeForegroundWindow('window-1' as UID)
    runtime.initializeSessionTreePort({
      dispatchCommand: vi.fn(),
      getSnapshot: () => [window],
    })

    const snapshot = await runtime.subscribeTreePort()

    expect(snapshot).toEqual([window])
    expect(snapshot[0]).not.toBe(window)
  })

  it('sends command requests to the background dispatcher', async () => {
    const { runtime } = await loadRuntimePortService()
    const dispatchCommand = vi.fn()
    runtime.initializeSessionTreePort({
      dispatchCommand,
      getSnapshot: () => [],
    })

    await runtime.sendTreeCommand({
      action: 'moveWindows',
      windowUIDs: ['window-1' as UID],
      targetIndex: 0,
      copy: false,
    })

    expect(dispatchCommand).toHaveBeenCalledWith({
      action: 'moveWindows',
      windowUIDs: ['window-1'],
      targetIndex: 0,
      copy: false,
    })
  })

  it('waits for async command dispatch before resolving command requests', async () => {
    const { runtime } = await loadRuntimePortService()
    let resolveDispatch: () => void = () => {}
    const dispatchPromise = new Promise<void>((resolve) => {
      resolveDispatch = resolve
    })
    const dispatchCommand = vi.fn(() => dispatchPromise)
    runtime.initializeSessionTreePort({
      dispatchCommand,
      getSnapshot: () => [],
    })

    let resolved = false
    const commandPromise = runtime
      .sendTreeCommand({
        action: 'moveTreeItems',
        itemUIDs: ['tab-1' as UID],
        targetIndex: 0,
        targetWindowUid: 'window-1' as UID,
        copy: false,
      })
      .then(() => {
        resolved = true
      })
    await flushMicrotasks()
    await flushMicrotasks()
    await flushMicrotasks()

    expect(dispatchCommand).toHaveBeenCalled()
    expect(resolved).toBe(false)

    resolveDispatch()
    await commandPromise

    expect(resolved).toBe(true)
  })

  it('returns structured warnings from a successful command', async () => {
    const { runtime } = await loadRuntimePortService()
    const result = {
      warnings: [
        {
          code: 'tab-group-restore-partial' as const,
          message: 'One saved tab group could not be restored.',
          affectedCount: 1,
        },
      ],
    }
    runtime.initializeSessionTreePort({
      dispatchCommand: vi.fn().mockResolvedValue(result),
      getSnapshot: () => [],
    })

    await expect(
      runtime.sendTreeCommand({
        action: 'openWindow',
        windowUid: 'window-1' as UID,
      }),
    ).resolves.toEqual(result)
  })

  it('rejects command requests when async dispatch rejects', async () => {
    const { runtime } = await loadRuntimePortService()
    runtime.initializeSessionTreePort({
      dispatchCommand: vi.fn().mockRejectedValue(new Error('remove failed')),
      getSnapshot: () => [],
    })

    await expect(
      runtime.sendTreeCommand({
        action: 'closeTab',
        tabId: 10,
        tabUid: 'tab-1' as UID,
      }),
    ).rejects.toThrow('remove failed')
  })

  it('rejects command requests when the dispatcher throws', async () => {
    const { runtime } = await loadRuntimePortService()
    runtime.initializeSessionTreePort({
      dispatchCommand: () => {
        throw new Error('dispatcher failed')
      },
      getSnapshot: () => [],
    })

    await expect(
      runtime.sendTreeCommand({
        action: 'printSessionTree',
      }),
    ).rejects.toThrow('dispatcher failed')
  })

  it('delivers emitted deltas to foreground listeners', async () => {
    const { runtime } = await loadRuntimePortService()
    const listener = vi.fn()
    runtime.initializeSessionTreePort({
      dispatchCommand: vi.fn(),
      getSnapshot: () => [],
    })

    const unsubscribe = runtime.onTreeDeltaPort(listener)
    await flushMicrotasks()
    runtime.emitTreeDelta({
      op: 'windowCreated',
      index: 0,
      window: {
        type: TreeItemType.WINDOW,
        uid: 'window-1' as UID,
        id: 1,
        incognito: false,
        selected: false,
        state: State.SAVED,
        children: [],
        indentLevel: 0,
      },
    })
    await flushMicrotasks()

    expect(listener).toHaveBeenCalledWith({
      op: 'windowCreated',
      index: 0,
      window: expect.objectContaining({ uid: 'window-1' }),
    })
    unsubscribe()
  })

  it('stops delivering deltas after unsubscribe', async () => {
    const { runtime } = await loadRuntimePortService()
    const listener = vi.fn()
    runtime.initializeSessionTreePort({
      dispatchCommand: vi.fn(),
      getSnapshot: () => [],
    })

    const unsubscribe = runtime.onTreeDeltaPort(listener)
    await flushMicrotasks()
    unsubscribe()
    runtime.emitTreeDelta({
      op: 'windowRemoved',
      windowUid: 'window-1' as UID,
    })
    await flushMicrotasks()

    expect(listener).not.toHaveBeenCalled()
  })

  it('emits treeReplaced deltas using the current snapshot', async () => {
    const { runtime } = await loadRuntimePortService()
    const listener = vi.fn()
    const window = makeForegroundWindow('window-1' as UID)
    runtime.initializeSessionTreePort({
      dispatchCommand: vi.fn(),
      getSnapshot: () => [window],
    })

    runtime.onTreeDeltaPort(listener)
    await flushMicrotasks()
    runtime.emitTreeReplaced()
    await flushMicrotasks()

    expect(listener).toHaveBeenCalledWith({
      op: 'treeReplaced',
      treeItems: [window],
    })
    expect(listener.mock.calls[0][0].treeItems[0]).not.toBe(window)
  })

  it('disconnectTreePort is harmless when no client port is connected', async () => {
    const { runtime } = await loadRuntimePortService()

    expect(() => runtime.disconnectTreePort()).not.toThrow()
  })

  it('disconnect rejects pending requests and clears the client port', async () => {
    const { runtime } = await loadRuntimePortService()
    const pending = runtime.sendTreeCommand({
      action: 'printSessionTree',
    })
    await flushMicrotasks()

    runtime.disconnectTreePort()

    await expect(pending).rejects.toThrow('disconnected')
  })

  it('releases each client port across repeated popup subscription lifecycles (PF-07)', async () => {
    const { browser, runtime } = await loadRuntimePortService()
    runtime.initializeSessionTreePort({
      dispatchCommand: vi.fn(),
      getSnapshot: () => [],
    })

    for (let cycle = 0; cycle < 50; cycle++) {
      const unsubscribe = runtime.subscribeTreeUpdates({
        replaceTree: vi.fn(),
        applyDelta: vi.fn(() => true),
      })
      await flushMicrotasks()
      unsubscribe()
    }

    expect(browser.__ports.clients).toHaveLength(50)
    expect(browser.__ports.clients.every((port) => port.disconnected)).toBe(
      true,
    )
    expect(browser.__ports.servers.every((port) => port.disconnected)).toBe(
      true,
    )

    const unsubscribe = runtime.subscribeTreeUpdates({
      replaceTree: vi.fn(),
      applyDelta: vi.fn(() => true),
    })
    await flushMicrotasks()

    expect(browser.__ports.clients).toHaveLength(51)
    expect(browser.__ports.clients.at(-1)?.disconnected).toBe(false)
    unsubscribe()
    expect(browser.__ports.clients.at(-1)?.disconnected).toBe(true)
  })

  it('buffers a delta received before the subscription snapshot response (RT-01)', async () => {
    const { browser, runtime } = await loadRuntimePortService()
    const snapshot = makeForegroundWindow('window-snapshot' as UID)
    const deltaWindow = makeForegroundWindow('window-delta' as UID)
    const replaceTree = vi.fn()
    const applyDelta = vi.fn(() => true)

    const unsubscribe = runtime.subscribeTreeUpdates({
      replaceTree,
      applyDelta,
    })
    const serverPort = browser.__ports.servers.at(-1)!
    serverPort.onMessage.addListener((message) => {
      const request = message as { type?: string; requestId?: string }
      if (request.type !== 'subscribe' || !request.requestId) return
      serverPort.postMessage({
        type: 'delta',
        version: 2,
        delta: { op: 'windowCreated', window: deltaWindow, index: 1 },
      })
      serverPort.postMessage({
        type: 'response',
        requestId: request.requestId,
        ok: true,
        version: 1,
        treeItems: [snapshot],
      })
    })

    await flushMicrotasks()
    await flushMicrotasks()

    expect(replaceTree).toHaveBeenCalledOnce()
    expect(replaceTree).toHaveBeenCalledWith([snapshot])
    expect(applyDelta).toHaveBeenCalledOnce()
    expect(applyDelta).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'windowCreated' }),
    )
    unsubscribe()
  })

  it('keeps the real background snapshot/version handoff atomic (RT-01)', async () => {
    const { runtime } = await loadRuntimePortService()
    const snapshot = makeForegroundWindow('window-snapshot' as UID)
    const deltaWindow = makeForegroundWindow('window-delta' as UID)
    const events: string[] = []
    let foregroundTree = [] as ReturnType<typeof makeForegroundWindow>[]
    const replaceTree = vi.fn((items) => {
      events.push('snapshot')
      foregroundTree = structuredClone(items)
    })
    const applyDelta = vi.fn((delta) => {
      events.push('delta')
      if (delta.op === 'windowCreated') {
        foregroundTree.splice(delta.index, 0, delta.window)
      }
      return true
    })
    runtime.initializeSessionTreePort({
      dispatchCommand: vi.fn(),
      getSnapshot: () => {
        queueMicrotask(() => {
          runtime.emitTreeDelta({
            op: 'windowCreated',
            window: deltaWindow,
            index: 1,
          })
        })
        return [snapshot]
      },
    })

    const unsubscribe = runtime.subscribeTreeUpdates({
      replaceTree,
      applyDelta,
    })
    await flushMicrotasks()
    await flushMicrotasks()
    await flushMicrotasks()

    expect(replaceTree).toHaveBeenCalledWith([snapshot])
    expect(applyDelta).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'windowCreated' }),
    )
    expect(events).toEqual(['snapshot', 'delta'])
    expect(foregroundTree.map((item) => item.uid)).toEqual([
      snapshot.uid,
      deltaWindow.uid,
    ])
    unsubscribe()
  })

  it('ignores duplicate versions and replaces the tree after a skipped version (RT-02)', async () => {
    const { browser, runtime } = await loadRuntimePortService()
    const firstSnapshot = makeForegroundWindow('window-first' as UID)
    const recoveredSnapshot = makeForegroundWindow('window-recovered' as UID)
    const replaceTree = vi.fn()
    const applyDelta = vi.fn(() => true)
    let subscribeCount = 0

    const unsubscribe = runtime.subscribeTreeUpdates({
      replaceTree,
      applyDelta,
    })
    const serverPort = browser.__ports.servers.at(-1)!
    serverPort.onMessage.addListener((message) => {
      const request = message as { type?: string; requestId?: string }
      if (request.type !== 'subscribe' || !request.requestId) return
      subscribeCount += 1
      serverPort.postMessage({
        type: 'response',
        requestId: request.requestId,
        ok: true,
        version: subscribeCount === 1 ? 1 : 4,
        treeItems: [subscribeCount === 1 ? firstSnapshot : recoveredSnapshot],
      })
    })
    await flushMicrotasks()
    await flushMicrotasks()

    const consecutiveDelta = {
      type: 'delta',
      version: 2,
      delta: {
        op: 'windowUpdated',
        window: { ...firstSnapshot, title: 'updated' },
      },
    }
    serverPort.postMessage(consecutiveDelta)
    serverPort.postMessage(consecutiveDelta)
    serverPort.postMessage({ ...consecutiveDelta, version: 1 })
    await flushMicrotasks()
    expect(applyDelta).toHaveBeenCalledOnce()

    serverPort.postMessage({ ...consecutiveDelta, version: 4 })
    await flushMicrotasks()
    await flushMicrotasks()

    expect(subscribeCount).toBe(2)
    expect(replaceTree).toHaveBeenLastCalledWith([recoveredSnapshot])
    expect(applyDelta).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('resynchronizes buffered deltas delivered out of version order (RT-02)', async () => {
    const { browser, runtime } = await loadRuntimePortService()
    const snapshot = makeForegroundWindow('window-1' as UID)
    const replaceTree = vi.fn()
    const applyDelta = vi.fn(() => true)
    let subscribeCount = 0

    const unsubscribe = runtime.subscribeTreeUpdates({
      replaceTree,
      applyDelta,
    })
    const serverPort = browser.__ports.servers.at(-1)!
    serverPort.onMessage.addListener((message) => {
      const request = message as { type?: string; requestId?: string }
      if (request.type !== 'subscribe' || !request.requestId) return
      subscribeCount += 1
      if (subscribeCount === 1) {
        serverPort.postMessage({
          type: 'delta',
          version: 3,
          delta: { op: 'windowUpdated', window: snapshot },
        })
        serverPort.postMessage({
          type: 'delta',
          version: 2,
          delta: { op: 'windowUpdated', window: snapshot },
        })
      }
      serverPort.postMessage({
        type: 'response',
        requestId: request.requestId,
        ok: true,
        version: subscribeCount === 1 ? 1 : 3,
        treeItems: [snapshot],
      })
    })

    await flushMicrotasks()
    await flushMicrotasks()
    await flushMicrotasks()

    expect(subscribeCount).toBe(2)
    expect(replaceTree).toHaveBeenCalledTimes(2)
    expect(applyDelta).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('resynchronizes malformed deltas without resolving unknown responses (RT-09)', async () => {
    const { browser, runtime } = await loadRuntimePortService()
    const snapshot = makeForegroundWindow('window-1' as UID)
    const replaceTree = vi.fn()
    const applyDelta = vi.fn(() => true)
    let subscribeCount = 0

    const unsubscribe = runtime.subscribeTreeUpdates({
      replaceTree,
      applyDelta,
    })
    const serverPort = browser.__ports.servers.at(-1)!
    serverPort.onMessage.addListener((message) => {
      const request = message as { type?: string; requestId?: string }
      if (request.type !== 'subscribe' || !request.requestId) return
      subscribeCount += 1
      serverPort.postMessage({
        type: 'response',
        requestId: 'unknown-request',
        ok: true,
        version: subscribeCount,
        treeItems: [],
      })
      serverPort.postMessage({
        type: 'response',
        requestId: request.requestId,
        ok: true,
        version: subscribeCount,
        treeItems: [snapshot],
      })
    })
    await flushMicrotasks()
    await flushMicrotasks()

    serverPort.postMessage({
      type: 'delta',
      version: 2,
      delta: { op: 'tabUpdated' },
    })
    await flushMicrotasks()
    await flushMicrotasks()

    expect(subscribeCount).toBe(2)
    expect(replaceTree).toHaveBeenCalledTimes(2)
    expect(applyDelta).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('retries synchronization after a malformed matching response (RT-09)', async () => {
    vi.useFakeTimers()
    try {
      const { browser, runtime } = await loadRuntimePortService()
      const snapshot = makeForegroundWindow('window-recovered' as UID)
      const replaceTree = vi.fn()
      let subscribeCount = 0

      const unsubscribe = runtime.subscribeTreeUpdates({
        replaceTree,
        applyDelta: vi.fn(() => true),
      })
      const serverPort = browser.__ports.servers.at(-1)!
      serverPort.onMessage.addListener((message) => {
        const request = message as { type?: string; requestId?: string }
        if (request.type !== 'subscribe' || !request.requestId) return
        subscribeCount += 1
        if (subscribeCount === 1) {
          serverPort.postMessage({ type: 'unknown', requestId: 'ignored' })
          serverPort.postMessage({
            type: 'response',
            requestId: request.requestId,
            ok: true,
            version: 1,
            treeItems: ['not-a-tree-item'],
          })
          return
        }
        serverPort.postMessage({
          type: 'response',
          requestId: request.requestId,
          ok: true,
          version: 1,
          treeItems: [snapshot],
        })
      })

      await flushMicrotasks()
      await vi.advanceTimersByTimeAsync(100)
      await flushMicrotasks()

      expect(subscribeCount).toBe(2)
      expect(replaceTree).toHaveBeenCalledOnce()
      expect(replaceTree).toHaveBeenCalledWith([snapshot])
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a malformed response carrying an unknown request ID (RT-09)', async () => {
    const { browser, runtime } = await loadRuntimePortService()
    const snapshot = makeForegroundWindow('window-1' as UID)
    const replaceTree = vi.fn()
    let subscribeCount = 0

    const unsubscribe = runtime.subscribeTreeUpdates({
      replaceTree,
      applyDelta: vi.fn(() => true),
    })
    const serverPort = browser.__ports.servers.at(-1)!
    serverPort.onMessage.addListener((message) => {
      const request = message as { type?: string; requestId?: string }
      if (request.type !== 'subscribe' || !request.requestId) return
      subscribeCount += 1
      serverPort.postMessage({
        type: 'response',
        requestId: request.requestId,
        ok: true,
        version: 1,
        treeItems: [snapshot],
      })
    })
    await flushMicrotasks()
    await flushMicrotasks()

    serverPort.postMessage({
      type: 'response',
      requestId: 'unknown-request',
      ok: 'malformed',
      version: 1,
    })
    await flushMicrotasks()
    await flushMicrotasks()

    expect(subscribeCount).toBe(1)
    expect(replaceTree).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('replaces the tree when a valid delta cannot target the foreground tree (RT-13)', async () => {
    const { browser, runtime } = await loadRuntimePortService()
    const firstSnapshot = makeForegroundWindow('window-first' as UID)
    const recoveredSnapshot = makeForegroundWindow('window-recovered' as UID)
    const replaceTree = vi.fn()
    const applyDelta = vi.fn(() => false)
    let subscribeCount = 0

    const unsubscribe = runtime.subscribeTreeUpdates({
      replaceTree,
      applyDelta,
    })
    const serverPort = browser.__ports.servers.at(-1)!
    serverPort.onMessage.addListener((message) => {
      const request = message as { type?: string; requestId?: string }
      if (request.type !== 'subscribe' || !request.requestId) return
      subscribeCount += 1
      serverPort.postMessage({
        type: 'response',
        requestId: request.requestId,
        ok: true,
        version: subscribeCount,
        treeItems: [subscribeCount === 1 ? firstSnapshot : recoveredSnapshot],
      })
    })
    await flushMicrotasks()
    await flushMicrotasks()

    serverPort.postMessage({
      type: 'delta',
      version: 2,
      delta: {
        op: 'tabUpdated',
        tab: makeForegroundTab('missing-tab' as UID),
      },
    })
    await flushMicrotasks()
    await flushMicrotasks()

    expect(applyDelta).toHaveBeenCalledOnce()
    expect(subscribeCount).toBe(2)
    expect(replaceTree).toHaveBeenLastCalledWith([recoveredSnapshot])
    unsubscribe()
  })

  it('resynchronizes a delta whose item type contradicts its operation (RT-09)', async () => {
    const { browser, runtime } = await loadRuntimePortService()
    const snapshot = makeForegroundWindow('window-1' as UID)
    const replaceTree = vi.fn()
    const applyDelta = vi.fn(() => true)
    let subscribeCount = 0

    const unsubscribe = runtime.subscribeTreeUpdates({
      replaceTree,
      applyDelta,
    })
    const serverPort = browser.__ports.servers.at(-1)!
    serverPort.onMessage.addListener((message) => {
      const request = message as { type?: string; requestId?: string }
      if (request.type !== 'subscribe' || !request.requestId) return
      subscribeCount += 1
      serverPort.postMessage({
        type: 'response',
        requestId: request.requestId,
        ok: true,
        version: subscribeCount,
        treeItems: [snapshot],
      })
    })
    await flushMicrotasks()
    await flushMicrotasks()

    serverPort.postMessage({
      type: 'delta',
      version: 2,
      delta: { op: 'tabUpdated', tab: snapshot },
    })
    await flushMicrotasks()
    await flushMicrotasks()

    expect(applyDelta).not.toHaveBeenCalled()
    expect(subscribeCount).toBe(2)
    unsubscribe()
  })

  it('resynchronizes an incomplete item payload with the expected type (RT-09)', async () => {
    const { browser, runtime } = await loadRuntimePortService()
    const snapshot = makeForegroundWindow('window-1' as UID)
    const replaceTree = vi.fn()
    const applyDelta = vi.fn(() => true)
    let subscribeCount = 0

    const unsubscribe = runtime.subscribeTreeUpdates({
      replaceTree,
      applyDelta,
    })
    const serverPort = browser.__ports.servers.at(-1)!
    serverPort.onMessage.addListener((message) => {
      const request = message as { type?: string; requestId?: string }
      if (request.type !== 'subscribe' || !request.requestId) return
      subscribeCount += 1
      serverPort.postMessage({
        type: 'response',
        requestId: request.requestId,
        ok: true,
        version: subscribeCount,
        treeItems: [snapshot],
      })
    })
    await flushMicrotasks()
    await flushMicrotasks()

    serverPort.postMessage({
      type: 'delta',
      version: 2,
      delta: {
        op: 'tabUpdated',
        tab: { type: TreeItemType.TAB, uid: 'incomplete-tab' },
      },
    })
    await flushMicrotasks()
    await flushMicrotasks()

    expect(applyDelta).not.toHaveBeenCalled()
    expect(subscribeCount).toBe(2)
    unsubscribe()
  })

  it('rejects a disconnected command and dispatches a manual retry only once (RT-04)', async () => {
    const { browser, runtime } = await loadRuntimePortService()
    const firstCommand = runtime.sendTreeCommand({ action: 'printSessionTree' })
    await flushMicrotasks()
    browser.__ports.clients[0].disconnect()

    await expect(firstCommand).rejects.toThrow('disconnected')

    const retriedCommand = runtime.sendTreeCommand({
      action: 'printSessionTree',
    })
    const retryServer = browser.__ports.servers.at(-1)!
    let dispatchCount = 0
    retryServer.onMessage.addListener((message) => {
      const request = message as { type?: string; requestId?: string }
      if (request.type !== 'command' || !request.requestId) return
      dispatchCount += 1
      retryServer.postMessage({
        type: 'response',
        requestId: request.requestId,
        ok: true,
        version: 0,
      })
    })
    await expect(retriedCommand).resolves.toBeUndefined()
    expect(dispatchCount).toBe(1)
  })

  it('disconnects the final subscription and creates a fresh port later (RT-11)', async () => {
    const { browser, runtime } = await loadRuntimePortService()
    const options = {
      replaceTree: vi.fn(),
      applyDelta: vi.fn(() => true),
    }

    const unsubscribe = runtime.subscribeTreeUpdates(options)
    expect(browser.__ports.clients).toHaveLength(1)
    const firstClient = browser.__ports.clients[0]
    const pendingCommand = runtime.sendTreeCommand({
      action: 'printSessionTree',
    })

    unsubscribe()
    expect(firstClient.disconnected).toBe(true)
    await expect(pendingCommand).rejects.toThrow('disconnected')

    const unsubscribeAgain = runtime.subscribeTreeUpdates(options)
    expect(browser.__ports.clients).toHaveLength(2)
    expect(browser.__ports.clients[1]).not.toBe(firstClient)
    unsubscribeAgain()
  })

  it('broadcasts the same snapshot and deltas to two independent popup ports (RT-05/RT-06)', async () => {
    const { browser, runtime } = await loadRuntimePortService()
    const snapshot = makeForegroundWindow('window-snapshot' as UID)
    const createdWindow = makeForegroundWindow('window-created' as UID)
    runtime.initializeSessionTreePort({
      dispatchCommand: vi.fn(),
      getSnapshot: () => [snapshot],
    })

    const firstPort = browser.runtime.connect({ name: 'sessiontree-rpc' })
    const secondPort = browser.runtime.connect({ name: 'sessiontree-rpc' })
    const firstMessages: Array<Record<string, unknown>> = []
    const secondMessages: Array<Record<string, unknown>> = []
    firstPort.onMessage.addListener((message: object) => {
      firstMessages.push(message as Record<string, unknown>)
    })
    secondPort.onMessage.addListener((message: object) => {
      secondMessages.push(message as Record<string, unknown>)
    })
    firstPort.postMessage({ type: 'subscribe', requestId: 'first-subscribe' })
    secondPort.postMessage({ type: 'subscribe', requestId: 'second-subscribe' })
    await flushMicrotasks()
    await flushMicrotasks()

    expect(firstMessages[0]).toMatchObject({
      type: 'response',
      requestId: 'first-subscribe',
      treeItems: [snapshot],
    })
    expect(secondMessages[0]).toMatchObject({
      type: 'response',
      requestId: 'second-subscribe',
      treeItems: [snapshot],
    })

    runtime.emitTreeDelta({
      op: 'windowCreated',
      window: createdWindow,
      index: 1,
    })
    await flushMicrotasks()
    expect(firstMessages.at(-1)).toMatchObject({ type: 'delta', version: 1 })
    expect(secondMessages.at(-1)).toEqual(firstMessages.at(-1))

    firstPort.disconnect()
    runtime.emitTreeDelta({
      op: 'windowRemoved',
      windowUid: createdWindow.uid,
    })
    await flushMicrotasks()

    expect(firstMessages).toHaveLength(2)
    expect(secondMessages.at(-1)).toMatchObject({ type: 'delta', version: 2 })
  })

  it('delivers a slow command delta before its response (RT-07)', async () => {
    const { browser, runtime } = await loadRuntimePortService()
    let releaseDispatch: () => void = () => {}
    const dispatchGate = new Promise<void>((resolve) => {
      releaseDispatch = resolve
    })
    runtime.initializeSessionTreePort({
      dispatchCommand: async () => {
        await dispatchGate
        runtime.emitTreeDelta({
          op: 'windowRemoved',
          windowUid: 'window-1' as UID,
        })
      },
      getSnapshot: () => [],
    })
    const port = browser.runtime.connect({ name: 'sessiontree-rpc' })
    const messageTypes: string[] = []
    port.onMessage.addListener((message: object) => {
      messageTypes.push((message as { type: string }).type)
    })
    port.postMessage({
      type: 'command',
      requestId: 'slow-command',
      command: { action: 'printSessionTree' },
    })
    await flushMicrotasks()
    expect(messageTypes).toEqual([])

    releaseDispatch()
    await flushMicrotasks()
    await flushMicrotasks()

    expect(messageTypes).toEqual(['delta', 'response'])
  })

  it('waits for initialization and returns an explicit timeout at the deadline (RT-08)', async () => {
    vi.useFakeTimers()
    try {
      const { browser, runtime, Tree } = await loadRuntimePortService()
      Tree.initialized = false
      runtime.initializeSessionTreePort({
        dispatchCommand: vi.fn(),
        getSnapshot: () => [],
      })
      const successfulPort = browser.runtime.connect({
        name: 'sessiontree-rpc',
      })
      const successfulResponses: Array<Record<string, unknown>> = []
      successfulPort.onMessage.addListener((message: object) => {
        successfulResponses.push(message as Record<string, unknown>)
      })
      successfulPort.postMessage({
        type: 'subscribe',
        requestId: 'initializes-in-time',
      })
      await vi.advanceTimersByTimeAsync(9_900)
      Tree.initialized = true
      await vi.advanceTimersByTimeAsync(100)
      expect(successfulResponses.at(-1)).toMatchObject({
        ok: true,
        requestId: 'initializes-in-time',
      })

      Tree.initialized = false
      const timeoutPort = browser.runtime.connect({ name: 'sessiontree-rpc' })
      const timeoutResponses: Array<Record<string, unknown>> = []
      timeoutPort.onMessage.addListener((message: object) => {
        timeoutResponses.push(message as Record<string, unknown>)
      })
      timeoutPort.postMessage({
        type: 'subscribe',
        requestId: 'times-out',
      })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(timeoutResponses.at(-1)).toMatchObject({
        ok: false,
        requestId: 'times-out',
        error: 'Tree initialization timeout',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('isolates dispatcher failures and rejects malformed background requests (RT-09/RT-10)', async () => {
    const { browser, runtime } = await loadRuntimePortService()
    const dispatchCommand = vi
      .fn()
      .mockRejectedValueOnce(new Error('request failed'))
    runtime.initializeSessionTreePort({
      dispatchCommand,
      getSnapshot: () => [],
    })
    const requestingPort = browser.runtime.connect({ name: 'sessiontree-rpc' })
    const otherPort = browser.runtime.connect({ name: 'sessiontree-rpc' })
    const requestingMessages: Array<Record<string, unknown>> = []
    const otherMessages: Array<Record<string, unknown>> = []
    requestingPort.onMessage.addListener((message: object) => {
      requestingMessages.push(message as Record<string, unknown>)
    })
    otherPort.onMessage.addListener((message: object) => {
      otherMessages.push(message as Record<string, unknown>)
    })

    requestingPort.postMessage({
      type: 'command',
      requestId: 'failing-command',
      command: { action: 'printSessionTree' },
    })
    requestingPort.postMessage({ type: 'command', requestId: 42 })
    requestingPort.postMessage({
      type: 'command',
      requestId: 'malformed-known-action',
      command: { action: 'closeTab' },
    })
    requestingPort.postMessage({
      type: 'command',
      requestId: 'unknown-action',
      command: { action: 'notARealAction' },
    })
    requestingPort.postMessage({ type: 'unknown', requestId: 'unknown' })
    await flushMicrotasks()
    await flushMicrotasks()

    expect(dispatchCommand).toHaveBeenCalledTimes(1)
    expect(requestingMessages).toEqual([
      expect.objectContaining({
        type: 'response',
        requestId: 'failing-command',
        ok: false,
      }),
    ])
    expect(otherMessages).toEqual([])

    runtime.emitTreeDelta({
      op: 'windowRemoved',
      windowUid: 'window-1' as UID,
    })
    await flushMicrotasks()
    expect(requestingMessages.at(-1)).toMatchObject({ type: 'delta' })
    expect(otherMessages.at(-1)).toEqual(requestingMessages.at(-1))
  })
})
