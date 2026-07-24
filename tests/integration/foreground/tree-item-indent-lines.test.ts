import TreeItemComponent from '@/components/TreeItem.vue'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { getTreeItemContextMenuArgs } from '@/services/context-menu-actions'
import { Settings } from '@/services/settings'
import { ContextMenuType } from '@/types/context-menu'
import { SelectionType, State, TreeItem } from '@/types/session-tree'
import {
  makeForegroundNote,
  makeForegroundSeparator,
  makeForegroundTab,
  makeForegroundWindow,
  resetForegroundTree,
} from '../../helpers/foreground-tree-fixtures'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function renderTreeItem(item: TreeItem): Promise<string> {
  ;(
    TreeItemComponent as unknown as { __cssModules?: Record<string, object> }
  ).__cssModules = {
    $style: {},
  }
  const app = createSSRApp(TreeItemComponent, {
    item,
    faviconService: {
      getFavicon: vi.fn(() => '/icon/16.png'),
    },
  })
  return renderToString(app)
}

function countClass(markup: string, className: string): number {
  return [...markup.matchAll(/\bclass="([^"]*)"/g)].filter((match) =>
    match[1].split(/\s+/).includes(className),
  ).length
}

function indentGuideColumns(markup: string): string[] {
  const [, indentMarkup] =
    markup.match(
      /<div class="tree-item-indent-lines"[^>]*>([\s\S]*?)<div class="tree-item-action"/,
    ) ?? []

  if (!indentMarkup) return []

  return [...indentMarkup.matchAll(/\bclass="([^"]*)"/g)].map((match) => {
    const classes = match[1].split(/\s+/)
    if (classes.includes('indent-line-vertical')) return 'vertical'
    if (classes.includes('indent-line-spacer')) return 'spacer'
    if (classes.includes('indent-line-connector')) return 'connector'
    if (classes.includes('indent-line-end')) return 'end'
    return 'unknown'
  })
}

