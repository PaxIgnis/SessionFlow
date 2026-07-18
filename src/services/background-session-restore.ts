import { Tree } from '@/services/background-tree'
import {
  readTabUid,
  readWindowUid,
  writeTabUid,
  writeWindowUid,
} from '@/services/background-session-identity'
import { Settings } from '@/services/settings'
import { LoadingStatus, State, TreeItemType } from '@/types/session-tree'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import * as Utils from '@/services/utils'

const relocatingTabIds = new Set<number>()
const restoringTabUids = new Set<UID>()
const restoringWindowUids = new Set<UID>()
const RESTORED_TAB_IDENTITY_TIMEOUT_MS = 100
const RESTORED_TAB_IDENTITY_ATTEMPTS = 5

export type WindowCreationDisposition =
  | 'new-window'
  | 'restored-window'
  | 'extension-generated'

interface PendingWindowClassification {
  promise: Promise<WindowCreationDisposition>
  resolve: (disposition: WindowCreationDisposition) => void
}

const pendingWindowClassifications = new Map<
  number,
  PendingWindowClassification
>()

export function beginWindowClassification(windowId: number): void {
  if (pendingWindowClassifications.has(windowId)) return
  let resolve!: (disposition: WindowCreationDisposition) => void
  const promise = new Promise<WindowCreationDisposition>((resolver) => {
    resolve = resolver
  })
  pendingWindowClassifications.set(windowId, { promise, resolve })
}

export function finishWindowClassification(
  windowId: number,
  disposition: WindowCreationDisposition,
): void {
  const pending = pendingWindowClassifications.get(windowId)
  if (!pending) return
  pending.resolve(disposition)
  setTimeout(() => pendingWindowClassifications.delete(windowId), 1_000)
}

export async function waitForWindowClassification(
  windowId: number,
): Promise<WindowCreationDisposition | undefined> {
  return pendingWindowClassifications.get(windowId)?.promise
}

export function isTabRelocating(tabId: number): boolean {
  return relocatingTabIds.has(tabId)
}

async function readRestoredTabUid(tabId: number): Promise<UID | undefined> {
  for (let attempt = 0; attempt < RESTORED_TAB_IDENTITY_ATTEMPTS; attempt++) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const result = await Promise.race([
      readTabUid(tabId).then((uid) => ({ timedOut: false as const, uid })),
      new Promise<{ timedOut: true }>((resolve) => {
        timeoutId = setTimeout(
          () => resolve({ timedOut: true }),
          RESTORED_TAB_IDENTITY_TIMEOUT_MS,
        )
      }),
    ])
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    if (!result.timedOut && result.uid) return result.uid
    if (
      !result.timedOut &&
      attempt < RESTORED_TAB_IDENTITY_ATTEMPTS - 1
    ) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, RESTORED_TAB_IDENTITY_TIMEOUT_MS)
      })
    }
  }
  return undefined
}

