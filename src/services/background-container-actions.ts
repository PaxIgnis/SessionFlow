import { Tree } from '@/services/background-tree'
import {
  CONTAINER_RECOVERY_STALE_ERROR,
  type ContainerRecoveryStrategy,
} from '@/types/messages'
import type { ContainerMetadata, Tab } from '@/types/session-tree'

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
    throw new Error(`Firefox container "${first.name}" no longer exists`)
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
