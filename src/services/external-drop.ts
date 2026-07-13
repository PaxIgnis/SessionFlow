import { ExternalDropItem, ExternalDropPayload } from '@/types/external-drop'

export const SESSION_FLOW_DROP_TYPE = 'application/x-sessionflow-draganddrop'
export const FIREFOX_TAB_DROP_TYPE = 'application/x-moz-tabbrowser-tab'

const MOZ_URL_TYPE = 'text/x-moz-url'
const MOZ_URL_DATA_TYPE = 'text/x-moz-url-data'
const MOZ_TEXT_INTERNAL_TYPE = 'text/x-moz-text-internal'
const URI_LIST_TYPE = 'text/uri-list'
const PLAIN_TEXT_TYPE = 'text/plain'

const URL_TYPES = [
  MOZ_URL_TYPE,
  MOZ_URL_DATA_TYPE,
  URI_LIST_TYPE,
  MOZ_TEXT_INTERNAL_TYPE,
  PLAIN_TEXT_TYPE,
] as const

const WEB_SCHEMES = new Set(['http:', 'https:'])
const URL_SPECIFIC_SCHEMES = new Set([
  ...WEB_SCHEMES,
  'about:',
  'chrome:',
  'file:',
])

type FirefoxDataTransfer = DataTransfer & {
  mozItemCount?: number
  mozGetDataAt?: (format: string, index: number) => unknown
}

/** Returns whether a drag advertises a URL or native Firefox tab payload. */
export function hasSupportedExternalDropType(
  dataTransfer: DataTransfer | null,
): boolean {
  if (!dataTransfer || hasDataType(dataTransfer, SESSION_FLOW_DROP_TYPE)) {
    return false
  }

  return (
    hasDataType(dataTransfer, FIREFOX_TAB_DROP_TYPE) ||
    URL_TYPES.some((type) => hasDataType(dataTransfer, type))
  )
}

/** Parses URLs and any reliable WebExtension tab IDs from an external drop. */
export function parseExternalDrop(
  dataTransfer: DataTransfer | null,
): ExternalDropPayload {
  if (!dataTransfer || hasDataType(dataTransfer, SESSION_FLOW_DROP_TYPE)) {
    return { items: [], firefoxTabIds: [] }
  }

  const firefoxTabIds = getFirefoxNativeTabIds(dataTransfer)
  const items = readPreferredUrlPayload(dataTransfer)

  return { items, firefoxTabIds }
}

/** Revalidates message data in the background before opening or storing it. */
export function normalizeExternalDropItems(
  items: ExternalDropItem[],
): ExternalDropItem[] {
  if (!Array.isArray(items)) return []
  return items.flatMap((item) => {
    if (!item || typeof item.url !== 'string') return []
    const url = normalizeUrl(item.url, true)
    if (!url) return []
    const title = typeof item.title === 'string' ? item.title.trim() : undefined
    return [{ url, ...(title ? { title } : {}) }]
  })
}

function readPreferredUrlPayload(
  dataTransfer: DataTransfer,
): ExternalDropItem[] {
  const mozUrl = safeGetData(dataTransfer, MOZ_URL_TYPE)
  if (mozUrl) {
    const items = parseMozUrl(mozUrl)
    if (items.length > 0) return items
  }

  const mozUrlData = safeGetData(dataTransfer, MOZ_URL_DATA_TYPE)
  if (mozUrlData) {
    const items = parseUrlLines(mozUrlData, true)
    if (items.length > 0) return items
  }

  const uriList = safeGetData(dataTransfer, URI_LIST_TYPE)
  if (uriList) {
    const items = parseUriList(uriList)
    if (items.length > 0) return items
  }

  const mozInternal = safeGetData(dataTransfer, MOZ_TEXT_INTERNAL_TYPE)
  if (mozInternal) {
    const items = parseUrlLines(mozInternal, true)
    if (items.length > 0) return items
  }

  const plainText = safeGetData(dataTransfer, PLAIN_TEXT_TYPE)
  if (plainText) return parseUrlLines(plainText, false)

  return []
}

function parseMozUrl(value: string): ExternalDropItem[] {
  const lines = value.split(/\r?\n/u).map((line) => line.trim())
  const items: ExternalDropItem[] = []

  for (let index = 0; index < lines.length; index += 2) {
    const url = normalizeUrl(lines[index], true)
    if (!url) continue
    const title = lines[index + 1]?.trim()
    items.push({ url, ...(title ? { title } : {}) })
  }

  return items
}

function parseUriList(value: string): ExternalDropItem[] {
  const items: ExternalDropItem[] = []
  let pendingTitle: string | undefined

  for (const line of splitLines(value)) {
    if (line.startsWith('#')) {
      const title = line.slice(1).trim()
      if (!title) continue
      const previous = items.at(-1)
      if (previous && !previous.title) previous.title = title
      else pendingTitle = title
      continue
    }

    const url = normalizeUrl(line, true)
    if (!url) continue
    items.push({
      url,
      ...(pendingTitle ? { title: pendingTitle } : {}),
    })
    pendingTitle = undefined
  }

  return items
}

function parseUrlLines(
  value: string,
  allowUrlSpecificSchemes: boolean,
): ExternalDropItem[] {
  return splitLines(value).flatMap((line) => {
    const url = normalizeUrl(line, allowUrlSpecificSchemes)
    return url ? [{ url }] : []
  })
}

function normalizeUrl(
  value: string,
  allowUrlSpecificSchemes: boolean,
): string | undefined {
  const trimmed = value.trim()
  if (!trimmed || containsControlCharacters(trimmed)) return undefined

  try {
    const parsed = new URL(trimmed)
    const allowedSchemes = allowUrlSpecificSchemes
      ? URL_SPECIFIC_SCHEMES
      : WEB_SCHEMES
    return allowedSchemes.has(parsed.protocol) ? parsed.href : undefined
  } catch {
    return undefined
  }
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

function getFirefoxNativeTabIds(dataTransfer: DataTransfer): number[] {
  if (!hasDataType(dataTransfer, FIREFOX_TAB_DROP_TYPE)) return []

  const firefoxTransfer = dataTransfer as FirefoxDataTransfer
  if (typeof firefoxTransfer.mozGetDataAt !== 'function') return []

  const ids: number[] = []
  const itemCount = Math.max(1, firefoxTransfer.mozItemCount ?? 1)
  for (let index = 0; index < itemCount; index++) {
    try {
      const value = firefoxTransfer.mozGetDataAt(
        FIREFOX_TAB_DROP_TYPE,
        index,
      ) as { id?: unknown; tabId?: unknown } | null
      const id = value?.tabId ?? value?.id
      if (
        typeof id === 'number' &&
        Number.isSafeInteger(id) &&
        id >= 0 &&
        !ids.includes(id)
      ) {
        ids.push(id)
      }
    } catch {
      // Firefox may expose the native type without granting its chrome object.
    }
  }
  return ids
}

function safeGetData(dataTransfer: DataTransfer, type: string): string {
  try {
    return dataTransfer.getData(type)
  } catch {
    return ''
  }
}

function hasDataType(dataTransfer: DataTransfer, type: string): boolean {
  return Array.from(dataTransfer.types ?? []).some(
    (candidate) => candidate.toLowerCase() === type,
  )
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
}
