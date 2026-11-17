import { i18n } from '@/services/i18n'
import {
  countSnapshotItems,
  validateSessionSnapshotPayload,
} from '@/services/session-snapshot-codec'
import type {
  ParsedSessionSnapshotImport,
  SessionSnapshotImportWarning,
  SnapshotTopLevelItem,
  SnapshotWindow,
} from '@/types/session-snapshots'
import { State, TreeItemType } from '@/types/session-tree'

// OneTab's "Export / Import URLs" page is plain text: one `URL | Title` line
// per tab, with a blank line between tab groups. Group names, dates, and
// locked or starred flags are not part of the export.
const warningMessages = {
  'groups-as-windows':
    'Each OneTab group was imported as a saved window. Group names, dates, and locked or starred status are not part of the OneTab export.',
  'browser-specific-urls':
    'Chrome-specific URLs were preserved but may not open in Firefox.',
} satisfies Partial<Record<SessionSnapshotImportWarning['code'], string>>
type WarningCode = keyof typeof warningMessages

// A URL never contains a raw space, so the first ` |` ends it; the rest of the
// line, including any further ` | `, is the title.
const linePattern = /^([a-z][a-z\d+.-]*:\S*?)(?: \|(?: (.*))?)?$/i

// trim() also removes a leading byte order mark.
function lines(text: string): string[] {
  return text.split(/\r\n|\r|\n/).map((line) => line.trim())
}

export function isOneTabImport(text: string): boolean {
  const tabLines = lines(text).filter(Boolean)
  return tabLines.length > 0 && tabLines.every((line) => linePattern.test(line))
}

export function parseOneTabImport(text: string): ParsedSessionSnapshotImport {
  const items: SnapshotTopLevelItem[] = []
  const warnings = new Map<WarningCode, number>()
  const warn = (code: WarningCode) =>
    warnings.set(code, (warnings.get(code) ?? 0) + 1)
  let nextId = 0
  const uid = () => `onetab-${++nextId}` as UID
  let window: SnapshotWindow | undefined

  for (const line of lines(text)) {
    if (!line) {
      window = undefined
      continue
    }
    const match = linePattern.exec(line)
    if (!match) throw new Error(i18n.t('invalidSnapshotFile'))
    if (!window) {
      window = {
        type: TreeItemType.WINDOW,
        uid: uid(),
        state: State.SAVED,
        incognito: false,
        indentLevel: 0,
        collapsed: false,
        isParent: true,
        children: [],
      }
      items.push(window)
      warn('groups-as-windows')
    }
    const [, url, title] = match
    window.children.push({
      type: TreeItemType.TAB,
      uid: uid(),
      windowUid: window.uid,
      state: State.SAVED,
      url,
      title: title?.trim() || url,
      pinned: false,
      indentLevel: 1,
      collapsed: false,
      isParent: false,
    })
    if (/^(chrome(?:-extension|-search|-untrusted)?|devtools):/i.test(url))
      warn('browser-specific-urls')
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