export async function handleCreatedWindow(
  browserWindow: browser.windows.Window,
): Promise<boolean> {
  if (
    !Settings.values.reconnectFirefoxRestoredItems ||
    browserWindow.id === undefined
  ) {
    return false
  }
  const windowUid = await readWindowUid(browserWindow.id)
  if (!windowUid) return false
  const savedWindow = Tree.windowsByUid.get(windowUid)
  if (!savedWindow || savedWindow.state !== State.SAVED) return false
  if (restoringWindowUids.has(savedWindow.uid)) return false
  restoringWindowUids.add(savedWindow.uid)

  try {
    let populatedWindow: browser.windows.Window
    try {
      populatedWindow = await browser.windows.get(browserWindow.id, {
        populate: true,
      })
    } catch (error) {
      console.error('Failed to inspect Firefox-restored window:', error)
      return false
    }
    if (populatedWindow.incognito !== savedWindow.incognito) return false
    if (
      savedWindow.incognito &&
      !(await Utils.isPrivateWindowAccessAllowed())
    ) {
      return false
    }
    const restoredTabs = populatedWindow.tabs ?? []
    const restoredTabUids = await Promise.all(
      restoredTabs.map((tab) =>
        tab.id === undefined
          ? Promise.resolve(undefined)
          : readRestoredTabUid(tab.id),
      ),
    )

    Tree.updateWindowId(savedWindow.uid, browserWindow.id)
    Tree.updateWindowState(savedWindow.uid, State.OPEN)
    Tree.updateWindow(savedWindow.uid, {
      active: populatedWindow.focused,
      activeTabId: restoredTabs.find((tab) => tab.active)?.id,
    })

    restoredTabs.forEach((tab, index) => {
      if (tab.id === undefined) return
      const tabUid = restoredTabUids[index]
      const savedTab = tabUid ? Tree.tabsByUid.get(tabUid) : undefined
      if (
        savedTab &&
        savedTab.state === State.SAVED &&
        savedTab.windowUid === savedWindow.uid
      ) {
        Tree.updateTabId(savedTab.uid, tab.id)
        Tree.updateTab(
          { tabUid: savedTab.uid },
          {
            active: tab.active,
            container: Tree.containerForCookieStore(tab.cookieStoreId),
            loadingStatus: tab.status as LoadingStatus | undefined,
            state: tab.discarded ? State.DISCARDED : State.OPEN,
            title: tab.title || savedTab.title,
            url: tab.url || savedTab.url,
          },
        )
        return
      }

      Tree.addTab(
        tab.active,
        savedWindow.uid,
        tab.id,
        false,
        tab.discarded ? State.DISCARDED : State.OPEN,
        tab.title || 'Untitled',
        tab.url || '',
        tab.pinned || false,
        undefined,
        undefined,
        undefined,
        true,
        undefined,
        Tree.containerForCookieStore(tab.cookieStoreId),
      )
    })
    await reconcileRestoredWindowTabs(savedWindow.uid, restoredTabs)
    return true
  } finally {
    restoringWindowUids.delete(savedWindow.uid)
  }
}

async function reconcileRestoredWindowTabs(
  windowUid: UID,
  restoredTabs: browser.tabs.Tab[],
): Promise<void> {
  const window = Tree.windowsByUid.get(windowUid)
  if (!window || window.id < 0) return
  const browserTabById = new Map(
    restoredTabs
      .filter(
        (tab): tab is browser.tabs.Tab & { id: number } => tab.id !== undefined,
      )
      .map((tab) => [tab.id, tab]),
  )
  const currentIds = restoredTabs
    .map((tab) => tab.id)
    .filter((id): id is number => id !== undefined)
  const liveTabs = Tree.getTabs(window.children).filter(
    (tab) =>
      tab.id >= 0 &&
      (tab.state === State.OPEN || tab.state === State.DISCARDED),
  )

  for (const [desiredIndex, tab] of liveTabs.entries()) {
    const currentIndex = currentIds.indexOf(tab.id)
    if (currentIndex === -1 || currentIndex === desiredIndex) continue
    relocatingTabIds.add(tab.id)
    try {
      await browser.tabs.move(tab.id, {
        windowId: window.id,
        index: desiredIndex,
      })
      currentIds.splice(currentIndex, 1)
      currentIds.splice(desiredIndex, 0, tab.id)
    } catch (error) {
      console.error('Failed to reorder Firefox-restored window tabs:', error)
    } finally {
      relocatingTabIds.delete(tab.id)
    }
  }

  for (const tab of liveTabs) {
    const browserTab = browserTabById.get(tab.id)
    if (!browserTab || browserTab.pinned === tab.pinned) continue
    try {
      await browser.tabs.update(tab.id, { pinned: tab.pinned })
    } catch (error) {
      console.error('Failed to restore Firefox-restored tab pinning:', error)
    }
  }

  const restoredGroupUids = new Set<UID>()
  for (const tab of liveTabs) {
    const groupUid = tab.tabGroup?.uid
    if (!groupUid || restoredGroupUids.has(groupUid)) continue
    restoredGroupUids.add(groupUid)
    try {
      await Tree.restoreTabGroup(tab.uid)
    } catch (error) {
      console.error('Failed to restore Firefox-restored tab group:', error)
    }
  }
}

