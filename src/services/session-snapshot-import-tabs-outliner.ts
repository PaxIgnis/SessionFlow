import {
  countSnapshotItems,
  validateSessionSnapshotPayload,
} from '@/services/session-snapshot-codec'
import type {
  ParsedSessionSnapshotImport,
  SessionSnapshotImportWarning,
  SnapshotNote,
  SnapshotTab,
  SnapshotTopLevelItem,
  SnapshotWindow,
  SnapshotWindowChild,
} from '@/types/session-snapshots'
import { State, TreeItemType } from '@/types/session-tree'

interface OutlinerNode {
  uid: UID
  type: 'win' | 'savedwin' | 'tab' | 'textnote' | 'group' | 'separatorline'
  data: Record<string, unknown>
  title?: string
  collapsed: boolean
  path: number[]
  children: OutlinerNode[]
}

interface Context {
  window?: SnapshotWindow
  parent?: SnapshotNote | SnapshotTab
  topParent?: SnapshotNote
}

const warningMessages = {
  'nested-windows':
    'Nested windows were moved below their containing window as siblings.',
  'groups-as-notes': 'Tabs Outliner groups were converted to note branches.',
  'tabs-without-window':
    'Tabs outside a window were placed in additional saved windows.',
  'separator-children':
    'Children of separators were moved below the separator as siblings.',
  'browser-specific-urls':
    'Chrome-specific URLs were preserved but may not open in Firefox.',
  'unsupported-appearance':
    'Custom icons, window geometry, and separator styles were not imported.',
} satisfies Partial<Record<SessionSnapshotImportWarning['code'], string>>

export function isTabsOutlinerImport(value: unknown): boolean {
  return (
    (isRecord(value) && value.key === 'currentSessionSnapshot') ||
    (Array.isArray(value) && isRecord(value[0]) && value[0].type === 2000)
  )
}

