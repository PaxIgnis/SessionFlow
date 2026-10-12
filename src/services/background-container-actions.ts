import { i18n } from '@/services/i18n'
import { Tree } from '@/services/background-tree'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import {
  claimTabRelocation,
  removeBrowserTab,
} from '@/services/background-command-removal'
import { discardedUrlPrecheck, prepareRestorableUrl } from '@/services/utils'
import {
  CONTAINER_RECOVERY_STALE_ERROR,
  type ContainerRecoveryStrategy,
  type SetTabContainerMessage,
} from '@/types/messages'
import { State, type ContainerMetadata, type Tab } from '@/types/session-tree'
import type { SessionTreeCommandResult } from '@/types/runtime-port-service'

type ContextualIdentityChangeInfo = {
  contextualIdentity: browser.contextualIdentities.ContextualIdentity
}

const liveContainers = new Map<string, ContainerMetadata>()
let containerEventVersion = 0
type CreateContainerDetails = Parameters<
  typeof browser.contextualIdentities.create
>[0]

export interface ContainerRecoveryTransaction {
  rollback(): Promise<void>
}

function emptyRecoveryTransaction(): ContainerRecoveryTransaction {
  return { rollback: async () => undefined }
}

function toContainerMetadata(
  identity: browser.contextualIdentities.ContextualIdentity,
): ContainerMetadata {
  return {
    cookieStoreId: identity.cookieStoreId,
    name: identity.name,
    color: identity.color,
    colorCode: identity.colorCode,
    icon: identity.icon,
    iconUrl: identity.iconUrl,
  }
}

async function refreshContainersFromFirefox(): Promise<void> {
  let identities: browser.contextualIdentities.ContextualIdentity[]
  let versionBeforeQuery: number
  do {
    versionBeforeQuery = containerEventVersion
    identities = await browser.contextualIdentities.query({})
  } while (versionBeforeQuery !== containerEventVersion)

  liveContainers.clear()
  for (const identity of identities) {
    const metadata = toContainerMetadata(identity)
    liveContainers.set(metadata.cookieStoreId, metadata)
  }
}

export async function initializeContainers(): Promise<void> {
  try {
    await refreshContainersFromFirefox()
  } catch (error) {
    liveContainers.clear()
    console.warn('Firefox contextual identities are unavailable:', error)
  }
}

export async function createContainer(
  details: CreateContainerDetails,
): Promise<SessionTreeCommandResult> {
  const name = details.name.trim()
  if (!name) throw new Error(i18n.t('containerNameRequired'))
  const identity = await browser.contextualIdentities.create({
    name,
    color: details.color,
    icon: details.icon,
  })
  containerCreated({ contextualIdentity: identity })
  return { createdContainerStoreId: identity.cookieStoreId }
}

export function containerForCookieStore(
  cookieStoreId?: string,
): ContainerMetadata | undefined {
  const metadata = cookieStoreId ? liveContainers.get(cookieStoreId) : undefined
  return metadata ? structuredClone(metadata) : undefined
}

export function refreshTreeContainerSnapshots(): void {
  for (const tab of Tree.tabsByUid.values()) {
    const cookieStoreId = tab.container?.cookieStoreId
    const liveContainer = cookieStoreId
      ? liveContainers.get(cookieStoreId)
      : undefined
    if (!liveContainer) continue
    Tree.updateTab(
      { tabUid: tab.uid },
      { container: structuredClone(liveContainer) },
    )
  }
}

export function containerCreated(
  changeInfo: ContextualIdentityChangeInfo,
): void {
  containerEventVersion++
  const metadata = toContainerMetadata(changeInfo.contextualIdentity)
  liveContainers.set(metadata.cookieStoreId, metadata)
}

export function containerUpdated(
  changeInfo: ContextualIdentityChangeInfo,
): void {
  containerEventVersion++
  const metadata = toContainerMetadata(changeInfo.contextualIdentity)
  liveContainers.set(metadata.cookieStoreId, metadata)
  for (const tab of Tree.tabsByUid.values()) {
    if (tab.container?.cookieStoreId !== metadata.cookieStoreId) continue
    Tree.updateTab(
      { tabUid: tab.uid },
      { container: structuredClone(metadata) },
    )
  }
}

export function containerRemoved(
  changeInfo: ContextualIdentityChangeInfo,
): void {
  containerEventVersion++
  liveContainers.delete(changeInfo.contextualIdentity.cookieStoreId)
}

export function resetContainerState(): void {
  liveContainers.clear()
  containerEventVersion = 0
}

