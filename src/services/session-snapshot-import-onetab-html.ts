import { i18n } from '@/services/i18n'
import {
  countSnapshotItems,
  validateSessionSnapshotPayload,
} from '@/services/session-snapshot-codec'
import type {
  ParsedSessionSnapshotImport,
  SessionSnapshotImportWarning,
  SnapshotNote,
  SnapshotTopLevelItem,
  SnapshotWindow,
} from '@/types/session-snapshots'
import { State, TreeItemType } from '@/types/session-tree'

// OneTab's "Save as HTML file" writes one `.tabGroup` per group with a
// `.tabGroupTitleText`, a localized `.createdDate`, and a `.tabList` of
// `.tab > a.tabLink` rows and `.innerGroupBlock`s. Named groups show their tab
// count separately in `.tabCountInline`. Notes are not part of this export.
const warningMessages = {
  'browser-specific-urls':
    'Chrome-specific URLs were preserved but may not open in Firefox.',
  'dates-not-imported':
    'Some group creation dates were not imported because their date format was not recognized.',
} satisfies Partial<Record<SessionSnapshotImportWarning['code'], string>>
type WarningCode = keyof typeof warningMessages

interface HtmlElement {
  tag: string
  classes: Set<string>
  attributes: Map<string, string>
  children: HtmlNode[]
  parent?: HtmlElement
}
type HtmlNode = HtmlElement | string

export function isOneTabHtmlImport(text: string): boolean {
  return (
    /^\s*(?:<!doctype html|<html)/i.test(text.trim()) &&
    /\bid=["']?tabGroupsDiv\b/.test(text) &&
    /\bclass=["'][^"']*\btabGroup\b/.test(text)
  )
}

export function parseOneTabHtmlImport(
  text: string,
): ParsedSessionSnapshotImport {
  const root = parseHtml(text)
  const groupsRoot = find(
    root,
    (element) => element.attributes.get('id') === 'tabGroupsDiv',
  )
  if (!groupsRoot) throw new Error(i18n.t('invalidSnapshotFile'))

  const items: SnapshotTopLevelItem[] = []
  const warnings = new Map<WarningCode, number>()
  const warn = (code: WarningCode) =>
    warnings.set(code, (warnings.get(code) ?? 0) + 1)
  let nextId = 0
  const uid = () => `onetab-${++nextId}` as UID

  for (const group of findAll(groupsRoot, hasClass('tabGroup'))) {
    const window: SnapshotWindow = {
      type: TreeItemType.WINDOW,
      uid: uid(),
      state: State.SAVED,
      incognito: false,
      indentLevel: 0,
      collapsed: false,
      isParent: false,
      children: [],
    }
    const header = find(group, hasClass('tabGroupHeader'))
    // Unnamed groups show only their localized tab count as the title.
    if (header && find(header, hasClass('tabCountInline'))) {
      const title = textOf(find(header, hasClass('tabGroupTitleText')))
      if (title) window.title = title
    }
    const created = textOf(header && find(header, hasClass('createdDate')))
    if (created) {
      const savedTime = parseCreatedDate(created)
      if (savedTime === undefined) warn('dates-not-imported')
      else window.savedTime = savedTime
    }

    const addTab = (element: HtmlElement, parent?: SnapshotNote) => {
      const link = find(element, hasClass('tabLink'))
      const url = link?.attributes.get('href')?.trim()
      if (!link || !url) return
      window.children.push({
        type: TreeItemType.TAB,
        uid: uid(),
        windowUid: window.uid,
        state: State.SAVED,
        url,
        title: textOf(link) || url,
        pinned: false,
        indentLevel: (parent?.indentLevel ?? window.indentLevel) + 1,
        collapsed: false,
        isParent: false,
        ...(window.savedTime !== undefined
          ? { savedTime: window.savedTime }
          : {}),
        ...(parent ? { parentUid: parent.uid } : {}),
      })
      if (parent) parent.isParent = true
      if (/^(chrome(?:-extension|-search|-untrusted)?|devtools):/i.test(url))
        warn('browser-specific-urls')
    }

    // Tabs and inner groups are interleaved in saved order. An inner group is
    // one level deep and becomes a note branch holding its tabs.
    const list = find(group, hasClass('tabList'))
    for (const element of list
      ? findAll(
          list,
          (node) => hasClass('tab')(node) || hasClass('innerGroupBlock')(node),
        )
      : []) {
      if (hasClass('innerGroupBlock')(element)) {
        const note: SnapshotNote = {
          type: TreeItemType.NOTE,
          uid: uid(),
          windowUid: window.uid,
          text:
            textOf(find(element, hasClass('innerGroupTitleText'))) ||
            i18n.t('group'),
          indentLevel: window.indentLevel + 1,
          collapsed: false,
          isParent: false,
        }
        window.children.push(note)
        for (const row of findAll(element, hasClass('tab'))) addTab(row, note)
        continue
      }
      addTab(element)
    }
    window.isParent = window.children.length > 0
    items.push(window)
  }

  const payload = validateSessionSnapshotPayload({ schemaVersion: 1, items })
  return {
    payload,
    summary: {
      source: 'onetab',
      counts: countSnapshotItems(items),
      warnings: Array.from(warnings, ([code, count]) => ({
        code,
        count,
        message: warningMessages[code],
      })),
    },
  }
}

// OneTab writes dates with the browser's locale. Only the US short format
// ("Created 11/17/26, 1:26:59 AM") is unambiguous enough to read back.
function parseCreatedDate(text: string): number | undefined {
  const match =
    /(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?/i.exec(
      text,
    )
  if (!match) return undefined
  const [, month, day, year, hour, minute, second, meridiem] = match
  let hours = Number(hour)
  if (meridiem) {
    if (hours < 1 || hours > 12) return undefined
    hours = (hours % 12) + (/p/i.test(meridiem) ? 12 : 0)
  }
  const fullYear = year.length === 2 ? 2000 + Number(year) : Number(year)
  const date = new Date(
    fullYear,
    Number(month) - 1,
    Number(day),
    hours,
    Number(minute),
    Number(second ?? 0),
  )
  // Reject rollovers such as 13/40/26.
  if (
    date.getFullYear() !== fullYear ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day) ||
    date.getHours() !== hours
  )
    return undefined
  return date.getTime()
}

// A minimal reader for OneTab's generated markup. It builds an element tree
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

function parseHtml(html: string): HtmlElement {
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
      const end = html.toLowerCase().indexOf(`</${tag}`, index)
      const stop = end === -1 ? html.length : end
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

function hasClass(name: string) {
  return (element: HtmlElement) => element.classes.has(name)
}

function* walk(element: HtmlElement): Generator<HtmlElement> {
  for (const child of element.children) {
    if (typeof child === 'string') continue
    yield child
    yield* walk(child)
  }
}

function find(
  element: HtmlElement,
  predicate: (element: HtmlElement) => boolean,
): HtmlElement | undefined {
  for (const descendant of walk(element))
    if (predicate(descendant)) return descendant
  return undefined
}

// Matches are returned in document order; descendants of a match are skipped
// so nested groups are not visited twice.
function findAll(
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
function textOf(element: HtmlElement | undefined): string {
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
