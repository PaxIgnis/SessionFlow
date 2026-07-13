import { describe, expect, it } from 'vitest'
import {
  FIREFOX_TAB_DROP_TYPE,
  hasSupportedExternalDropType,
  normalizeExternalDropItems,
  parseExternalDrop,
  SESSION_FLOW_DROP_TYPE,
} from '@/services/external-drop'

function makeDataTransfer(options: {
  data?: Record<string, string>
  types?: string[]
  mozItems?: unknown[]
  throwOnGetData?: boolean
}): DataTransfer {
  const data = options.data ?? {}
  return {
    types: options.types ?? Object.keys(data),
    getData: (type: string) => {
      if (options.throwOnGetData) throw new DOMException('Protected drag data')
      return data[type] ?? ''
    },
    mozItemCount: options.mozItems?.length ?? 0,
    mozGetDataAt: (_type: string, index: number) => options.mozItems?.[index],
  } as unknown as DataTransfer
}

describe('external drop parsing', () => {
  it('prefers Firefox URL/title pairs over fallback formats', () => {
    const payload = parseExternalDrop(
      makeDataTransfer({
        data: {
          'text/x-moz-url':
            'https://one.example\r\nOne\r\nhttps://two.example/path\r\nTwo',
          'text/uri-list': 'https://fallback.example',
          'text/plain': 'https://plain.example',
        },
      }),
    )

    expect(payload.items).toEqual([
      { url: 'https://one.example/', title: 'One' },
      { url: 'https://two.example/path', title: 'Two' },
    ])
  })

  it('keeps URL/title pairs aligned when a Firefox title is empty', () => {
    const payload = parseExternalDrop(
      makeDataTransfer({
        data: {
          'text/x-moz-url':
            'https://one.example\r\n\r\nhttps://two.example\r\nTwo',
        },
      }),
    )

    expect(payload.items).toEqual([
      { url: 'https://one.example/' },
      { url: 'https://two.example/', title: 'Two' },
    ])
  })

  it('parses multiple URI-list links and comments in either title position', () => {
    const payload = parseExternalDrop(
      makeDataTransfer({
        data: {
          'text/uri-list': [
            '# First title',
            'https://one.example',
            'https://two.example/path',
            '# Second title',
            'javascript:alert(1)',
            'not a URL',
          ].join('\r\n'),
        },
      }),
    )

    expect(payload.items).toEqual([
      { url: 'https://one.example/', title: 'First title' },
      { url: 'https://two.example/path', title: 'Second title' },
    ])
  })

  it('accepts only web URLs from plain-text fallback data', () => {
    const payload = parseExternalDrop(
      makeDataTransfer({
        data: {
          'text/plain': [
            'https://one.example',
            'http://two.example/path',
            'file:///tmp/private.html',
            'about:config',
            'data:text/plain,unsafe',
            'search words',
          ].join('\n'),
        },
      }),
    )

    expect(payload.items).toEqual([
      { url: 'https://one.example/' },
      { url: 'http://two.example/path' },
    ])
  })

  it('falls back when a preferred advertised format has no valid URL', () => {
    const payload = parseExternalDrop(
      makeDataTransfer({
        data: {
          'text/x-moz-url': 'not a URL\r\nInvalid',
          'text/uri-list': 'https://fallback.example',
        },
      }),
    )

    expect(payload.items).toEqual([{ url: 'https://fallback.example/' }])
  })

  it('accepts file and supported Firefox URLs from URL-specific data', () => {
    const payload = parseExternalDrop(
      makeDataTransfer({
        data: {
          'text/uri-list': [
            'file:///tmp/example.html',
            'about:config',
            'chrome://browser/content/browser.xhtml',
            'blob:https://example.test/id',
          ].join('\n'),
        },
      }),
    )

    expect(payload.items).toEqual([
      { url: 'file:///tmp/example.html' },
      { url: 'about:config' },
      { url: 'chrome://browser/content/browser.xhtml' },
    ])
  })

  it('extracts only unique numeric IDs exposed by native Firefox tabs', () => {
    const payload = parseExternalDrop(
      makeDataTransfer({
        types: [FIREFOX_TAB_DROP_TYPE, 'text/x-moz-text-internal'],
        data: { 'text/x-moz-text-internal': 'https://example.test' },
        mozItems: [
          { tabId: 42 },
          { id: 43 },
          { id: 'not-numeric' },
          { id: 42 },
        ],
      }),
    )

    expect(payload.firefoxTabIds).toEqual([42, 43])
    expect(payload.items).toEqual([{ url: 'https://example.test/' }])
  })

  it('recognizes protected native payloads without requiring readable data', () => {
    const dataTransfer = makeDataTransfer({
      types: [FIREFOX_TAB_DROP_TYPE],
      throwOnGetData: true,
    })

    expect(hasSupportedExternalDropType(dataTransfer)).toBe(true)
    expect(parseExternalDrop(dataTransfer)).toEqual({
      items: [],
      firefoxTabIds: [],
    })
  })

  it('does not reinterpret Session Flow payloads as external URL copies', () => {
    const dataTransfer = makeDataTransfer({
      data: {
        [SESSION_FLOW_DROP_TYPE]: '{"items":[]}',
        'text/uri-list': 'https://example.test',
      },
    })

    expect(hasSupportedExternalDropType(dataTransfer)).toBe(false)
    expect(parseExternalDrop(dataTransfer).items).toEqual([])
  })

  it('revalidates and normalizes background items without removing duplicates', () => {
    expect(
      normalizeExternalDropItems([
        { url: ' https://example.test ', title: ' First ' },
        { url: 'https://example.test/', title: 'Duplicate' },
        { url: 'file:///tmp/example.html' },
        { url: 'javascript:alert(1)' },
        { url: 'not a URL' },
        { url: 42, title: null } as unknown as {
          url: string
          title?: string
        },
      ]),
    ).toEqual([
      { url: 'https://example.test/', title: 'First' },
      { url: 'https://example.test/', title: 'Duplicate' },
      { url: 'file:///tmp/example.html' },
    ])
  })
})
