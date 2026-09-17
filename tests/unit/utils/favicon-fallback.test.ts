import { describe, expect, it } from 'vitest'
import { DEFAULT_FAVICON_URL } from '@/defaults/favicons'
import {
  firefoxInternalPageIconStyle,
  isFirefoxInternalPageIcon,
  onFaviconError,
} from '@/services/favicons'

describe('favicon display fallback', () => {
  it('builds a CSS mask only for bundled Firefox internal-page icons', () => {
    const icon = '/icons/firefox/addons.svg'

    expect(isFirefoxInternalPageIcon(icon)).toBe(true)
    expect(isFirefoxInternalPageIcon('/icons/default-favicon.svg')).toBe(false)
    expect(isFirefoxInternalPageIcon('data:image/png;base64,cached')).toBe(
      false,
    )
    expect(firefoxInternalPageIconStyle(icon)).toEqual({
      '--firefox-internal-page-icon-mask': `url("${icon}")`,
    })
  })

  it('can fall back again after Vue reuses the image for another URL', () => {
    let source = ''
    const image = {
      getAttribute: (name: string) => (name === 'src' ? source : null),
      get src() {
        return source
      },
      set src(value: string) {
        source = value
      },
    } as HTMLImageElement

    image.src = '/first-broken.svg'
    onFaviconError({ currentTarget: image } as unknown as Event)
    expect(image.getAttribute('src')).toBe(DEFAULT_FAVICON_URL)

    image.src = '/second-broken.svg'
    onFaviconError({ currentTarget: image } as unknown as Event)
    expect(image.getAttribute('src')).toBe(DEFAULT_FAVICON_URL)
  })

  it('does not reassign the fallback when the fallback itself fails', () => {
    let assignments = 0
    let source = DEFAULT_FAVICON_URL
    const image = {
      getAttribute: (name: string) => (name === 'src' ? source : null),
      get src() {
        return source
      },
      set src(value: string) {
        assignments += 1
        source = value
      },
    } as HTMLImageElement

    onFaviconError({ currentTarget: image } as unknown as Event)

    expect(image.getAttribute('src')).toBe(DEFAULT_FAVICON_URL)
    expect(assignments).toBe(0)
  })
})