describe('TreeItem indent guide rendering', () => {
  beforeEach(() => {
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetForegroundTree()
  })

  it('hides terminal ancestor vertical guide lines by default', async () => {
    const branch = makeForegroundTab('branch' as UID, {
      indentLevel: 1,
      isParent: true,
      state: State.SAVED,
    })
    const childBranch = makeForegroundTab('child-branch' as UID, {
      indentLevel: 2,
      isParent: true,
      parentUid: branch.uid,
      state: State.SAVED,
    })
    const terminalLeaf = makeForegroundTab('terminal-leaf' as UID, {
      indentLevel: 3,
      parentUid: childBranch.uid,
      state: State.SAVED,
    })
    const window = makeForegroundWindow('window-1' as UID, [
      branch,
      childBranch,
      terminalLeaf,
    ])
    resetForegroundTree([window])

    const markup = await renderTreeItem(terminalLeaf)

    expect(Settings.values.showIndentLinesWithoutChildren).toBe(false)
    expect(countClass(markup, 'indent-line-vertical')).toBe(0)
    expect(countClass(markup, 'indent-line-connector')).toBe(1)
    expect(countClass(markup, 'indent-line-end')).toBe(1)
  })

  it('renders a named Firefox group color indicator on grouped tabs', async () => {
    const tab = makeForegroundTab('grouped-tab' as UID, {
      tabGroup: {
        uid: 'group-uid' as UID,
        id: 7,
        title: 'Research',
        color: 'blue',
        collapsed: false,
      },
    })

    const markup = await renderTreeItem(tab)

    expect(markup).toContain('tree-item-tab-group-indicator-right')
    expect(markup).toContain('var(--tab-group-color-blue)')
    expect(markup).toContain('Title: grouped-tab')
    expect(markup).toContain('URL: https://example.test/grouped-tab')
    expect(markup).toContain('Tab group: Research')
  })

  it.each([
    'blue',
    'cyan',
    'grey',
    'green',
    'orange',
    'pink',
    'purple',
    'red',
    'yellow',
  ] as const)(
    'renders the Firefox %s group color on both indicator sides (TG-05)',
    async (color) => {
      const tab = makeForegroundTab(`grouped-${color}` as UID, {
        tabGroup: {
          uid: `group-${color}` as UID,
          id: 7,
          title: `${color} group`,
          color,
          collapsed: false,
        },
      })

      for (const position of ['left', 'right'] as const) {
        Settings.values.tabGroupColorIndicator = position
        const markup = await renderTreeItem(tab)

        expect(markup).toContain(`tree-item-tab-group-indicator-${position}`)
        expect(markup).toContain(`var(--tab-group-color-${color})`)
      }
    },
  )

  it.each(['', '   '])(
    'labels an unnamed Firefox group consistently for title %j (TG-04)',
    async (title) => {
      const tab = makeForegroundTab('unnamed-grouped-tab' as UID, {
        tabGroup: {
          uid: 'unnamed-group' as UID,
          id: 7,
          title,
          color: 'orange',
          collapsed: false,
        },
      })

      const markup = await renderTreeItem(tab)

      expect(markup).toContain('aria-label="Unnamed tab group"')
      expect(markup).toContain('Tab group: Unnamed tab group')
      expect(markup).toContain('var(--tab-group-color-orange)')
    },
  )

  it('escapes HTML-like group titles and renders long titles intact (TG-35)', async () => {
    const hostileTitle = '<img src=x onerror=alert(1)> & "quoted"'
    const hostileTab = makeForegroundTab('hostile-grouped-tab' as UID, {
      tabGroup: {
        uid: 'hostile-group' as UID,
        id: 7,
        title: hostileTitle,
        color: 'red',
        collapsed: false,
      },
    })
    const longTitle = 'Long group '.repeat(100)
    const longTab = makeForegroundTab('long-grouped-tab' as UID, {
      tabGroup: {
        uid: 'long-group' as UID,
        id: 8,
        title: longTitle,
        color: 'purple',
        collapsed: false,
      },
    })

    const hostileMarkup = await renderTreeItem(hostileTab)
    const longMarkup = await renderTreeItem(longTab)

    expect(hostileMarkup).not.toContain('<img src=x')
    expect(hostileMarkup).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(hostileMarkup).toContain('&amp;')
    expect(hostileMarkup).toContain('&quot;quoted&quot;')
    expect(longMarkup).toContain(longTitle.trim())
    expect(countClass(hostileMarkup, 'tree-item')).toBe(1)
    expect(countClass(longMarkup, 'tree-item')).toBe(1)
  })

  it('supports left and hidden group color indicators while retaining the group tooltip', async () => {
    const tab = makeForegroundTab('grouped-tab' as UID, {
      tabGroup: {
        uid: 'group-uid' as UID,
        id: -1,
        title: 'Saved research',
        color: 'purple',
        collapsed: true,
      },
    })
    Settings.values.tabGroupColorIndicator = 'left'

    const leftMarkup = await renderTreeItem(tab)

    expect(leftMarkup).toContain('tree-item-tab-group-indicator-left')
    Settings.values.tabGroupColorIndicator = 'hidden'

    const hiddenMarkup = await renderTreeItem(tab)

    expect(hiddenMarkup).not.toContain('tree-item-tab-group-indicator-left')
    expect(hiddenMarkup).toContain('Tab group: Saved research')
  })

  it('renders independently configurable container fades and icon positions', async () => {
    const tab = makeForegroundTab('work-tab' as UID, {
      container: {
        cookieStoreId: 'firefox-container-1',
        name: 'Work',
        color: 'blue',
        colorCode: '#37adff',
        icon: 'briefcase',
        iconUrl: 'resource://usercontext-content/briefcase.svg',
      },
      tabGroup: {
        uid: 'group-uid' as UID,
        id: 7,
        title: 'Research',
        color: 'purple',
        collapsed: false,
      },
    })

    const defaultMarkup = await renderTreeItem(tab)
    expect(defaultMarkup).toContain(
      'tree-item-container-indicator-soft-fade-right',
    )
    expect(defaultMarkup).toContain('tree-item-container-fade-title-after-icon')
    expect(defaultMarkup).toContain('--container-color:#37adff')
    expect(defaultMarkup).toContain('tree-item-container-icon-left')
    expect(defaultMarkup).toContain('/icons/usercontext.svg#briefcase')
    expect(defaultMarkup).toContain('color:#37adff')
    expect(defaultMarkup).toContain('Container: Work')

    Settings.values.containerColorIndicator = 'strong-fade'
    Settings.values.containerFadeSide = 'left'
    Settings.values.containerIconPosition = 'right'
    const strongLeftMarkup = await renderTreeItem(tab)
    expect(strongLeftMarkup).toContain(
      'tree-item-container-indicator-strong-fade-left',
    )
    expect(strongLeftMarkup).toContain('tree-item-container-icon-right')

    Settings.values.containerIconPosition = 'left'
    const leftIconFadeMarkup = await renderTreeItem(tab)
    expect(leftIconFadeMarkup).toContain(
      'tree-item-container-fade-start-after-icon',
    )

    Settings.values.containerColorIndicator = 'off'
    Settings.values.containerIconPosition = 'off'
    const hiddenMarkup = await renderTreeItem(tab)
    expect(hiddenMarkup).not.toContain('tree-item-container-indicator')
    expect(hiddenMarkup).not.toContain('tree-item-container-icon')
    expect(hiddenMarkup).toContain('Container: Work')
    expect(hiddenMarkup).toContain('tree-item-container-description')
  })

  it('uses exact Firefox icon fragments and falls back only for unknown icons', async () => {
    const knownIcon = makeForegroundTab('work-tab' as UID, {
      container: {
        cookieStoreId: 'firefox-container-1',
        name: 'Work',
        color: 'blue',
        colorCode: '#37adff',
        icon: 'briefcase',
        iconUrl: 'resource://usercontext-content/briefcase.svg',
      },
    })
    const unknownIcon = makeForegroundTab('future-tab' as UID, {
      container: {
        cookieStoreId: 'firefox-container-2',
        name: 'Future',
        color: 'green',
        colorCode: '#51cd00',
        icon: 'future-firefox-icon',
      },
    })

    const knownMarkup = await renderTreeItem(knownIcon)
    const unknownMarkup = await renderTreeItem(unknownIcon)

    expect(knownMarkup).toContain('/icons/usercontext.svg#briefcase')
    expect(knownMarkup).not.toContain('tree-item-container-icon-fallback')
    expect(unknownMarkup).toContain('tree-item-container-icon-fallback')
    expect(unknownMarkup).not.toContain(
      '/icons/usercontext.svg#future-firefox-icon',
    )
    expect(unknownMarkup).toContain('Container: Future')
  })

  it('uses the same right fade endpoint with and without a group marker', async () => {
    const groupedTab = makeForegroundTab('grouped-container-tab' as UID, {
      container: {
        cookieStoreId: 'firefox-container-1',
        name: 'Work',
        color: 'blue',
        colorCode: '#37adff',
        icon: 'briefcase',
      },
      tabGroup: {
        uid: 'group-uid' as UID,
        id: 7,
        title: 'Research',
        color: 'purple',
        collapsed: false,
      },
    })
    const ungroupedTab = makeForegroundTab('ungrouped-container-tab' as UID, {
      container: groupedTab.container,
    })

    const groupedMarkup = await renderTreeItem(groupedTab)
    const ungroupedMarkup = await renderTreeItem(ungroupedTab)

    expect(groupedMarkup).toContain('tree-item-container-fade-end-inset')
    expect(ungroupedMarkup).toContain('tree-item-container-fade-end-inset')
  })

  it('keeps container fades inset from interaction lines and behind tab content', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL('../../../src/components/TreeItem.vue', import.meta.url),
        'utf8',
      ),
    )

    expect(source).toMatch(
      /\.tree-item-container-indicator\s*\{[^}]*z-index:\s*0;/s,
    )
    expect(source).not.toMatch(/\.tree-item-overlay\s*\{[^}]*z-index:/s)
    expect(source).toMatch(/\.tree-item-container-icon[^}]*z-index:\s*2;/s)
    expect(source).toMatch(
      /\.tree-item-tab-content\s*>\s*\.tree-item-title[^}]*z-index:\s*2;/s,
    )

    const rightFadeBounds = source.match(
      /\.tree-item-container-indicator-soft-fade-right,\s*\.tree-item-container-indicator-strong-fade-right\s*\{([^}]*)\}/s,
    )?.[1]
    const leftFadeBounds = source.match(
      /\.tree-item-container-indicator-soft-fade-left,\s*\.tree-item-container-indicator-strong-fade-left\s*\{([^}]*)\}/s,
    )?.[1]
    expect(rightFadeBounds).toContain('bottom: 2px;')
    expect(rightFadeBounds).toContain('left: var(--tree-item-title-start);')
    expect(rightFadeBounds).toContain('top: 2px;')
    expect(leftFadeBounds).toContain('bottom: 2px;')
    expect(leftFadeBounds).toContain('top: 2px;')
    expect(source).toMatch(
      /--tree-item-title-start:\s*calc\(\s*64px\s*\+\s*\(var\(--prepend-width, 16px\)\s*\*\s*var\(--indent-level, 0\)\)\s*\);/s,
    )
    expect(source).toMatch(
      /\.tree-item-container-fade-title-after-icon\s*\{[^}]*left:\s*calc\(var\(--tree-item-title-start\) \+ 18px\);/s,
    )
    expect(source).toMatch(
      /\.tree-item-container-indicator-soft-fade-right\s*\{[^}]*transparent 48%,/s,
    )
    expect(source).toMatch(
      /\.tree-item-container-indicator-strong-fade-right\s*\{[^}]*transparent 48%,/s,
    )
  })

  it('binds the script-side handler and maps each context-menu item type', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL('../../../src/components/TreeItem.vue', import.meta.url),
        'utf8',
      ),
    )

    expect(source).toContain('@contextmenu.stop="openItemContextMenu"')
    expect(source).toMatch(
      /ContextMenu\.handleContextMenuClick\(\s*\.\.\.getTreeItemContextMenuArgs\(props\.item, event\),\s*\)/s,
    )

    const event = {} as MouseEvent
    const items = [
      {
        item: makeForegroundWindow('window-menu' as UID),
        menuType: ContextMenuType.Window,
        selectionType: SelectionType.WINDOW,
        argumentIndex: 2,
      },
      {
        item: makeForegroundTab('tab-menu' as UID),
        menuType: ContextMenuType.Tab,
        selectionType: SelectionType.TAB,
        argumentIndex: 3,
      },
      {
        item: makeForegroundNote('note-menu' as UID),
        menuType: ContextMenuType.Note,
        selectionType: SelectionType.NOTE,
        argumentIndex: 4,
      },
      {
        item: makeForegroundSeparator('separator-menu' as UID),
        menuType: ContextMenuType.Separator,
        selectionType: SelectionType.SEPARATOR,
        argumentIndex: 5,
      },
    ]
    for (const { item, menuType, selectionType, argumentIndex } of items) {
      const args = getTreeItemContextMenuArgs(item, event)
      expect(args[0]).toBe(menuType)
      expect(args[1]).toBe(event)
      expect(args.slice(2, 6).filter(Boolean)).toEqual([item])
      expect(args[argumentIndex]).toBe(item)
      expect(args[6]).toBe(selectionType)
    }
  })

  it('does not render container presentation for ordinary tabs', async () => {
    const markup = await renderTreeItem(
      makeForegroundTab('ordinary-tab' as UID),
    )

    expect(markup).not.toContain('tree-item-container-indicator')
    expect(markup).not.toContain('tree-item-container-icon')
    expect(markup).not.toContain('Container:')
  })

  it('configures which tab details are included in the hover text', async () => {
    const tab = makeForegroundTab('hovered-tab' as UID)
    Settings.values.showTabUrlOnHover = false
    Settings.values.tabGroupInfoOnHover = 'never'

    const titleOnlyMarkup = await renderTreeItem(tab)

    expect(titleOnlyMarkup).toContain('Title: hovered-tab')
    expect(titleOnlyMarkup).not.toContain('URL:')
    expect(titleOnlyMarkup).not.toContain('Tab group:')

    Settings.values.showTabTitleOnHover = false
    const hiddenMarkup = await renderTreeItem(tab)

    expect(hiddenMarkup).not.toContain('title=')
  })

  it('hides group hover information only for ungrouped tabs when configured', async () => {
    Settings.values.showTabTitleOnHover = false
    Settings.values.showTabUrlOnHover = false
    Settings.values.tabGroupInfoOnHover = 'grouped-only'
    const ungrouped = makeForegroundTab('ungrouped' as UID)
    const grouped = makeForegroundTab('grouped' as UID, {
      tabGroup: {
        uid: 'group-uid' as UID,
        id: 7,
        title: 'Research',
        color: 'blue',
        collapsed: false,
      },
    })

    const ungroupedMarkup = await renderTreeItem(ungrouped)
    const groupedMarkup = await renderTreeItem(grouped)

    expect(ungroupedMarkup).not.toContain('Tab group: None')
    expect(groupedMarkup).toContain('Tab group: Research')
  })

  it('uses a terminal connector when no later direct sibling exists', async () => {
    const first = makeForegroundTab('first' as UID, {
      indentLevel: 1,
      parentUid: undefined,
      state: State.SAVED,
    })
    const last = makeForegroundTab('last' as UID, {
      indentLevel: 1,
      parentUid: undefined,
      state: State.SAVED,
    })
    const window = makeForegroundWindow('window-1' as UID, [first, last])
    resetForegroundTree([window])

    const markup = await renderTreeItem(last)

    expect(countClass(markup, 'indent-line-connector')).toBe(1)
    expect(countClass(markup, 'indent-line-connector-terminal')).toBe(1)
  })

  it('uses a continuing connector when a later direct sibling exists', async () => {
    const first = makeForegroundTab('first' as UID, {
      indentLevel: 1,
      parentUid: undefined,
      state: State.SAVED,
    })
    const second = makeForegroundTab('second' as UID, {
      indentLevel: 1,
      parentUid: undefined,
      state: State.SAVED,
    })
    const window = makeForegroundWindow('window-1' as UID, [first, second])
    resetForegroundTree([window])

    const markup = await renderTreeItem(first)

    expect(countClass(markup, 'indent-line-connector')).toBe(1)
    expect(countClass(markup, 'indent-line-connector-terminal')).toBe(0)
  })

  it('does not draw an ancestor guide for direct child siblings under the same parent', async () => {
    const root = makeForegroundTab('root' as UID, {
      indentLevel: 1,
      isParent: true,
      state: State.SAVED,
    })
    const firstChild = makeForegroundTab('first-child' as UID, {
      indentLevel: 2,
      parentUid: root.uid,
      state: State.SAVED,
    })
    const secondChild = makeForegroundTab('second-child' as UID, {
      indentLevel: 2,
      parentUid: root.uid,
      state: State.SAVED,
    })
    const window = makeForegroundWindow('window-1' as UID, [
      root,
      firstChild,
      secondChild,
    ])
    resetForegroundTree([window])

    const firstMarkup = await renderTreeItem(firstChild)
    const secondMarkup = await renderTreeItem(secondChild)

    expect(Settings.values.showIndentLinesWithoutChildren).toBe(false)
    expect(countClass(firstMarkup, 'indent-line-vertical')).toBe(0)
    expect(countClass(secondMarkup, 'indent-line-vertical')).toBe(0)
    expect(countClass(firstMarkup, 'indent-line-connector-terminal')).toBe(0)
    expect(countClass(secondMarkup, 'indent-line-connector-terminal')).toBe(1)
  })

  it('does not render a root ancestor vertical guide for direct child continuations', async () => {
    const root = makeForegroundTab('root' as UID, {
      indentLevel: 1,
      isParent: true,
      state: State.SAVED,
    })
    const childA = makeForegroundTab('child-a' as UID, {
      indentLevel: 2,
      parentUid: root.uid,
      state: State.SAVED,
    })
    const childB = makeForegroundTab('child-b' as UID, {
      indentLevel: 2,
      parentUid: root.uid,
      state: State.SAVED,
    })
    const window = makeForegroundWindow('window-1' as UID, [
      root,
      childA,
      childB,
    ])
    resetForegroundTree([window])

    const childAMarkup = await renderTreeItem(childA)
    const childBMarkup = await renderTreeItem(childB)

    expect(Settings.values.showIndentLinesWithoutChildren).toBe(false)
    expect(countClass(childAMarkup, 'indent-line-vertical')).toBe(0)
    expect(countClass(childBMarkup, 'indent-line-vertical')).toBe(0)
    expect(countClass(childAMarkup, 'indent-line-connector')).toBe(1)
    expect(countClass(childBMarkup, 'indent-line-connector')).toBe(1)
    expect(countClass(childAMarkup, 'indent-line-connector-terminal')).toBe(0)
    expect(countClass(childBMarkup, 'indent-line-connector-terminal')).toBe(1)
  })

  it('hides guide lines for intermediate parents with only one child chain', async () => {
    const root = makeForegroundTab('root' as UID, {
      indentLevel: 1,
      isParent: true,
      state: State.SAVED,
    })
    const onlyChildParent = makeForegroundTab('only-child-parent' as UID, {
      indentLevel: 2,
      isParent: true,
      parentUid: root.uid,
      state: State.SAVED,
    })
    const onlyGrandchild = makeForegroundTab('only-grandchild' as UID, {
      indentLevel: 3,
      parentUid: onlyChildParent.uid,
      state: State.SAVED,
    })
    const window = makeForegroundWindow('window-1' as UID, [
      root,
      onlyChildParent,
      onlyGrandchild,
    ])
    resetForegroundTree([window])

    const markup = await renderTreeItem(onlyChildParent)

    expect(Settings.values.showIndentLinesWithoutChildren).toBe(false)
    expect(countClass(markup, 'indent-line-vertical')).toBe(0)
  })

  it('keeps guide lines from a single-child chain to a later root sibling', async () => {
    const root = makeForegroundTab('root' as UID, {
      indentLevel: 1,
      isParent: true,
      state: State.SAVED,
    })
    const onlyChildParent = makeForegroundTab('only-child-parent' as UID, {
      indentLevel: 2,
      isParent: true,
      parentUid: root.uid,
      state: State.SAVED,
    })
    const onlyGrandchild = makeForegroundTab('only-grandchild' as UID, {
      indentLevel: 3,
      parentUid: onlyChildParent.uid,
      state: State.SAVED,
    })
    const laterRoot = makeForegroundTab('later-root' as UID, {
      indentLevel: 1,
      state: State.SAVED,
    })
    const window = makeForegroundWindow('window-1' as UID, [
      root,
      onlyChildParent,
      onlyGrandchild,
      laterRoot,
    ])
    resetForegroundTree([window])

    const parentMarkup = await renderTreeItem(onlyChildParent)
    const grandchildMarkup = await renderTreeItem(onlyGrandchild)

    expect(Settings.values.showIndentLinesWithoutChildren).toBe(false)
    expect(countClass(parentMarkup, 'indent-line-vertical')).toBe(1)
    expect(countClass(grandchildMarkup, 'indent-line-vertical')).toBe(1)
  })

  it('keeps branch guide lines through A to B to C until later root tab D', async () => {
    const tabA = makeForegroundTab('tab-a' as UID, {
      indentLevel: 1,
      isParent: true,
      state: State.SAVED,
    })
    const tabB = makeForegroundTab('tab-b' as UID, {
      indentLevel: 2,
      isParent: true,
      parentUid: tabA.uid,
      state: State.SAVED,
    })
    const tabC = makeForegroundTab('tab-c' as UID, {
      indentLevel: 3,
      parentUid: tabB.uid,
      state: State.SAVED,
    })
    const tabD = makeForegroundTab('tab-d' as UID, {
      indentLevel: 1,
      state: State.SAVED,
    })
    const window = makeForegroundWindow('window-1' as UID, [
      tabA,
      tabB,
      tabC,
      tabD,
    ])
    resetForegroundTree([window])

    const tabBMarkup = await renderTreeItem(tabB)
    const tabCMarkup = await renderTreeItem(tabC)

    expect(Settings.values.showIndentLinesWithoutChildren).toBe(false)
    expect(countClass(tabBMarkup, 'indent-line-vertical')).toBe(1)
    expect(countClass(tabCMarkup, 'indent-line-vertical')).toBe(1)
    expect(countClass(tabCMarkup, 'indent-line-spacer')).toBe(1)
  })

  it('only shows the guide level that has a later sibling before a lower indent', async () => {
    const tabA = makeForegroundTab('tab-a' as UID, {
      indentLevel: 1,
      isParent: true,
      state: State.SAVED,
    })
    const tabB = makeForegroundTab('tab-b' as UID, {
      indentLevel: 2,
      isParent: true,
      parentUid: tabA.uid,
      state: State.SAVED,
    })
    const tabC = makeForegroundTab('tab-c' as UID, {
      indentLevel: 3,
      isParent: true,
      parentUid: tabB.uid,
      state: State.SAVED,
    })
    const tabE = makeForegroundTab('tab-e' as UID, {
      indentLevel: 4,
      parentUid: tabC.uid,
      state: State.SAVED,
    })
    const tabD = makeForegroundTab('tab-d' as UID, {
      indentLevel: 3,
      parentUid: tabB.uid,
      state: State.SAVED,
    })
    const window = makeForegroundWindow('window-1' as UID, [
      tabA,
      tabB,
      tabC,
      tabE,
      tabD,
    ])
    resetForegroundTree([window])

    const tabEMarkup = await renderTreeItem(tabE)

    expect(Settings.values.showIndentLinesWithoutChildren).toBe(false)
    expect(countClass(tabEMarkup, 'indent-line-spacer')).toBe(2)
    expect(countClass(tabEMarkup, 'indent-line-vertical')).toBe(1)
  })

  it('keeps ancestor vertical guide lines with continuing visible siblings', async () => {
    const branch = makeForegroundTab('branch' as UID, {
      indentLevel: 1,
      isParent: true,
      state: State.SAVED,
    })
    const childBranch = makeForegroundTab('child-branch' as UID, {
      indentLevel: 2,
      isParent: true,
      parentUid: branch.uid,
      state: State.SAVED,
    })
    const leafBeforeSibling = makeForegroundTab('leaf-before-sibling' as UID, {
      indentLevel: 3,
      parentUid: childBranch.uid,
      state: State.SAVED,
    })
    const continuingSibling = makeForegroundTab('continuing-sibling' as UID, {
      indentLevel: 2,
      parentUid: branch.uid,
      state: State.SAVED,
    })
    const window = makeForegroundWindow('window-1' as UID, [
      branch,
      childBranch,
      leafBeforeSibling,
      continuingSibling,
    ])
    resetForegroundTree([window])

    const markup = await renderTreeItem(leafBeforeSibling)

    expect(Settings.values.showIndentLinesWithoutChildren).toBe(false)
    expect(countClass(markup, 'indent-line-vertical')).toBe(1)
  })

  it('continues a nested window guide through its tabs to a later sibling', async () => {
    const parentNote = makeForegroundNote('parent-note' as UID, {
      indentLevel: 0,
      isParent: true,
      windowUid: undefined,
    })
    const tab = makeForegroundTab('window-tab' as UID, {
      indentLevel: 2,
      state: State.SAVED,
    })
    const nestedWindow = makeForegroundWindow('nested-window' as UID, [tab], {
      indentLevel: 1,
      parentUid: parentNote.uid,
    })
    const windowSibling = makeForegroundNote('window-sibling' as UID, {
      indentLevel: 1,
      parentUid: parentNote.uid,
      windowUid: undefined,
    })
    resetForegroundTree([parentNote, nestedWindow, windowSibling])

    const markup = await renderTreeItem(tab)

    expect(indentGuideColumns(markup)).toEqual(['vertical', 'connector', 'end'])
  })

  it('keeps only the direct parent guide line when a later parent sibling continues the branch', async () => {
    const tabA = makeForegroundTab('tab-a' as UID, {
      indentLevel: 1,
      isParent: true,
      state: State.SAVED,
    })
    const tabB = makeForegroundTab('tab-b' as UID, {
      indentLevel: 2,
      isParent: true,
      parentUid: tabA.uid,
      state: State.SAVED,
    })
    const tabC = makeForegroundTab('tab-c' as UID, {
      indentLevel: 3,
      isParent: true,
      parentUid: tabB.uid,
      state: State.SAVED,
    })
    const tabE = makeForegroundTab('tab-e' as UID, {
      indentLevel: 4,
      parentUid: tabC.uid,
      state: State.SAVED,
    })
    const tabD = makeForegroundTab('tab-d' as UID, {
      indentLevel: 3,
      parentUid: tabB.uid,
      state: State.SAVED,
    })
    const window = makeForegroundWindow('window-1' as UID, [
      tabA,
      tabB,
      tabC,
      tabE,
      tabD,
    ])
    resetForegroundTree([window])

    const markup = await renderTreeItem(tabE)

    expect(Settings.values.showIndentLinesWithoutChildren).toBe(false)
    expect(indentGuideColumns(markup)).toEqual([
      'spacer',
      'spacer',
      'vertical',
      'connector',
      'end',
    ])
    expect(countClass(markup, 'indent-line-connector')).toBe(1)
    expect(countClass(markup, 'indent-line-end')).toBe(1)
  })

  it('renders all ancestor vertical guide lines when enabled', async () => {
    Settings.values.showIndentLinesWithoutChildren = true
    const branch = makeForegroundTab('branch' as UID, {
      indentLevel: 1,
      isParent: true,
      state: State.SAVED,
    })
    const childBranch = makeForegroundTab('child-branch' as UID, {
      indentLevel: 2,
      isParent: true,
      parentUid: branch.uid,
      state: State.SAVED,
    })
    const terminalLeaf = makeForegroundTab('terminal-leaf' as UID, {
      indentLevel: 3,
      parentUid: childBranch.uid,
      state: State.SAVED,
    })
    const window = makeForegroundWindow('window-1' as UID, [
      branch,
      childBranch,
      terminalLeaf,
    ])
    resetForegroundTree([window])

    const markup = await renderTreeItem(terminalLeaf)

    expect(countClass(markup, 'indent-line-vertical')).toBe(2)
  })

  it('keeps the full connector when terminal line trimming is disabled by setting', async () => {
    Settings.values.showIndentLinesWithoutChildren = true
    const first = makeForegroundTab('first' as UID, {
      indentLevel: 1,
      parentUid: undefined,
      state: State.SAVED,
    })
    const last = makeForegroundTab('last' as UID, {
      indentLevel: 1,
      parentUid: undefined,
      state: State.SAVED,
    })
    const window = makeForegroundWindow('window-1' as UID, [first, last])
    resetForegroundTree([window])

    const markup = await renderTreeItem(last)

    expect(countClass(markup, 'indent-line-connector')).toBe(1)
    expect(countClass(markup, 'indent-line-connector-terminal')).toBe(0)
  })
})
