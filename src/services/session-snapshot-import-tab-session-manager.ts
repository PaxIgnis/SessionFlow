import {
  countSnapshotItems,
  validateSessionSnapshotPayload,
} from '@/services/session-snapshot-codec'
import type {
  ParsedSessionSnapshotImport,
  SessionSnapshotImportWarning,
  SnapshotTab,
  SnapshotTabGroupMetadata,
  SnapshotTopLevelItem,
  SnapshotWindow,
} from '@/types/session-snapshots'
import { State, TreeItemType, type TabGroupColor } from '@/types/session-tree'

// Native exports are arrays of sessions with window/tab maps keyed by browser IDs.
// https://github.com/sienori/Tab-Session-Manager/blob/master/src/background/save.js
// https://github.com/sienori/Tab-Session-Manager/blob/master/src/background/export.js
const warningMessages = {
  'sessions-as-notes':
    'Session names and tags were preserved as note branches containing saved windows.',
  'containers-not-imported':
    'Container assignments were not imported because the export only contains browser-profile-specific container IDs.',
  'invalid-parent-links':
    'Missing, self-referencing, or cyclic tab parent links were removed. All affected tabs were kept.',
  'tab-order':
    'Tabs were moved beside their parent branches to preserve the saved hierarchy.',
  'tab-group-metadata':
    'Some tab group details were unavailable. Default colors or names were used.',
  'window-presentation':
    'Browser window types and display states were converted to ordinary saved windows.',
  'unsupported-appearance':
    'External favicon images were not imported. Available Session Flow icons will be used.',
  'browser-specific-urls':
    'Chrome-specific URLs were preserved but may not open in Firefox.',
} satisfies Partial<Record<SessionSnapshotImportWarning['code'], string>>
const groupColors = new Set<string>([
  'blue',
  'cyan',
  'grey',
  'green',
  'orange',
  'pink',
  'purple',
  'red',
  'yellow',
])

export function isTabSessionManagerImport(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some(
      (session) =>
        isRecord(session) &&
        typeof session.type !== 'number' &&
        (isRecord(session.windows) ||
          ('tabsNumber' in session && 'sessionStartTime' in session)),
    )
  )
}

