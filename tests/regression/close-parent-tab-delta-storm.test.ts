import { SessionTreePortMessage } from '@/types/runtime-port-service'
import { State, Tab, TreeItem, TreeItemType } from '@/types/session-tree'
import { describe, expect, it, vi } from 'vitest'
import { flushMicrotasks, installFakeBrowser } from '../helpers/fake-browser'

/*
 * Closing a tab re-indents every descendant, and recomputeSessionTree emitted
 * one tabUpdated delta per changed item. Each delta was its own port message,
 * so the session tree applied and re-rendered the whole tree once per
 * descendant. With a 10k-item tree that was ~0.5s per message, and closing
 * the root of a 1.5k-tab hierarchy took minutes while the indents visibly
 * walked down the window one row at a time.
 *
 * Deltas emitted in one synchronous run must reach the foreground as a single
 * message, and applying it must leave the foreground tree identical to the
 * background tree.
 */

const CHAIN_LENGTH = 200

async function loadEnvironment() {
  vi.resetModules()
  const browser = installFakeBrowser()
  const { Tree } = await import('@/services/background-tree')
  const fixtures = await import('../helpers/tree-fixtures')
  const runtime = await import('@/services/runtime-port-service')
  const { SessionTree } = await import('@/services/foreground-tree')
  const { expectForegroundIndexes } =
    await import('../helpers/foreground-invariants')
  fixtures.resetTree()
  return {
    browser,
    Tree,
    fixtures,
    runtime,
    SessionTree,
    expectForegroundIndexes,
  }
}

function indentSummary(items: TreeItem[]): string[] {
  const out: string[] = []
  for (const item of items) {
    out.push(`${item.uid}:${item.indentLevel}:${item.parentUid ?? '-'}`)
    if (item.type === TreeItemType.WINDOW) {
      out.push(...indentSummary(item.children as TreeItem[]))
    }
  }
  return out
}

describe('closing a parent tab with many descendants', () => {
  it('delivers the whole re-indent to the session tree as one message', async () => {
    const env = await loadEnvironment()
    const { Tree, fixtures, runtime, SessionTree } = env

    // root-0 > tab-1 > tab-2 > ... > tab-199, all saved.
    const tabs: Tab[] = Array.from({ length: CHAIN_LENGTH }, (_, index) =>
      fixtures.createTab(`tab-${index}` as UID, {
        id: -1,
        state: State.SAVED,
        indentLevel: index + 1,
        parentUid: index === 0 ? undefined : (`tab-${index - 1}` as UID),
        isParent: index < CHAIN_LENGTH - 1,
      }),
    )
    fixtures.createWindow('window-1' as UID, tabs, { id: -1 })
    Tree.recomputeSessionTree(false)

    runtime.initializeSessionTreePort({
      dispatchCommand: () => undefined,
      getSnapshot: () => Tree.Items,
    })
    const unsubscribe = runtime.subscribeTreeUpdates({
      replaceTree: (items) => SessionTree.replaceSessionTree(items),
      applyDelta: (delta) => SessionTree.applyDelta(delta),
    })
    for (let i = 0; i < 6; i += 1) await flushMicrotasks()
    expect(SessionTree.tabsByUid.size).toBe(CHAIN_LENGTH)

    const serverPort = env.browser.__ports.servers[0]
    const sent: SessionTreePortMessage[] = []
    const originalPost = serverPort.postMessage.bind(serverPort)
    serverPort.postMessage = (message: object) => {
      sent.push(message as SessionTreePortMessage)
      originalPost(message)
    }

    await Tree.closeTab({ tabId: -1, tabUid: 'tab-0' as UID })
    for (let i = 0; i < 6; i += 1) await flushMicrotasks()

    const deltaMessages = sent.filter((message) => message.type === 'delta')
    expect(deltaMessages).toHaveLength(1)
    const [message] = deltaMessages
    expect(message.type === 'delta' && message.delta.op).toBe('batch')

    // The foreground converged to the background without a resync.
    expect(sent.some((m) => m.type === 'response')).toBe(false)
    expect(SessionTree.tabsByUid.has('tab-0' as UID)).toBe(false)
    expect(SessionTree.tabsByUid.get('tab-1' as UID)?.indentLevel).toBe(1)
    expect(
      SessionTree.tabsByUid.get(`tab-${CHAIN_LENGTH - 1}` as UID)?.indentLevel,
    ).toBe(CHAIN_LENGTH - 1)
    expect(
      indentSummary(SessionTree.reactiveItems.value as TreeItem[]),
    ).toEqual(indentSummary(Tree.Items as TreeItem[]))
    env.expectForegroundIndexes()

    unsubscribe()
  })
})
