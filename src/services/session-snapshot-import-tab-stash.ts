import {
  countSnapshotItems,
  validateSessionSnapshotPayload,
} from '@/services/session-snapshot-codec'
import { parseUsDateTime } from '@/services/session-snapshot-import-dates'
import type {
  ParsedSessionSnapshotImport,
  SessionSnapshotImportWarning,
  SnapshotNote,
  SnapshotTopLevelItem,
  SnapshotWindow,
} from '@/types/session-snapshots'
import { State, TreeItemType } from '@/types/session-tree'

// Tab Stash's Export dialog copies Markdown to the clipboard: loose links
// first, then one `## Folder` heading per stash folder followed by its
// `- [Title](URL)` links, with sub-folders as deeper headings. Titles escape
// `\ [ ] & < >` and URLs escape `\ )` with a backslash.
// https://github.com/josh-berry/tab-stash/blob/master/src/tasks/export/markdown.ts
const warningMessages = {
  'groups-as-windows':
    'Each stash folder was imported as a saved window. Sub-folders were imported as notes containing their tabs.',
  'dates-not-imported':
    'Some stash dates were not imported because their date format was not recognized.',
} satisfies Partial<Record<SessionSnapshotImportWarning['code'], string>>
type WarningCode = keyof typeof warningMessages

const headingPattern = /^(#+) (.*)$/
// Unnamed stashes are shown as "Saved <date>" with the browser's locale.
const defaultFolderName = /^Saved (.+)$/

type Line =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'link'; title: string; url: string }

function parseLines(text: string): Line[] | undefined {
  const lines: Line[] = []
  for (const raw of text.split(/\r\n|\r|\n/)) {
    // trim() also removes a leading byte order mark.
    const line = raw.trim()
    if (!line) continue
    const heading = headingPattern.exec(line)
    if (heading) {
      lines.push({
        kind: 'heading',
        level: heading[1].length,
        text: unescape(heading[2]).trim(),
      })
      continue
    }
    const link = parseLink(line)
    if (!link) return undefined
    lines.push({ kind: 'link', ...link })
  }
  return lines
}

export function isTabStashImport(text: string): boolean {
  const lines = parseLines(text)
  return !!lines && lines.some((line) => line.kind === 'link')
}

export function parseTabStashImport(text: string): ParsedSessionSnapshotImport {
  const items: SnapshotTopLevelItem[] = []
  const warnings = new Map<WarningCode, number>()
  const warn = (code: WarningCode) =>
    warnings.set(code, (warnings.get(code) ?? 0) + 1)
  let nextId = 0
  const uid = () => `tab-stash-${++nextId}` as UID

  let window: SnapshotWindow | undefined
  // Open sub-folders, outermost first, with their heading levels.
  let folders: { level: number; note: SnapshotNote }[] = []
  const startWindow = (name?: string) => {
    window = {
      type: TreeItemType.WINDOW,
      uid: uid(),
      state: State.SAVED,
      incognito: false,
      indentLevel: 0,
      collapsed: false,
      isParent: false,
      children: [],
    }
    folders = []
    const date = name && defaultFolderName.exec(name)?.[1]
    const savedTime = date ? parseUsDateTime(date, { exact: true }) : undefined
    if (savedTime !== undefined) window.savedTime = savedTime
    else if (name) {
      window.title = name
      if (date) warn('dates-not-imported')
    }
    items.push(window)
    warn('groups-as-windows')
    return window
  }

  for (const line of parseLines(text) ?? []) {
    if (line.kind === 'heading' && line.level <= 2) {
      startWindow(line.text)
      continue
    }
    const target = window ?? startWindow()
    while (
      line.kind === 'heading' &&
      folders.length &&
      folders[folders.length - 1].level >= line.level
    )
      folders.pop()
    const parent = folders[folders.length - 1]?.note
    const indentLevel = (parent?.indentLevel ?? target.indentLevel) + 1
    if (parent) parent.isParent = true
    target.isParent = true

    if (line.kind === 'heading') {
      const note: SnapshotNote = {
        type: TreeItemType.NOTE,
        uid: uid(),
        windowUid: target.uid,
        text: line.text,
        indentLevel,
        collapsed: false,
        isParent: false,
        ...(parent ? { parentUid: parent.uid } : {}),
      }
      target.children.push(note)
      folders.push({ level: line.level, note })
      continue
    }
    target.children.push({
      type: TreeItemType.TAB,
      uid: uid(),
      windowUid: target.uid,
      state: State.SAVED,
      url: line.url,
      title: line.title || line.url,
      pinned: false,
      indentLevel,
      collapsed: false,
      isParent: false,
      ...(target.savedTime !== undefined
        ? { savedTime: target.savedTime }
        : {}),
      ...(parent ? { parentUid: parent.uid } : {}),
    })
  }

  const payload = validateSessionSnapshotPayload({ schemaVersion: 1, items })
  return {
    payload,
    summary: {
      source: 'tab-stash',
      counts: countSnapshotItems(items),
      warnings: Array.from(warnings, ([code, count]) => ({
        code,
        count,
        message: warningMessages[code],
      })),
    },
  }
}

// Reads `- [Title](URL)`, honouring backslash escapes in both parts.
function parseLink(line: string): { title: string; url: string } | undefined {
  if (!line.startsWith('- [')) return undefined
  const read = (start: number, end: string) => {
    let value = ''
    for (let i = start; i < line.length; i++) {
      if (line[i] === '\\' && i + 1 < line.length) value += line[++i]
      else if (line[i] === end) return { value, next: i + 1 }
      else value += line[i]
    }
    return undefined
  }
  const title = read(3, ']')
  if (!title || line[title.next] !== '(') return undefined
  const url = read(title.next + 1, ')')
  if (
    !url ||
    url.next !== line.length ||
    !/^[a-z][a-z\d+.-]*:/i.test(url.value)
  )
    return undefined
  return { title: title.value.trim(), url: url.value }
}

function unescape(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, '$1')
}
