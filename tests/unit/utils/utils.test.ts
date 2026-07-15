import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createUid,
  discardedUrlPrecheck,
  getRedirectUrl,
  isPrivateWindowAccessAllowed,
  isPrivilegedUrl,
} from '@/services/utils'
import { installFakeBrowser } from '../../helpers/fake-browser'

describe('utils', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    installFakeBrowser()
  })

  it('returns Firefox private-window access state', async () => {
    const fakeBrowser = installFakeBrowser()
    fakeBrowser.extension.isAllowedIncognitoAccess?.mockResolvedValueOnce(false)

    expect(await isPrivateWindowAccessAllowed()).toBe(false)

    fakeBrowser.extension.isAllowedIncognitoAccess?.mockResolvedValueOnce(true)

    expect(await isPrivateWindowAccessAllowed()).toBe(true)
  })

  it('returns false when the private-window access API is unavailable', async () => {
    const fakeBrowser = installFakeBrowser()
    delete fakeBrowser.extension.isAllowedIncognitoAccess

    expect(await isPrivateWindowAccessAllowed()).toBe(false)
  })

  it('returns false and logs when checking private-window access fails', async () => {
    const fakeBrowser = installFakeBrowser()
    const error = new Error('private access unavailable')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeBrowser.extension.isAllowedIncognitoAccess?.mockRejectedValue(error)

    expect(await isPrivateWindowAccessAllowed()).toBe(false)
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to check private-window access:',
      error,
    )
  })

  it.each([
    ['about:config', true],
    ['about:addons', true],
    ['about:blank', false],
    ['about:newtab', false],
    ['https://example.test', false],
  ])('detects privileged URLs: %s', (url, expected) => {
    expect(isPrivilegedUrl(url)).toBe(expected)
  })

  it.each([
    ['https://example.test', true],
    ['about:blank', false],
    ['about:config', false],
    ['', false],
  ])('prechecks discarded URLs: %s', (url, expected) => {
    expect(discardedUrlPrecheck(url)).toBe(expected)
  })

  it('builds encoded redirect URLs for privileged targets', () => {
    const redirect = getRedirectUrl('about:config?x=1 y=2', 'Config & More')

    expect(redirect).toBe(
      'moz-extension://test-id/redirect.html' +
        '?targetUrl=about%3Aconfig%3Fx%3D1%20y%3D2' +
        '&targetTitle=Config%20%26%20More',
    )
  })

  it('skips duplicate crypto UUIDs and adds the new UID to the set', () => {
    const existing = new Set<string>(['duplicate'])
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce('duplicate')
      .mockReturnValueOnce('unique')
    const originalCrypto = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID },
    })

    const uid = createUid(existing)

    expect(uid).toBe('unique')
    expect(existing.has('unique')).toBe(true)

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    })
  })
})
