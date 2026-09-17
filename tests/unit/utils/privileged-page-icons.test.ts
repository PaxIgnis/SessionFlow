import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PRIVILEGED_PAGE_ICONS, privilegedPageIcon } from '@/services/favicons'

/*
 * Firefox reports a chrome:// favIconUrl for most of its own pages, but only
 * for open tabs, and those URLs cannot be cached by domain the way web
 * favicons are. The tree resolves them from a static table so saved pages keep
 * their icon too. Verified against Firefox 153.
 */
describe('privileged page icons', () => {
  it('resolves the pages Firefox gives an icon for', () => {
    expect(privilegedPageIcon('about:config')).toBe(
      '/icons/firefox/settings.svg',
    )
    expect(privilegedPageIcon('about:processes')).toBe(
      '/icons/firefox/performance.svg',
    )
    expect(privilegedPageIcon('about:addons')).toBe('/icons/firefox/addons.svg')
  })

  it('matches pages that carry a fragment or sub-path', () => {
    expect(privilegedPageIcon('about:debugging#/runtime/this-firefox')).toBe(
      '/icons/firefox/developer.svg',
    )
    expect(privilegedPageIcon('about:preferences#general')).toBe(
      '/icons/firefox/settings.svg',
    )
  })

  it('leaves web pages to the domain cache', () => {
    expect(privilegedPageIcon('https://example.test/page')).toBeUndefined()
    expect(privilegedPageIcon('')).toBeUndefined()
  })

  it('uses the bundled Firefox default for unmapped internal pages', () => {
    expect(privilegedPageIcon('about:memory')).toBe(
      '/icons/default-favicon.svg',
    )
    expect(privilegedPageIcon('about:downloads')).toBe(
      '/icons/default-favicon.svg',
    )
    expect(privilegedPageIcon('chrome://browser/content/blanktab.html')).toBe(
      '/icons/firefox/firefox.svg',
    )
  })

  it('uses the Firefox logo for blank browser tabs', () => {
    expect(privilegedPageIcon('about:blank')).toBe('/icons/firefox/firefox.svg')
    expect(privilegedPageIcon('chrome://browser/content/blanktab.html')).toBe(
      '/icons/firefox/firefox.svg',
    )
  })

  it('uses only bundled, MPL-attributed assets', () => {
    for (const [, icon] of PRIVILEGED_PAGE_ICONS) {
      expect(icon).toMatch(/^\/icons\/firefox\/[a-z-]+\.svg$/)
      const asset = fs.readFileSync(
        path.join(process.cwd(), 'public', icon),
        'utf8',
      )
      expect(asset).toMatch(/Mozilla Public[\s-]+License, v\. 2\.0/)
      expect(asset).toContain('fill="context-fill"')
    }
  })
})
