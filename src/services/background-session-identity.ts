export const TAB_UID_SESSION_KEY = 'session-flow-tab-uid'
export const WINDOW_UID_SESSION_KEY = 'session-flow-window-uid'

interface StoredIdentity {
  version: 1
  uid: string
}

export async function readTabUid(tabId: number): Promise<UID | undefined> {
  try {
    return storedUid(
      await browser.sessions.getTabValue(tabId, TAB_UID_SESSION_KEY),
    )
  } catch (error) {
    console.error('Failed to read Session Flow tab identity:', error)
    return undefined
  }
}

export async function readWindowUid(
  windowId: number,
): Promise<UID | undefined> {
  try {
    return storedUid(
      await browser.sessions.getWindowValue(windowId, WINDOW_UID_SESSION_KEY),
    )
  } catch (error) {
    console.error('Failed to read Session Flow window identity:', error)
    return undefined
  }
}

export async function writeTabUid(tabId: number, uid: UID): Promise<boolean> {
  try {
    await browser.sessions.setTabValue(
      tabId,
      TAB_UID_SESSION_KEY,
      identityValue(uid),
    )
    return true
  } catch (error) {
    console.error('Failed to write Session Flow tab identity:', error)
    return false
  }
}

export async function writeWindowUid(
  windowId: number,
  uid: UID,
): Promise<boolean> {
  try {
    await browser.sessions.setWindowValue(
      windowId,
      WINDOW_UID_SESSION_KEY,
      identityValue(uid),
    )
    return true
  } catch (error) {
    console.error('Failed to write Session Flow window identity:', error)
    return false
  }
}

function identityValue(uid: UID): StoredIdentity {
  return { version: 1, uid }
}

function storedUid(value: unknown): UID | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const identity = value as Partial<StoredIdentity>
  if (
    identity.version !== 1 ||
    typeof identity.uid !== 'string' ||
    identity.uid.length === 0
  ) {
    return undefined
  }
  return identity.uid as UID
}
