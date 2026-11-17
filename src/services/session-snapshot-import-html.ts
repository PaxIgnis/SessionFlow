export interface HtmlElement {
  tag: string
  classes: Set<string>
  attributes: Map<string, string>
  children: HtmlNode[]
  parent?: HtmlElement
}
export type HtmlNode = HtmlElement | string

// A minimal reader for the generated markup of other extensions' exports. It builds an element tree
// from tags and text, ignoring comments and the contents of raw-text elements.
const voidTags = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])
const rawTextTags = new Set(['script', 'style', 'title', 'textarea'])

export function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = {
    tag: '#root',
    classes: new Set(),
    attributes: new Map(),
    children: [],
  }
  let current = root
  const tagPattern =
    /<!--[\s\S]*?-->|<![^>]*>|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
  let index = 0
  for (
    let match = tagPattern.exec(html);
    match;
    match = tagPattern.exec(html)
  ) {
    if (match.index > index)
      current.children.push(decodeEntities(html.slice(index, match.index)))
    index = tagPattern.lastIndex
    const [, closing, rawTag, rawAttributes] = match
    if (!rawTag) continue
    const tag = rawTag.toLowerCase()
    if (closing) {
      // Close the nearest matching element; stray closing tags are ignored.
      for (
        let element: HtmlElement | undefined = current;
        element;
        element = element.parent
      ) {
        if (element.tag === tag) {
          current = element.parent ?? root
          break
        }
      }
      continue
    }
    const attributes = parseAttributes(rawAttributes)
    const element: HtmlElement = {
      tag,
      classes: new Set(
        (attributes.get('class') ?? '').split(/\s+/).filter(Boolean),
      ),
      attributes,
      children: [],
      parent: current,
    }
    current.children.push(element)
    if (voidTags.has(tag) || /\/\s*$/.test(rawAttributes)) continue
    if (rawTextTags.has(tag)) {
      const endPattern = new RegExp(`</${tag}`, 'gi')
      endPattern.lastIndex = index
      const stop = endPattern.exec(html)?.index ?? html.length
      element.children.push(decodeEntities(html.slice(index, stop)))
      const close = html.indexOf('>', stop)
      index = close === -1 ? html.length : close + 1
      tagPattern.lastIndex = index
      continue
    }
    current = element
  }
  if (index < html.length)
    current.children.push(decodeEntities(html.slice(index)))
  return root
}

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>()
  const pattern =
    /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const [, name, double, single, bare] = match
    attributes.set(
      name.toLowerCase(),
      decodeEntities(double ?? single ?? bare ?? ''),
    )
  }
  return attributes
}

const namedEntities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: String.fromCharCode(0xa0),
}

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (entity, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10)
        return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : entity
      }
      return namedEntities[body.toLowerCase()] ?? entity
    },
  )
}

export function hasClass(name: string) {
  return (element: HtmlElement) => element.classes.has(name)
}

function* walk(element: HtmlElement): Generator<HtmlElement> {
  for (const child of element.children) {
    if (typeof child === 'string') continue
    yield child
    yield* walk(child)
  }
}

export function find(
  element: HtmlElement,
  predicate: (element: HtmlElement) => boolean,
): HtmlElement | undefined {
  for (const descendant of walk(element))
    if (predicate(descendant)) return descendant
  return undefined
}

// Matches are returned in document order; descendants of a match are skipped
// so nested groups are not visited twice.
export function findAll(
  element: HtmlElement,
  predicate: (element: HtmlElement) => boolean,
): HtmlElement[] {
  const result: HtmlElement[] = []
  const visit = (parent: HtmlElement) => {
    for (const child of parent.children) {
      if (typeof child === 'string') continue
      if (predicate(child)) result.push(child)
      else visit(child)
    }
  }
  visit(element)
  return result
}

// Element text with whitespace collapsed, as the browser would display it.
export function textOf(element: HtmlElement | undefined): string {
  if (!element) return ''
  const parts: string[] = []
  const visit = (node: HtmlElement) => {
    for (const child of node.children) {
      if (typeof child === 'string') parts.push(child)
      else visit(child)
    }
  }
  visit(element)
  return parts.join('').replace(/\s+/g, ' ').trim()
}

export function childElements(
  element: HtmlElement,
  predicate: (element: HtmlElement) => boolean = () => true,
): HtmlElement[] {
  return element.children.filter(
    (child): child is HtmlElement =>
      typeof child !== 'string' && predicate(child),
  )
}

export interface MhtmlDocument {
  html: string
  /** The `Date` header of the archive, when present and valid. */
  savedAt?: number
}

// Chrome's "Save page as" defaults to MHTML: a MIME `multipart/related`
// archive whose `text/html` part is usually quoted-printable encoded.
export function isMhtml(text: string): boolean {
  const header = mimeHeader(text)
  return (
    /^MIME-Version:/im.test(header) &&
    /^Content-Type:\s*multipart\/related/im.test(header)
  )
}

export function unwrapMhtml(text: string): MhtmlDocument | undefined {
  const header = mimeHeader(text)
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(header)?.[1]
  if (!boundary) return undefined
  for (const part of text.split(`--${boundary}`)) {
    const body = part.replace(/^\r?\n/, '')
    const split = /\r?\n\r?\n/.exec(body)
    if (!split) continue
    const partHeader = body.slice(0, split.index)
    if (!/^Content-Type:\s*text\/html/im.test(partHeader)) continue
    const content = body.slice(split.index + split[0].length)
    const charset =
      /charset="?([\w-]+)"?/i.exec(partHeader)?.[1]?.toLowerCase() ?? 'utf-8'
    const encoding =
      /^Content-Transfer-Encoding:\s*([\w-]+)/im
        .exec(partHeader)?.[1]
        ?.toLowerCase() ?? '7bit'
    const html =
      encoding === 'quoted-printable'
        ? decodeBytes(quotedPrintableBytes(content), charset)
        : encoding === 'base64'
          ? decodeBytes(base64Bytes(content), charset)
          : content
    const date = /^Date:\s*(.+)$/im.exec(header)?.[1]
    const savedAt = date ? new Date(date.trim()).getTime() : NaN
    return { html, ...(Number.isFinite(savedAt) ? { savedAt } : {}) }
  }
  return undefined
}

function mimeHeader(text: string): string {
  const end = /\r?\n\r?\n/.exec(text)
  return end ? text.slice(0, end.index) : text
}

function quotedPrintableBytes(text: string): Uint8Array {
  const source = text.replace(/=\r?\n/g, '')
  const bytes = new Uint8Array(source.length)
  let length = 0
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i)
    if (code === 0x3d && /^[\dA-F]{2}$/i.test(source.slice(i + 1, i + 3))) {
      bytes[length++] = parseInt(source.slice(i + 1, i + 3), 16)
      i += 2
    } else bytes[length++] = code & 0xff
  }
  return bytes.subarray(0, length)
}

function base64Bytes(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder().decode(bytes)
  }
}
