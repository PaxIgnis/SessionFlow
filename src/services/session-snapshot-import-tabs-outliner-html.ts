import { i18n } from '@/services/i18n'
import {
  childElements,
  find,
  hasClass,
  isMhtml,
  parseHtml,
  textOf,
  unwrapMhtml,
  type HtmlElement,
} from '@/services/session-snapshot-import-html'
import {
  buildOutlinerImport,
  type OutlinerNode,
  type OutlinerWarning,
} from '@/services/session-snapshot-import-tabs-outliner'
import type { ParsedSessionSnapshotImport } from '@/types/session-snapshots'

// Saving the Tabs Outliner window (Ctrl+S) stores its rendered tree: nested
// `li.nodeTitleAndSubnodesContainer` elements typed by a `<type>NTASC` class,
// each with a `.nodeTitleContainer` row and an optional `ul.subnodeslist`.
// Chrome saves it as MHTML by default; "Webpage, HTML only" saves plain HTML.
const nodeTypes: Record<string, OutlinerNode['type']> = {
  win: 'win',
  savedwin: 'savedwin',
  tab: 'tab',
  savedtab: 'tab',
  group: 'group',
  textnote: 'textnote',
  separatorline: 'separatorline',
}
// Tabs Outliner shows this when a window has no custom title.
const DEFAULT_WINDOW_TITLE = 'Window'
const GROUP_ICON = /\/img\/group-icon\.png$/

export function isTabsOutlinerHtmlImport(text: string): boolean {
  if (isMhtml(text))
    return /^Snapshot-Content-Location:\s*\S*\/activesessionview\.html/im.test(
      text.slice(0, 4096),
    )
  return (
    /^\s*(?:<!doctype html|<html)/i.test(text.slice(0, 1024)) &&
    text.includes('nodeTitleAndSubnodesContainer')
  )
}

export function parseTabsOutlinerHtmlImport(
  text: string,
): ParsedSessionSnapshotImport {
  const page = isMhtml(text) ? unwrapMhtml(text) : { html: text }
  if (!page) invalid()
  const root = parseHtml(page.html)
  const session = find(
    root,
    (element) => element.tag === 'li' && hasClass('sessionNTASC')(element),
  )
  if (!session) invalid()

  // Build the tree with an explicit stack; saved trees can be very deep.
  const roots: OutlinerNode[] = []
  const pending: {
    element: HtmlElement
    path: number[]
    siblings: OutlinerNode[]
  }[] = subnodes(session)
    .map((element, index) => ({ element, path: [index], siblings: roots }))
    .reverse()
  while (pending.length) {
    const { element, path, siblings } = pending.pop()!
    const node = readNode(element, path)
    siblings.push(node)
    const children = subnodes(element)
    for (let i = children.length - 1; i >= 0; i--)
      pending.push({
        element: children[i],
        path: [...path, i],
        siblings: node.children,
      })
  }
  return buildOutlinerImport(
    roots,
    new Map<OutlinerWarning, number>(),
    page.savedAt,
  )
}

function readNode(element: HtmlElement, path: number[]): OutlinerNode {
  const kind = [...element.classes]
    .map((name) => /^([a-z]+)NTASC$/.exec(name)?.[1])
    .find(Boolean)
  let type = kind ? nodeTypes[kind] : undefined
  if (!type) throw new Error(i18n.t('unsupportedOutlinerNode'))
  const row = childElements(element, hasClass('nodeTitleContainer'))[0]
  if (!row) invalid()
  const label = find(row, hasClass('node_text'))
  const comment = textOf(label && find(label, hasClass('tab_comment')))
  let text = textOf(label)
  if (comment && text.startsWith(comment))
    text = text.slice(comment.length).trim()

  const node: OutlinerNode = {
    uid: `tabs-outliner-${path.join('.')}` as UID,
    type,
    data: {},
    collapsed: [...row.classes].some((name) => name.startsWith('collapsed')),
    path,
    children: [],
  }
  if (type === 'tab') {
    const url = row.attributes.get('href') ?? ''
    node.data = {
      url,
      title: text || url,
      ...(row.classes.has('selectedtab') ? { active: true } : {}),
    }
    if (comment) node.title = comment
  } else if (type === 'textnote') {
    node.data = { note: text }
  } else if (type === 'group') {
    if (text) node.title = text
  } else if (type === 'win' || type === 'savedwin') {
    // Groups can be stored as windows that keep the built-in group icon.
    const icon = find(row, hasClass('node_favicon'))
    if (
      icon &&
      [
        icon.attributes.get('src'),
        icon.attributes.get('data-node-icon-for-html-export'),
      ].some((source) => source && GROUP_ICON.test(source))
    )
      type = node.type = 'group'
    if (text && text !== DEFAULT_WINDOW_TITLE) node.title = text
  }
  return node
}

// A node's children are in its `ul.subnodeslist`. Expanding a node wraps the
// list in an animation `<div>`, which can be left in a saved page.
function subnodes(element: HtmlElement): HtmlElement[] {
  let list: HtmlElement | undefined
  const pending = childElements(
    element,
    (child) => !hasClass('nodeTitleContainer')(child),
  )
  while (pending.length && !list) {
    const child = pending.shift()!
    if (child.tag === 'ul' && hasClass('subnodeslist')(child)) list = child
    else if (child.tag === 'div') pending.push(...childElements(child))
  }
  return list
    ? childElements(
        list,
        (child) =>
          child.tag === 'li' &&
          hasClass('nodeTitleAndSubnodesContainer')(child),
      )
    : []
}

function invalid(): never {
  throw new Error(i18n.t('invalidOutlinerBackup'))
}
