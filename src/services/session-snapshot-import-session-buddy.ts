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
} from '@/types/session-snapshots'
import { State, TreeItemType } from '@/types/session-tree'

// Session Buddy's documented JSON forms use aliases for collections, folders,
// and links in older exports: https://sessionbuddy.com/formats/
const levels = [
  ['collections', 'sessions'],
  ['folders', 'windows'],
  ['links', 'tabs'],
] as const

const warningMessages = {
  'collections-as-notes':
    'Collections were preserved as note branches containing saved windows.',
  'history-not-imported':
    'Session Buddy history was not imported. Only saved collections are supported.',
  'tab-group-metadata':
    'Tab grouping was preserved with default colors because group names and colors are not included.',
  'window-presentation':
    'Browser window types and display states were converted to ordinary saved windows.',
  'unsupported-appearance':
    'External favicon images were not imported. Available Session Flow icons will be used.',
  'browser-specific-urls':
    'Chrome-specific URLs were preserved but may not open in Firefox.',
} satisfies Partial<Record<SessionSnapshotImportWarning['code'], string>>

export function isSessionBuddyImport(value: unknown): boolean {
  if (isRecord(value)) return levels.flat().some((key) => key in value)
  if (!Array.isArray(value) || value.length === 0) return false
  const first = value[0]
  // Native Session Flow trees use numeric types and must keep their own parser.
  return (
    isRecord(first) &&
    typeof first.type !== 'number' &&
    (levels
      .slice(1)
      .flat()
      .some((key) => key in first) ||
      'url' in first)
  )
}

