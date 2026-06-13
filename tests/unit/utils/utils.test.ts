import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createUid,
  discardedUrlPrecheck,
  getRedirectUrl,
  isPrivilegedUrl,
} from '@/services/utils'
import { installFakeBrowser } from '../../helpers/fake-browser'

describe('utils', () => {
  beforeEach(() => {
    installFakeBrowser()
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
