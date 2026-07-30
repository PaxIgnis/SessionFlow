import TreeItemComponent from '@/components/TreeItem.vue'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Settings } from '@/services/settings'
import { State, TreeItem } from '@/types/session-tree'
import {
  makeForegroundNote,
  makeForegroundTab,
  makeForegroundWindow,
  resetForegroundTree,
} from '../../helpers/foreground-tree-fixtures'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'

async function renderTreeItem(
  item: TreeItem,
  getFavicon: (url: string, privateTab?: boolean) => string = vi.fn(
    () => '/icon/16.png',
  ),
): Promise<string> {
  ;(
    TreeItemComponent as unknown as { __cssModules?: Record<string, object> }
  ).__cssModules = { $style: {} }
  return renderToString(
    createSSRApp(TreeItemComponent, {
      item,
      faviconService: {
        getFavicon,
      },
    }),
  )
}

describe('tree item presentation', () => {
  beforeEach(() => {
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })

  afterEach(() => {
    resetForegroundTree()
    vi.restoreAllMocks()
  })

  it('renders combined active, discarded, pinned, collapsed, labelled, and grouped state', async () => {
    const tab = makeForegroundTab('combined-tab' as UID, {
      active: true,
      state: State.DISCARDED,
      pinned: true,
      collapsed: true,
      isParent: true,
      customLabel: 'Project α',
      tabGroup: {
        uid: 'group-1' as UID,
        id: 7,
        title: 'Research',
        color: 'blue',
        collapsed: false,
      },
    })
    const window = makeForegroundWindow('active-window' as UID, [tab], {
      active: true,
      state: State.OPEN,
    })
    resetForegroundTree([window])

    const markup = await renderTreeItem(tab)

    expect(markup).toContain('tree-item-active')
    expect(markup).toContain('tabindex="-1"')
    expect(markup).toContain('tree-item-active-latest-tab')
    expect(markup).toContain('tree-item-text-discarded')
    expect(markup).toContain('tree-item-text-active')
    expect(markup).toContain('tree-item-pinned')
    expect(markup).toContain('child-count')
    expect(markup).toContain('tree-item-custom-label')
    expect(markup).toContain('Project α')
    expect(markup).toContain('tree-item-tab-group-indicator-right')
    expect(markup).toContain('src="/icon/16.png"')
  })

  it('keeps a long note on one ellipsized tree row', async () => {
    const markup = await renderTreeItem(
      makeForegroundNote('note-1' as UID, {
        text: 'First line\nSecond line ' + 'long '.repeat(80),
      }),
    )
    const source = await fs.readFile(
      new URL('../../../src/components/TreeItem.vue', import.meta.url),
      'utf8',
    )

    expect(markup).toContain('tree-item-note-text')
    expect(source).toMatch(
      /\.tree-item-title\s*\{[\s\S]*?white-space:\s*nowrap/,
    )
    expect(source).toMatch(
      /\.tree-item-title\s*\{[\s\S]*?text-overflow:\s*ellipsis/,
    )
  })

  it('identifies private tabs when resolving their favicon', async () => {
    const getFavicon = vi.fn((_url: string, privateTab?: boolean) =>
      privateTab ? '/assets/private-browsing.svg' : '/icon/16.png',
    )
    const tab = makeForegroundTab('private-tab' as UID)
    const window = makeForegroundWindow('private-window' as UID, [tab], {
      incognito: true,
    })
    resetForegroundTree([window])

    const markup = await renderTreeItem(tab, getFavicon)

    expect(getFavicon).toHaveBeenCalledWith(tab.url, true)
    expect(markup).toContain('private-browsing.svg')
  })

  it('uses the private-browsing icon only for private window items', async () => {
    const privateMarkup = await renderTreeItem(
      makeForegroundWindow('private-window' as UID, [], {
        incognito: true,
      }),
    )
    const normalMarkup = await renderTreeItem(
      makeForegroundWindow('normal-window' as UID),
    )

    expect(privateMarkup).toContain('src="/icons/private-browsing.svg"')
    expect(normalMarkup).toContain('src="/icon/16.png"')
    expect(normalMarkup).not.toContain('private-browsing.svg')
  })

  it('passes the authoritative browser tab to live favicon updates', async () => {
    const source = await fs.readFile(
      new URL(
        '../../../src/entrypoints/sessiontree/SessionTree.vue',
        import.meta.url,
      ),
      'utf8',
    )

    expect(source).toMatch(
      /updateFavicon\(\s*message\.favIconUrl,\s*message\.tab as browser\.tabs\.Tab,?\s*\)/,
    )
  })

  it('describes group membership independently of the color marker', async () => {
    const tab = makeForegroundTab('grouped-tab' as UID, {
      tabGroup: {
        uid: 'group-1' as UID,
        id: 7,
        title: 'Research',
        color: 'purple',
        collapsed: false,
      },
    })

    const markup = await renderTreeItem(tab)

    expect(markup).toContain(
      'aria-describedby="tab-group-description-grouped-tab"',
    )
    expect(markup).toContain('id="tab-group-description-grouped-tab"')
    expect(markup).toContain('Tab group: Research')
  })

  it('isolates every nested action surface from row double-click handling', async () => {
    const source = await fs.readFile(
      new URL('../../../src/components/TreeItem.vue', import.meta.url),
      'utf8',
    )

    for (const className of [
      'tree-item-tab-group-indicator',
      'tree-item-hover-menu',
      'tree-item-action-button',
      'child-count',
      'tree-item-favicon',
    ]) {
      expect(source).toMatch(
        new RegExp(
          `class="[^"]*${className}[^"]*"[\\s\\S]{0,500}?@dblclick\\.stop`,
        ),
      )
    }
  })

  it('scales every compact row with larger default fonts without wrapping', async () => {
    const source = await fs.readFile(
      new URL('../../../src/components/TreeItem.vue', import.meta.url),
      'utf8',
    )

    expect(source).toMatch(
      /\.tree-item\s*\{[\s\S]*?min-height:\s*max\(20px, calc\(var\(--font-size-xs\) \+ 7px\)\)/,
    )
    expect(source).toMatch(/\.tree-item-content\s*\{[\s\S]*?max-height:\s*none/)
    expect(source).toMatch(
      /\.tree-item-title\s*\{[\s\S]*?white-space:\s*nowrap/,
    )
    expect(source).toMatch(/\.tree-item-title\s*\{[\s\S]*?overflow:\s*hidden/)
    expect(source).toMatch(
      /\.tree-item-title\s*\{[\s\S]*?text-overflow:\s*ellipsis/,
    )
  })
})