export function parseSessionBuddyImport(
  value: unknown,
): ParsedSessionSnapshotImport {
  const items: SnapshotTopLevelItem[] = []
  const warnings = new Map<keyof typeof warningMessages, number>()
  const warn = (code: keyof typeof warningMessages, count = 1) =>
    warnings.set(code, (warnings.get(code) ?? 0) + count)
  let nextId = 0
  const uid = () => `session-buddy-${++nextId}` as UID

  const root = isRecord(value) ? value : undefined
  if (root) {
    // Backups include history in addition to collections; never silently discard it.
    for (const key of ['events', 'history']) {
      if (root[key] !== undefined) {
        if (!Array.isArray(root[key])) invalid()
        if (root[key].length) warn('history-not-imported', root[key].length)
      }
    }
  }

  function convertWindow(
    value: unknown,
    parent?: SnapshotNote,
    savedTime?: number,
  ): void {
    const folder = record(value)
    const links = arrayField(folder, levels[2])
    optionalBoolean(folder, 'incognito')
    const position = ['left', 'top', 'width', 'height'].map((key) =>
      optionalNumber(folder, key),
    )
    const window: SnapshotWindow = {
      type: TreeItemType.WINDOW,
      uid: uid(),
      state: State.SAVED,
      incognito: folder.incognito === true,
      title: name(folder),
      children: [],
      indentLevel: parent ? 1 : 0,
      isParent: links.length > 0,
      collapsed: false,
      ...(parent ? { parentUid: parent.uid } : {}),
      ...(savedTime !== undefined ? { savedTime } : {}),
    }
    if (position.every((value) => value !== undefined)) {
      window.windowPosition = {
        left: position[0]!,
        top: position[1]!,
        width: position[2]!,
        height: position[3]!,
      }
    }
    if (
      (folder.type !== undefined && folder.type !== 'normal') ||
      (folder.state !== undefined && folder.state !== 'normal') ||
      (position.some((value) => value !== undefined) && !window.windowPosition)
    )
      warn('window-presentation')
    const groupIds = new Set<number>()
    for (const value of links) {
      const link = record(value)
      if (typeof link.url !== 'string') invalid()
      const title = optionalString(link, 'title')
      const originalTitle = optionalString(link, 'titleOriginal')
      optionalBoolean(link, 'pinned')
      optionalBoolean(link, 'active')
      const groupId = optionalNumber(link, 'groupId')
      if (
        groupId !== undefined &&
        (!Number.isSafeInteger(groupId) || groupId < -1)
      )
        invalid()
      const tab: SnapshotTab = {
        type: TreeItemType.TAB,
        uid: uid(),
        windowUid: window.uid,
        state: State.SAVED,
        url: link.url,
        title: originalTitle ?? title ?? link.url,
        pinned: link.pinned === true,
        indentLevel: window.indentLevel + 1,
        ...(originalTitle !== undefined &&
        title !== undefined &&
        title !== originalTitle
          ? { customLabel: title }
          : {}),
        ...(savedTime !== undefined ? { savedTime } : {}),
      }
      if (groupId !== undefined && groupId >= 0) {
        tab.tabGroup = {
          uid: `${window.uid}-group-${groupId}` as UID,
          color: 'grey',
          collapsed: false,
        }
        groupIds.add(groupId)
      }
      if (link.active === true) window.savedActiveTabUid = tab.uid
      if (typeof link.favIconUrl === 'string' && link.favIconUrl)
        warn('unsupported-appearance')
      if (
        /^(chrome(?:-extension|-search|-untrusted)?|devtools):/i.test(link.url)
      )
        warn('browser-specific-urls')
      window.children.push(tab)
    }
    if (groupIds.size) warn('tab-group-metadata', groupIds.size)
    items.push(window)
  }

  let level: number
  let entries: unknown[]
  if (Array.isArray(value)) {
    if (!value.length) invalid()
    const first = record(value[0])
    level = levels[1].some((key) => key in first)
      ? 0
      : levels[2].some((key) => key in first)
        ? 1
        : 2
    entries = value
  } else {
    const container = record(value)
    const matchingLevels = levels
      .map((keys, index) => (keys.some((key) => key in container) ? index : -1))
      .filter((index) => index >= 0)
    if (matchingLevels.length !== 1) invalid()
    level = matchingLevels[0]
    entries = arrayField(container, levels[level])
  }

  let sourceCreatedAt: number | undefined
  if (level === 0) {
    for (const [index, value] of entries.entries()) {
      const collection = record(value)
      const folders = arrayField(collection, levels[1])
      const created = timestamp(collection, 'created')
      const updated = timestamp(collection, 'updated')
      const savedTime = updated ?? created
      if (entries.length === 1) sourceCreatedAt = savedTime
      const note: SnapshotNote = {
        type: TreeItemType.NOTE,
        uid: uid(),
        text: name(collection) || `Collection ${index + 1}`,
        indentLevel: 0,
        isParent: folders.length > 0,
        collapsed: false,
      }
      items.push(note)
      warn('collections-as-notes')
      for (const folder of folders) convertWindow(folder, note, savedTime)
    }
  } else if (level === 1) {
    for (const folder of entries) convertWindow(folder)
  } else {
    convertWindow({ title: 'Imported tabs', links: entries })
  }
  if (items.length === 0 && warnings.has('history-not-imported')) {
    throw new Error(
      'This Session Buddy backup contains only history. Export saved collections to import them.',
    )
  }
  const payload = validateSessionSnapshotPayload({ schemaVersion: 1, items })
  return {
    payload,
    summary: {
      source: 'session-buddy',
      ...(sourceCreatedAt !== undefined ? { sourceCreatedAt } : {}),
      counts: countSnapshotItems(payload.items),
      warnings: Array.from(warnings, ([code, count]) => ({
        code,
        count,
        message: warningMessages[code],
      })),
    },
  }
}

function arrayField(
  value: Record<string, unknown>,
  keys: readonly string[],
): unknown[] {
  const present = keys.filter((key) => key in value)
  if (present.length !== 1 || !Array.isArray(value[present[0]])) invalid()
  return value[present[0]] as unknown[]
}

function name(value: Record<string, unknown>): string | undefined {
  const title = optionalString(value, 'title')
  return optionalString(value, 'name') ?? title
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

function timestamp(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  const field = optionalNumber(value, key)
  if (field !== undefined && !Number.isFinite(new Date(field).getTime()))
    invalid()
  return field
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) invalid()
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(): never {
  throw new Error(
    'Invalid or unsupported Session Buddy snapshot. No snapshot was imported.',
  )
}