export function parseTabsOutlinerImport(
  value: unknown,
): ParsedSessionSnapshotImport {
  const records = isRecord(value) ? value.data : value
  if (!Array.isArray(records) || records.length < 2) invalid()
  const header = records[0]
  const footer = records[records.length - 1]
  if (
    !isRecord(header) ||
    header.type !== 2000 ||
    !isRecord(header.node) ||
    header.node.type !== 'session' ||
    !isRecord(header.node.data) ||
    !isRecord(footer) ||
    footer.type !== 11111 ||
    typeof footer.time !== 'number' ||
    !Number.isFinite(footer.time) ||
    !Number.isFinite(new Date(footer.time).getTime())
  )
    invalid()

  const warnings = new Map<keyof typeof warningMessages, number>()
  const warn = (code: keyof typeof warningMessages) =>
    warnings.set(code, (warnings.get(code) ?? 0) + 1)
  const nodes = new Map<string, OutlinerNode>()
  for (const record of records.slice(1, -1)) {
    if (
      !Array.isArray(record) ||
      record.length !== 3 ||
      record[0] !== 2001 ||
      !isRecord(record[1]) ||
      !isRecord(record[1].data) ||
      !Array.isArray(record[2]) ||
      record[2].length === 0 ||
      !record[2].every(
        (part: unknown) =>
          typeof part === 'number' && Number.isSafeInteger(part) && part >= 0,
      )
    )
      invalid()
    const [, raw, path] = record
    const data = raw.data as Record<string, unknown>
    const type =
      raw.type === undefined && typeof data.url === 'string' ? 'tab' : raw.type
    if (!isNodeType(type)) {
      throw new Error(
        'Unsupported Tabs Outliner node type. No snapshot was imported.',
      )
    }
    const marks = raw.marks
    if (
      (marks !== undefined && !isRecord(marks)) ||
      (raw.colapsed !== undefined && typeof raw.colapsed !== 'boolean') ||
      (isRecord(marks) &&
        marks.customTitle !== undefined &&
        typeof marks.customTitle !== 'string')
    )
      invalid()
    if (
      type === 'tab' &&
      (typeof data.url !== 'string' ||
        (data.title !== undefined && typeof data.title !== 'string') ||
        (data.pinned !== undefined && typeof data.pinned !== 'boolean'))
    )
      invalid()
    if (type === 'textnote' && typeof data.note !== 'string') invalid()
    if (
      (type === 'win' || type === 'savedwin') &&
      data.incognito !== undefined &&
      typeof data.incognito !== 'boolean'
    )
      invalid()
    const key = path.join('.')
    if (nodes.has(key)) invalid()
    nodes.set(key, {
      uid: `tabs-outliner-${key}` as UID,
      type,
      data,
      title: isRecord(marks)
        ? (marks.customTitle as string | undefined)
        : undefined,
      collapsed: raw.colapsed === true,
      path,
      children: [],
    })
    if (
      data.rect !== undefined ||
      data.separatorIndx !== undefined ||
      (isRecord(marks) &&
        (marks.customFavicon !== undefined ||
          (Array.isArray(marks.relicons) && marks.relicons.length > 0)))
    )
      warn('unsupported-appearance')
  }

  const roots: OutlinerNode[] = []
  for (const node of nodes.values()) {
    if (node.path.length === 1) roots.push(node)
    else {
      const parent = nodes.get(node.path.slice(0, -1).join('.'))
      if (!parent) invalid()
      parent.children.push(node)
    }
  }
  const sortSiblings = (siblings: OutlinerNode[]) =>
    siblings.sort(
      (a, b) => a.path[a.path.length - 1] - b.path[b.path.length - 1],
    )
  sortSiblings(roots)
  for (const node of nodes.values()) sortSiblings(node.children)

  const items: SnapshotTopLevelItem[] = []
  function createWindow(
    uid: UID,
    title: string | undefined,
    topParent?: SnapshotNote,
  ): SnapshotWindow {
    if (topParent) topParent.isParent = true
    const window: SnapshotWindow = {
      type: TreeItemType.WINDOW,
      uid,
      title,
      state: State.SAVED,
      incognito: false,
      children: [],
      collapsed: false,
      isParent: false,
      indentLevel: topParent ? topParent.indentLevel + 1 : 0,
      ...(topParent ? { parentUid: topParent.uid } : {}),
    }
    items.push(window)
    return window
  }

  // Use a stack so deeply nested exports do not consume the JavaScript call stack.
  const stack: { node: OutlinerNode; context: Context }[] = roots
    .slice()
    .reverse()
    .map((node) => ({ node, context: {} }))
  while (stack.length) {
    const { node, context } = stack.pop()!
    let next: Context
    if (node.type === 'win' || node.type === 'savedwin') {
      if (context.window) warn('nested-windows')
      const window = createWindow(node.uid, node.title, context.topParent)
      window.incognito = node.data.incognito === true
      window.collapsed = node.collapsed
      next = { window, topParent: context.topParent }
    } else {
      let { window, parent } = context
      if (node.type === 'tab' && !window) {
        window = createWindow(
          `${node.uid}-window` as UID,
          'Imported tabs',
          context.topParent,
        )
        parent = undefined
        warn('tabs-without-window')
      }
      const common = {
        uid: node.uid,
        indentLevel: parent
          ? parent.indentLevel + 1
          : window
            ? window.indentLevel + 1
            : 0,
        ...(parent ? { parentUid: parent.uid } : {}),
        ...(window ? { windowUid: window.uid } : {}),
      }
      let item: SnapshotWindowChild
      if (node.type === 'tab') {
        const savedUrl = node.data.url as string
        // Chrome can export a loading tab with an empty URL and a pending destination.
        const url =
          !savedUrl.trim() && typeof node.data.pendingUrl === 'string'
            ? node.data.pendingUrl
            : savedUrl
        item = {
          ...common,
          type: TreeItemType.TAB,
          windowUid: window!.uid,
          title: typeof node.data.title === 'string' ? node.data.title : url,
          url,
          state: State.SAVED,
          pinned: node.data.pinned === true,
          customLabel: node.title,
          collapsed: node.collapsed,
          isParent: false,
        }
        if (node.data.active === true) window!.savedActiveTabUid = item.uid
        if (/^(chrome(?:-extension|-search|-untrusted)?|devtools):/i.test(url))
          warn('browser-specific-urls')
      } else if (node.type === 'separatorline') {
        item = { ...common, type: TreeItemType.SEPARATOR }
        if (node.children.length) warn('separator-children')
      } else {
        if (node.type === 'group') warn('groups-as-notes')
        const note = node.type === 'textnote' ? (node.data.note as string) : ''
        item = {
          ...common,
          type: TreeItemType.NOTE,
          text:
            node.type === 'group'
              ? node.title || 'Group'
              : node.title && node.title !== note
                ? `${node.title}\n${note}`
                : note,
          collapsed: node.collapsed,
          isParent: false,
        }
      }
      if (parent) parent.isParent = true
      if (window) {
        window.children.push(item)
        window.isParent = true
      } else if (item.type !== TreeItemType.TAB) items.push(item)
      next = {
        window,
        parent: item.type === TreeItemType.SEPARATOR ? parent : item,
        topParent:
          !window && item.type === TreeItemType.NOTE ? item : context.topParent,
      }
    }
    for (let i = node.children.length - 1; i >= 0; i--)
      stack.push({ node: node.children[i], context: next })
  }
  const payload = validateSessionSnapshotPayload({ schemaVersion: 1, items })
  return {
    payload,
    summary: {
      source: 'tabs-outliner',
      sourceCreatedAt: footer.time,
      counts: countSnapshotItems(payload.items),
      warnings: Array.from(warnings, ([code, count]) => ({
        code,
        count,
        message: warningMessages[code],
      })),
    },
  }
}

function invalid(): never {
  throw new Error(
    'Invalid or incomplete Tabs Outliner backup. No snapshot was imported.',
  )
}

function isNodeType(value: unknown): value is OutlinerNode['type'] {
  return (
    typeof value === 'string' &&
    ['win', 'savedwin', 'tab', 'textnote', 'group', 'separatorline'].includes(
      value,
    )
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
