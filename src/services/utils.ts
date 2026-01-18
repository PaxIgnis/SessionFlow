import { PRIVILEGED_URLS } from '@/defaults/constants'

/**
 * Checks if a url can be discarded without error.
 *
 * @param {string} url - The URL to check
 * @returns {boolean} True if the URL can be discarded, false otherwise
 */
export function discardedUrlPrecheck(url: string): boolean {
  const about = url.startsWith('about:')
  const empty = url === ''
  return !(about || empty || isPrivilegedUrl(url))
}

/**
 * Builds the redirect URL for privileged Firefox URLs
 *
 * @param {string} targetUrl - The URL to redirect to
 * @param {string} targetTitle - The title of the target URL
 * @returns {string} The redirect URL
 */
export function getRedirectUrl(targetUrl: string, targetTitle: string): string {
  const redirectUrl =
    browser.runtime.getURL('/redirect.html') +
    `?targetUrl=${encodeURIComponent(targetUrl)}` +
    `&targetTitle=${encodeURIComponent(targetTitle)}`
  return redirectUrl
}

/**
 * Checks if a URL is a privileged URL for Firefox
 *
 * @param {string} url - The URL to check
 * @returns {boolean} True if the URL is a privileged URL, false otherwise
 */
export function isPrivilegedUrl(url: string): boolean {
  const isPrivilegedUrl = PRIVILEGED_URLS.some((privilegedUrl) =>
    url.startsWith(privilegedUrl),
  )
  const startsWithAbout =
    url.startsWith('about:') &&
    !url.startsWith('about:blank') &&
    !url.startsWith('about:newtab')
  return isPrivilegedUrl || startsWithAbout
}

/**
 * Creates a new unique identifier (UUID), ensuring it does not exist in the provided set.
 * Additionally, the new UUID is added to the existing set.
 *
 */
export function createUid(existing: Set<string>): string {
  // Try built-in Web Crypto first
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    const c = crypto as Crypto & { randomUUID?: () => string }
    for (let i = 0; i < 3; i++) {
      const uuid = c.randomUUID ? c.randomUUID() : undefined
      if (uuid && !existing.has(uuid)) {
        existing.add(uuid)
        return uuid
      }
    }
  }

  // Fallback mechanism
  for (let i = 0; i < 3; i++) {
    const fallback =
      'uid-' +
      Date.now().toString(36) +
      '-' +
      Math.floor(Math.random() * 0xfffff).toString(36)
    existing.add(fallback)
    return fallback
  }

  // As a last resort, return a non-unique ID (should not happen)
  const nonUniqueId = 'uid-nonunique-' + Date.now().toString(36)
  existing.add(nonUniqueId)
  console.error(
    'Failed to generate unique UID, returning non-unique ID:',
    nonUniqueId,
  )
  return nonUniqueId
}
