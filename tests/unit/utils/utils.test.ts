import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createUid,
  discardedUrlPrecheck,
  getRedirectUrl,
  isPrivateWindowAccessAllowed,
  isPrivilegedUrl,
  prepareRestorableUrl,
  restorableWindowBounds,
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

  it('preserves finite multi-monitor coordinates and positive dimensions', () => {
    expect(
      restorableWindowBounds({
        left: -1920,
        top: 0,
        width: 1600,
        height: 900,
      }),
    ).toEqual({ left: -1920, top: 0, width: 1600, height: 900 })
  })

  it('omits non-positive dimensions without dropping zero or negative coordinates', () => {
    expect(
      restorableWindowBounds({
        left: 0,
        top: -400,
        width: 0,
        height: -1,
      }),
    ).toEqual({ left: 0, top: -400 })
  })

  it('omits each non-finite window bound independently', () => {
    expect(
      restorableWindowBounds({
        left: Number.NaN,
        top: Number.POSITIVE_INFINITY,
        width: Number.NEGATIVE_INFINITY,
        height: 700,
      }),
    ).toEqual({ height: 700 })
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

  it.each([
    ['', { kind: 'blank' }],
    ['about:blank', { kind: 'blank' }],
    ['about:newtab', { kind: 'blank' }],
    ['chrome://browser/content/blanktab.html', { kind: 'blank' }],
  ] as const)('classifies blank restorable URLs: %s', (url, expected) => {
    expect(prepareRestorableUrl(url, 'Saved title')).toEqual(expected)
  })

  it.each(['https://example.test/path', 'ftp://example.test/file'])(
    'passes through valid restorable URLs: %s',
    (url) => {
      expect(prepareRestorableUrl(url, 'Saved title')).toEqual({
        kind: 'url',
        url,
        redirected: false,
      })
    },
  )

  it('passes through an existing Session Flow redirect URL without nesting it', () => {
    const redirectUrl = getRedirectUrl('about:config', 'Firefox config')

    expect(
      prepareRestorableUrl(redirectUrl, 'Redirect to Firefox config'),
    ).toEqual({
      kind: 'url',
      url: redirectUrl,
      redirected: false,
    })
  })

  it.each([
    'about:config',
    'file:///tmp/example.txt',
    'data:text/plain,hello',
    'javascript:alert(1)',
    'chrome://settings/',
    'moz-extension://other-id/page.html',
    'view-source:https://example.test/',
    'not a valid absolute url',
  ])('redirects restricted or malformed restorable URLs: %s', (url) => {
    const result = prepareRestorableUrl(url, 'Saved title')

    expect(result.kind).toBe('url')
    if (result.kind !== 'url') throw new Error('Expected a URL result')
    expect(result.redirected).toBe(true)
    const redirect = new URL(result.url)
    expect(redirect.pathname).toBe('/redirect.html')
    expect(redirect.searchParams.get('targetUrl')).toBe(url)
    expect(redirect.searchParams.get('targetTitle')).toBe('Saved title')
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
