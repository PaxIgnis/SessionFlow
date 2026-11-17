import { i18n } from '@/services/i18n'
import {
  countSnapshotItems,
  validateSessionSnapshotPayload,
} from '@/services/session-snapshot-codec'
import { parseUsDateTime } from '@/services/session-snapshot-import-dates'
import {
  find,
  findAll,
  hasClass,
  parseHtml,
  textOf,
  type HtmlElement,
} from '@/services/session-snapshot-import-html'
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
      // The label ("Created ...") is localized; the date is found within it.
      const savedTime = parseUsDateTime(created)
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
