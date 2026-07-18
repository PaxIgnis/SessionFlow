import type { ContainerMetadata, Tab } from '@/types/session-tree'

export async function missingContainers(
  tabs: Tab[],
): Promise<ContainerMetadata[]> {
  const missing = new Map<string, ContainerMetadata>()
  for (const tab of tabs) {
    if (tab.container) {
      missing.set(tab.container.cookieStoreId, tab.container)
    }
  }
  if (missing.size === 0) return []

  try {
    const identities = await browser.contextualIdentities.query({})
    for (const identity of identities) missing.delete(identity.cookieStoreId)
  } catch {
    // Existing snapshots remain missing when Firefox containers are unavailable.
  }
  return [...missing.values()].map((container) => ({
    cookieStoreId: container.cookieStoreId,
    name: container.name,
    color: container.color,
    colorCode: container.colorCode,
    icon: container.icon,
    ...(container.iconUrl ? { iconUrl: container.iconUrl } : {}),
  }))
}
