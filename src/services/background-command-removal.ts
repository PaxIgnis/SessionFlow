const claimedTabRemovals = new Map<number, number>()
const claimedWindowRemovals = new Map<number, number>()
const claimedTabRelocations = new Map<number, number>()

function claimRemoval(claims: Map<number, number>, id: number): () => void {
  claims.set(id, (claims.get(id) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const remaining = (claims.get(id) ?? 1) - 1
    if (remaining > 0) claims.set(id, remaining)
    else claims.delete(id)
  }
}

export function claimTabRemoval(tabId: number): () => void {
  return claimRemoval(claimedTabRemovals, tabId)
}

export function claimWindowRemoval(windowId: number): () => void {
  return claimRemoval(claimedWindowRemovals, windowId)
}

export function isCommandOwnedTabRemoval(tabId: number): boolean {
  return claimedTabRemovals.has(tabId)
}

export function isCommandOwnedWindowRemoval(windowId: number): boolean {
  return claimedWindowRemovals.has(windowId)
}

export function claimTabRelocation(tabId: number): () => void {
  return claimRemoval(claimedTabRelocations, tabId)
}

export function isCommandOwnedTabRelocation(tabId: number): boolean {
  return claimedTabRelocations.has(tabId)
}

export function isFirefoxObjectNotFound(error: unknown): boolean {
  const message = String(error).toLowerCase()
  return (
    /invalid (tab|window) id/.test(message) ||
    /no (tab|window) with id/.test(message) ||
    /(tab|window).*(not found|does not exist)/.test(message)
  )
}

export async function removeBrowserTab(tabId: number): Promise<void> {
  const release = claimTabRemoval(tabId)
  try {
    try {
      await browser.tabs.remove(tabId)
    } catch (removalError) {
      try {
        await browser.tabs.get(tabId)
      } catch (lookupError) {
        if (isFirefoxObjectNotFound(lookupError)) return
        throw new Error(
          `Could not confirm whether Firefox removed tab ${tabId}: ${lookupError}`,
          { cause: removalError },
        )
      }
      throw removalError
    }
  } finally {
    release()
  }
}

export async function removeBrowserWindow(windowId: number): Promise<void> {
  const release = claimWindowRemoval(windowId)
  try {
    try {
      await browser.windows.remove(windowId)
    } catch (removalError) {
      try {
        await browser.windows.get(windowId)
      } catch (lookupError) {
        if (isFirefoxObjectNotFound(lookupError)) return
        throw new Error(
          `Could not confirm whether Firefox removed window ${windowId}: ${lookupError}`,
          { cause: removalError },
        )
      }
      throw removalError
    }
  } finally {
    release()
  }
}

export function resetCommandRemovalStateForTests(): void {
  claimedTabRemovals.clear()
  claimedWindowRemovals.clear()
  claimedTabRelocations.clear()
}
