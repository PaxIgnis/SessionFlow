import { beforeEach, describe, expect, it, vi } from 'vitest'
import { State, TreeItemType } from '@/types/session-tree'
import { flushMicrotasks, installFakeBrowser } from '../../helpers/fake-browser'
import { makeForegroundWindow } from '../../helpers/foreground-tree-fixtures'

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
})