export function parseTabSessionManagerImport(
  value: unknown,
): ParsedSessionSnapshotImport {
  if (!Array.isArray(value) || !value.length) invalid()
  const items: SnapshotTopLevelItem[] = []
  const warnings = new Map<keyof typeof warningMessages, number>()
  const warn = (code: keyof typeof warningMessages, count = 1) =>
    warnings.set(code, (warnings.get(code) ?? 0) + count)
  let nextId = 0
  const uid = () => `tab-session-manager-${++nextId}` as UID
  let sourceCreatedAt: number | undefined

  for (const [sessionIndex, rawSession] of value.entries()) {
    const session = record(rawSession)
    const windows = record(session.windows)
    if (
      typeof session.name !== 'string' ||
      !Array.isArray(session.tag) ||
      !session.tag.every((tag) => typeof tag === 'string')
    )
      invalid()
    integer(session.tabsNumber, 0)
    if (session.windowsNumber !== undefined) integer(session.windowsNumber, 0)
    const savedTime = timestamp(session.date)
    timestamp(session.sessionStartTime)
    if (session.lastEditedTime !== undefined) timestamp(session.lastEditedTime)
    if (value.length === 1) sourceCreatedAt = savedTime
    const windowInfo =
      session.windowsInfo === undefined ? {} : record(session.windowsInfo)
    if (session.tabGroups !== undefined && !Array.isArray(session.tabGroups))
      invalid()
    const groups = new Map<number, Record<string, unknown>>()
    for (const rawGroup of (session.tabGroups ?? []) as unknown[]) {
      const group = record(rawGroup)
      const id = integer(group.id, 0)
      if (groups.has(id)) invalid()
      if (group.windowId !== undefined) integer(group.windowId, 0)
      optionalString(group, 'title')
      optionalString(group, 'color')
      optionalBoolean(group, 'collapsed')
      groups.set(id, group)
    }
    const sessionUid = uid()
    items.push({
      type: TreeItemType.NOTE,
      uid: sessionUid,
      text: session.name || `Session ${sessionIndex + 1}`,
      indentLevel: 0,
      collapsed: false,
      isParent: Object.keys(windows).length > 0 || session.tag.length > 0,
    })
    warn('sessions-as-notes')
    if (session.tag.length)
      items.push({
        type: TreeItemType.NOTE,
        uid: uid(),
        parentUid: sessionUid,
        text: `Tags: ${session.tag.join(', ')}`,
        indentLevel: 1,
        collapsed: false,
        isParent: false,
      })

    for (const [windowKey, rawTabs] of Object.entries(windows)) {
      const windowId = mapId(windowKey)
      const info =
        windowInfo[windowKey] === undefined ? {} : record(windowInfo[windowKey])
      optionalBoolean(info, 'incognito')
      const entries = Object.entries(record(rawTabs)).map(([key, rawTab]) => {
        const source = record(rawTab)
        const id = mapId(key)
        if (source.id !== undefined && integer(source.id, 0) !== id) invalid()
        if (
          source.windowId !== undefined &&
          integer(source.windowId, 0) !== windowId
        )
          invalid()
        const index =
          source.index === undefined ? undefined : integer(source.index, 0)
        for (const key of ['pinned', 'active', 'incognito'])
          optionalBoolean(source, key)
        return { source, id, index }
      })
      // Object key order is tab ID order, not the saved tab-strip order.
      entries.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      const window: SnapshotWindow = {
        type: TreeItemType.WINDOW,
        uid: uid(),
        state: State.SAVED,
        title: optionalString(info, 'title'),
        incognito:
          info.incognito === true ||
          entries.some(({ source }) => source.incognito === true),
        parentUid: sessionUid,
        indentLevel: 1,
        savedTime,
        isParent: entries.length > 0,
        collapsed: false,
        children: [],
      }
      const position = ['left', 'top', 'width', 'height'].map((key) =>
        optionalNumber(info, key),
      )
      if (position.every((part) => part !== undefined))
        window.windowPosition = {
          left: position[0]!,
          top: position[1]!,
          width: position[2]!,
          height: position[3]!,
        }
      if (
        (info.type !== undefined && info.type !== 'normal') ||
        (info.state !== undefined && info.state !== 'normal') ||
        (position.some((part) => part !== undefined) && !window.windowPosition)
      )
        warn('window-presentation')
      const windowGroups = new Map<number, SnapshotTabGroupMetadata>()
      const tabsById = new Map<number, SnapshotTab>()
      const parents = new Map<number, number>()
      for (const { source, id } of entries) {
        const url =
          optionalString(source, 'url') || optionalString(source, 'pendingUrl')
        // Empty URLs can be present for tabs that were still loading when saved.
        if (url === undefined && source.url !== '') invalid()
        const tab: SnapshotTab = {
          type: TreeItemType.TAB,
          uid: uid(),
          windowUid: window.uid,
          state: State.SAVED,
          url: url ?? '',
          title: optionalString(source, 'title') ?? url ?? '',
          pinned: source.pinned === true,
          indentLevel: 2,
          collapsed: false,
          isParent: false,
          savedTime,
        }
        tabsById.set(id, tab)
        if (source.active === true) window.savedActiveTabUid = tab.uid
        if (source.openerTabId !== undefined)
          parents.set(id, integer(source.openerTabId, -1))
        if (source.groupId !== undefined) {
          const groupId = integer(source.groupId, -1)
          if (groupId >= 0) {
            if (!windowGroups.has(groupId)) {
              const group = groups.get(groupId)
              const matching =
                group &&
                (group.windowId === undefined || group.windowId === windowId)
                  ? group
                  : undefined
              const color = matching?.color
              if (
                !matching ||
                typeof color !== 'string' ||
                !groupColors.has(color)
              )
                warn('tab-group-metadata')
              windowGroups.set(groupId, {
                uid: uid(),
                title: matching?.title as string | undefined,
                color:
                  typeof color === 'string' && groupColors.has(color)
                    ? (color as TabGroupColor)
                    : 'grey',
                collapsed: matching?.collapsed === true,
              })
            }
            tab.tabGroup = { ...windowGroups.get(groupId)! }
          }
        }
        const container = optionalString(source, 'cookieStoreId')
        if (
          container &&
          container !== 'firefox-default' &&
          container !== 'firefox-private'
        )
          warn('containers-not-imported')
        if (typeof source.favIconUrl === 'string' && source.favIconUrl)
          warn('unsupported-appearance')
        if (
          /^(chrome(?:-extension|-search|-untrusted)?|devtools):/i.test(tab.url)
        )
          warn('browser-specific-urls')
      }

      // Repair stale opener links before producing the strict snapshot tree.
      for (const [id, parent] of parents) {
        if (id === parent || !tabsById.has(parent)) {
          parents.delete(id)
          warn('invalid-parent-links')
        }
      }
      const visited = new Set<number>()
      for (const id of tabsById.keys()) {
        const path = new Set<number>()
        let current: number | undefined = id
        while (current !== undefined && !visited.has(current)) {
          path.add(current)
          const parent: number | undefined = parents.get(current)
          if (parent !== undefined && path.has(parent)) {
            parents.delete(current)
            warn('invalid-parent-links')
            break
          }
          current = parent
        }
        for (const ancestor of path) visited.add(ancestor)
      }
      const children = new Map<number | undefined, number[]>()
      for (const id of tabsById.keys()) {
        const parent = parents.get(id)
        const siblings = children.get(parent) ?? []
        siblings.push(id)
        children.set(parent, siblings)
      }
      const pending = [...(children.get(undefined) ?? [])].reverse()
      while (pending.length) {
        const id = pending.pop()!
        const tab = tabsById.get(id)!
        const parentId = parents.get(id)
        if (parentId !== undefined) {
          const parent = tabsById.get(parentId)!
          tab.parentUid = parent.uid
          tab.indentLevel = parent.indentLevel + 1
          parent.isParent = true
        }
        window.children.push(tab)
        const descendants = children.get(id) ?? []
        for (let i = descendants.length - 1; i >= 0; i--)
          pending.push(descendants[i])
      }
      if (
        window.children.some(
          (tab, index) => tab !== tabsById.get(entries[index].id),
        )
      )
        warn('tab-order')
      items.push(window)
    }
  }
  const payload = validateSessionSnapshotPayload({ schemaVersion: 1, items })
  return {
    payload,
    summary: {
      source: 'tab-session-manager',
      ...(sourceCreatedAt !== undefined ? { sourceCreatedAt } : {}),
      counts: countSnapshotItems(items),
      warnings: Array.from(warnings, ([code, count]) => ({
        code,
        count,
        message: warningMessages[code],
      })),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) invalid()
  return value
}
function optionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key]
  if (field !== undefined && typeof field !== 'string') invalid()
  return field as string | undefined
}
function optionalBoolean(value: Record<string, unknown>, key: string): void {
  if (value[key] !== undefined && typeof value[key] !== 'boolean') invalid()
}
function optionalNumber(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  const field = value[key]
  if (
    field !== undefined &&
    (typeof field !== 'number' || !Number.isFinite(field))
  )
    invalid()
  return field as number | undefined
}
function integer(value: unknown, min: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min)
    invalid()
  return value
}
function mapId(value: string): number {
  const id = integer(Number(value), 0)
  if (String(id) !== value) invalid()
  return id
}
function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(new Date(value).getTime()))
    invalid()
  return value
}
function invalid(): never {
  throw new Error(
    'Invalid or unsupported Tab Session Manager snapshot. No snapshot was imported.',
  )
}