export async function handleCreatedTab(
  browserTab: browser.tabs.Tab,
): Promise<boolean> {
  if (
    !Settings.values.reconnectFirefoxRestoredItems ||
    browserTab.id === undefined ||
    browserTab.windowId === undefined
  ) {
    return false
  }
  const tabUid = await readTabUid(browserTab.id)
  if (!tabUid) return false

  const savedTab = Tree.tabsByUid.get(tabUid)
  if (!savedTab || savedTab.state !== State.SAVED) return false
  if (restoringTabUids.has(savedTab.uid)) return false
  restoringTabUids.add(savedTab.uid)
  let claimedWindowUid: UID | undefined

  try {
    const targetWindow = Tree.windowsByUid.get(savedTab.windowUid)
    if (!targetWindow) return false
    if (browserTab.incognito !== targetWindow.incognito) return false
    if (
      targetWindow.incognito &&
      !(await Utils.isPrivateWindowAccessAllowed())
    ) {
      return false
    }

    if (targetWindow.state === State.SAVED) {
      if (restoringWindowUids.has(targetWindow.uid)) return false
      restoringWindowUids.add(targetWindow.uid)
      claimedWindowUid = targetWindow.uid
      relocatingTabIds.add(browserTab.id)
      try {
        const properties: browser.windows._CreateCreateData = {
          tabId: browserTab.id,
          incognito: targetWindow.incognito,
        }
        if (
          Settings.values.openWindowsInSameLocation &&
          targetWindow.windowPosition
        ) {
          Object.assign(properties, targetWindow.windowPosition)
        }
        const restoredWindow =
          await OnCreatedQueue.createWindowAndWait(properties)
        if (restoredWindow.id === undefined) return false
        Tree.updateWindowId(targetWindow.uid, restoredWindow.id)
        Tree.updateWindowState(targetWindow.uid, State.OPEN)
        Tree.updateWindow(targetWindow.uid, {
          active: restoredWindow.focused,
          activeTabId:
            restoredWindow.tabs?.find((tab) => tab.active)?.id ??
            (browserTab.active ? browserTab.id : undefined),
        })
      } catch (error) {
        console.error(
          'Failed to create the saved window for a Firefox-restored tab:',
          error,
        )
        return false
      } finally {
        relocatingTabIds.delete(browserTab.id)
      }
    } else if (targetWindow.state === State.OPEN && targetWindow.id >= 0) {
      const desiredIndex = targetWindow.children
        .slice(0, targetWindow.children.indexOf(savedTab))
        .filter(
          (item) =>
            item.type === TreeItemType.TAB &&
            (item.state === State.OPEN || item.state === State.DISCARDED),
        ).length
      if (
        browserTab.windowId !== targetWindow.id ||
        browserTab.index !== desiredIndex
      ) {
        relocatingTabIds.add(browserTab.id)
        try {
          await browser.tabs.move(browserTab.id, {
            windowId: targetWindow.id,
            index: desiredIndex,
          })
        } catch (error) {
          console.error('Failed to place Firefox-restored tab:', error)
          return false
        } finally {
          relocatingTabIds.delete(browserTab.id)
        }
      }
    } else {
      return false
    }

    Tree.updateTabId(savedTab.uid, browserTab.id)
    Tree.updateTab(
      { tabUid: savedTab.uid },
      {
        active: browserTab.active,
        container: Tree.containerForCookieStore(browserTab.cookieStoreId),
        loadingStatus: browserTab.status as LoadingStatus | undefined,
        state: browserTab.discarded ? State.DISCARDED : State.OPEN,
        title: browserTab.title || savedTab.title,
        url: browserTab.url || savedTab.url,
      },
    )
    if (browserTab.pinned !== savedTab.pinned) {
      try {
        await browser.tabs.update(browserTab.id, { pinned: savedTab.pinned })
      } catch (error) {
        console.error(
          'Failed to restore metadata for Firefox-restored tab:',
          error,
        )
      }
    }
    if (savedTab.tabGroup) {
      try {
        await Tree.restoreTabGroup(savedTab.uid)
      } catch (error) {
        console.error(
          'Failed to restore metadata for Firefox-restored tab:',
          error,
        )
      }
    }
    return true
  } finally {
    restoringTabUids.delete(savedTab.uid)
    if (claimedWindowUid) restoringWindowUids.delete(claimedWindowUid)
  }
}

export async function stampOpenTreeIdentities(): Promise<void> {
  await Promise.all([
    ...[...Tree.windowsByUid.values()]
      .filter((window) => window.id >= 0 && window.state === State.OPEN)
      .map((window) => writeWindowUid(window.id, window.uid)),
    ...[...Tree.tabsByUid.values()]
      .filter(
        (tab) =>
          tab.id >= 0 &&
          (tab.state === State.OPEN || tab.state === State.DISCARDED),
      )
      .map((tab) => writeTabUid(tab.id, tab.uid)),
  ])
}