/** Replaces only the browser tab, retaining the tree item's stable identity. */
export async function setTabContainer(
  message: Omit<SetTabContainerMessage, 'action'>,
): Promise<void> {
  const tab = Tree.tabsByUid.get(message.tabUid)
  if (!tab) throw new Error(i18n.t('savedTabNotFound'))
  const window = Tree.windowsByUid.get(tab.windowUid)
  if (!window) throw new Error(i18n.t('savedTabWindowNotFound'))

  let container: ContainerMetadata | undefined
  if (message.cookieStoreId !== undefined) {
    if (window.incognito) throw new Error(i18n.t('containerPrivateUnavailable'))
    await refreshContainersFromFirefox()
    container = containerForCookieStore(message.cookieStoreId)
    if (!container) throw new Error(i18n.t('containerSelectionUnavailable'))
  }

  if (tab.state === State.SAVED) {
    Tree.updateTab({ tabUid: tab.uid }, { container })
    return
  }
  if (tab.state !== State.OPEN && tab.state !== State.DISCARDED) return

  const original = await browser.tabs.get(tab.id)
  if (original.id === undefined || original.windowId !== window.id) {
    throw new Error(i18n.t('tabCreationWindowMismatch'))
  }
  const targetStoreId =
    container?.cookieStoreId ??
    (window.incognito ? 'firefox-private' : 'firefox-default')
  if (original.cookieStoreId === targetStoreId) {
    Tree.updateTab({ tabUid: tab.uid }, { container })
    return
  }

  const prepared = prepareRestorableUrl(original.url ?? tab.url, tab.title)
  const url = prepared.kind === 'url' ? prepared.url : undefined
  const discarded =
    original.discarded &&
    !original.pinned &&
    !original.active &&
    !!url &&
    discardedUrlPrecheck(url)
  const properties: browser.tabs._CreateCreateProperties = {
    windowId: original.windowId,
    index: original.index,
    cookieStoreId: targetStoreId,
    active: false,
    pinned: original.pinned,
    muted: original.mutedInfo?.muted ?? false,
    ...(url ? { url } : {}),
    ...(discarded ? { discarded: true, title: tab.title } : {}),
  }

  // Keep the original open until creation and grouping have succeeded, including
  // when this is the window's last tab. Failed replacement leaves it intact.
  let replacement: browser.tabs.Tab | undefined
  try {
    replacement = await OnCreatedQueue.createTabAndWait(properties)
    if (replacement.id === undefined) throw new Error(i18n.t('tabCreationNoId'))
    if (replacement.windowId !== original.windowId) {
      throw new Error(i18n.t('tabCreationWindowMismatch'))
    }
    if ((original.groupId ?? -1) !== -1) {
      const releaseRelocation = claimTabRelocation(replacement.id)
      try {
        await browser.tabs.group({
          groupId: original.groupId,
          tabIds: [replacement.id],
        })
        // Firefox can append a joining tab to its group. Return it to the
        // original slot before removing the old tab so tree/browser order agree.
        await browser.tabs.move(replacement.id, { index: original.index })
      } finally {
        releaseRelocation()
      }
    }
    await removeBrowserTab(original.id)
  } catch (error) {
    if (replacement?.id !== undefined) {
      await removeBrowserTab(replacement.id).catch((cleanupError) => {
        console.error(
          'Failed to remove container replacement tab:',
          cleanupError,
        )
      })
    }
    throw error
  }

  Tree.updateTab(
    { tabUid: tab.uid },
    {
      container,
      state: replacement.discarded ? State.DISCARDED : State.OPEN,
      active: original.active,
    },
  )
  Tree.updateTabId(tab.uid, replacement.id!)
  if ((original.groupId ?? -1) !== -1) {
    // Membership events can arrive before the new browser id is indexed.
    // Refresh after rebinding to retain the group's live identity in the tree.
    try {
      await Tree.tabGroupMembershipChanged(replacement.id!, original.groupId!)
    } catch (error) {
      // Replacement has succeeded; metadata refresh must not prevent activation.
      console.warn(
        'Failed to refresh tab group after container replacement:',
        error,
      )
    }
  }
  if (original.active) {
    Tree.updateWindow(window.uid, { activeTabId: replacement.id })
    await browser.tabs.update(replacement.id!, { active: true })
  }
}

