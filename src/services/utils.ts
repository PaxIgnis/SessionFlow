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
    url.startsWith(privilegedUrl)
  )
  const startsWithAbout =
    url.startsWith('about:') &&
    !url.startsWith('about:blank') &&
    !url.startsWith('about:newtab')
  return isPrivilegedUrl || startsWithAbout
}