export async function resolveContainerRecovery(
  tabs: Tab[],
  strategy?: ContainerRecoveryStrategy,
  consentedStoreIds?: string[],
): Promise<ContainerRecoveryTransaction> {
  const referenced = new Map<string, ContainerMetadata>()
  for (const tab of tabs) {
    const container = tab.container
    if (container && !referenced.has(container.cookieStoreId)) {
      referenced.set(container.cookieStoreId, structuredClone(container))
    }
  }
  if (referenced.size === 0) return emptyRecoveryTransaction()

  try {
    await refreshContainersFromFirefox()
  } catch (error) {
    if (
      strategy === 'without-container' &&
      consentMatches(referenced, consentedStoreIds)
    ) {
      const affectedTabs = tabs.filter(
        (tab) => tab.container && referenced.has(tab.container.cookieStoreId),
      )
      const originals = originalContainers(affectedTabs)
      clearContainerSnapshots(tabs, referenced)
      return createRecoveryTransaction(affectedTabs, originals)
    }
    throw error
  }

  const missing = new Map(
    [...referenced].filter(
      ([cookieStoreId]) => !liveContainers.has(cookieStoreId),
    ),
  )
  if (missing.size === 0) return emptyRecoveryTransaction()

  if (!strategy) {
    const first = missing.values().next().value as ContainerMetadata
    throw new Error(i18n.t('firefoxContainerMissing', [first.name]))
  }

  if (!consentMatches(missing, consentedStoreIds)) {
    throw new Error(CONTAINER_RECOVERY_STALE_ERROR)
  }

  if (strategy === 'without-container') {
    const affectedTabs = tabs.filter(
      (tab) => tab.container && missing.has(tab.container.cookieStoreId),
    )
    const originals = originalContainers(affectedTabs)
    clearContainerSnapshots(tabs, missing)
    return createRecoveryTransaction(affectedTabs, originals)
  }

  const replacements = new Map<string, ContainerMetadata>()
  const createdStoreIds: string[] = []
  try {
    for (const [oldStoreId, metadata] of missing) {
      const created = await browser.contextualIdentities.create({
        name: metadata.name,
        color: metadata.color as CreateContainerDetails['color'],
        icon: metadata.icon as CreateContainerDetails['icon'],
      })
      const replacement = toContainerMetadata(created)
      replacements.set(oldStoreId, replacement)
      createdStoreIds.push(replacement.cookieStoreId)
    }
  } catch (error) {
    await Promise.allSettled(
      createdStoreIds.map((cookieStoreId) =>
        browser.contextualIdentities.remove(cookieStoreId),
      ),
    )
    throw error
  }

  const affectedTabs = [...Tree.tabsByUid.values()].filter(
    (tab) => tab.container && replacements.has(tab.container.cookieStoreId),
  )
  const originals = originalContainers(affectedTabs)
  for (const [oldStoreId, replacement] of replacements) {
    liveContainers.set(replacement.cookieStoreId, replacement)
    for (const tab of Tree.tabsByUid.values()) {
      if (tab.container?.cookieStoreId !== oldStoreId) continue
      Tree.updateTab(
        { tabUid: tab.uid },
        { container: structuredClone(replacement) },
      )
    }
  }
  return createRecoveryTransaction(affectedTabs, originals, createdStoreIds)
}

function originalContainers(
  tabs: Tab[],
): Map<UID, ContainerMetadata | undefined> {
  return new Map(
    tabs.map((tab) => [
      tab.uid,
      tab.container ? structuredClone(tab.container) : undefined,
    ]),
  )
}

function createRecoveryTransaction(
  tabs: Tab[],
  originals: Map<UID, ContainerMetadata | undefined>,
  createdStoreIds: string[] = [],
): ContainerRecoveryTransaction {
  let rolledBack = false
  return {
    async rollback(): Promise<void> {
      if (rolledBack) return
      rolledBack = true
      await Promise.allSettled(
        createdStoreIds.map((cookieStoreId) => {
          liveContainers.delete(cookieStoreId)
          return browser.contextualIdentities.remove(cookieStoreId)
        }),
      )
      for (const tab of tabs) {
        const original = originals.get(tab.uid)
        Tree.updateTab(
          { tabUid: tab.uid },
          { container: original ? structuredClone(original) : undefined },
        )
      }
    },
  }
}

function consentMatches(
  containers: Map<string, ContainerMetadata>,
  consentedStoreIds?: string[],
): boolean {
  const consented = new Set(consentedStoreIds ?? [])
  return (
    consented.size === containers.size &&
    [...containers.keys()].every((cookieStoreId) =>
      consented.has(cookieStoreId),
    )
  )
}

function clearContainerSnapshots(
  tabs: Tab[],
  containers: Map<string, ContainerMetadata>,
): void {
  for (const tab of tabs) {
    if (!tab.container || !containers.has(tab.container.cookieStoreId)) continue
    Tree.updateTab({ tabUid: tab.uid }, { container: undefined })
  }
}
