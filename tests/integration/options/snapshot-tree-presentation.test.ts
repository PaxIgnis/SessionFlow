import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import fs from 'node:fs/promises'
import SnapshotTreeItemComponent from '@/entrypoints/options/components/SnapshotTreeItem.vue'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Settings } from '@/services/settings'
import type {
  SnapshotNote,
  SnapshotSeparator,
  SnapshotTab,
  SnapshotTreeItem,
  SnapshotWindow,
} from '@/types/session-snapshots'
import { State, TreeItemType } from '@/types/session-tree'

async function renderSnapshotItem(
  item: SnapshotTreeItem,
  options: {
    checked?: boolean
    privateItem?: boolean
    getFavicon?: (url: string, privateTab?: boolean) => string
  } = {},
): Promise<string> {
  ;(
    SnapshotTreeItemComponent as unknown as {
      __cssModules?: Record<string, object>
    }
  ).__cssModules = { $style: {} }
  return renderToString(
    createSSRApp(SnapshotTreeItemComponent, {
      item,
      checked: options.checked ?? false,
      indeterminate: false,
      collapsed: item.collapsed ?? false,
      hasChildren: item.isParent ?? false,
      childCount: item.isParent ? 2 : 0,
      childrenOpen: false,
      privateItem: options.privateItem ?? false,
      faviconService: {
        getFavicon: options.getFavicon ?? (() => '/icon/16.png'),
      },
      indentGuideState: {
        verticalLevels: [],
        hasFollowingAtSameLevel: false,
        hasFollowingDirectSibling: false,
      },
    }),
  )
}

describe('snapshot tree presentation', () => {
  beforeEach(() => {
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })

  afterEach(() => vi.restoreAllMocks())

  it('renders a selected cached private tab with live tree state, pin, group, and container styling', async () => {
    const getFavicon = vi.fn(() => 'data:image/png;base64,cached')
    const markup = await renderSnapshotItem(
      tab({
        state: State.SAVED,
        pinned: true,
        customLabel: 'Project α',
        isParent: true,
        collapsed: true,
        tabGroup: {
          uid: 'group-1' as UID,
          title: 'Research',
          color: 'purple',
          collapsed: false,
        },
        container: {
          cookieStoreId: 'firefox-container-1',
          name: 'Work',
          color: 'blue',
          colorCode: '#37adff',
          icon: 'briefcase',
        },
      }),
      { checked: true, privateItem: true, getFavicon },
    )

    expect(getFavicon).toHaveBeenCalledWith('https://example.test/tab', true)
    expect(markup).toContain(
      'class="tree-item indentLevel-1 tree-item-selected',
    )
    expect(markup).toContain('tree-item-text-saved')
    expect(markup).toContain('tree-item-pinned')
    expect(markup).toContain('child-count')
    expect(markup).toContain('tree-item-custom-label')
    expect(markup).toContain('Project α')
    expect(markup).toContain('tree-item-tab-group-indicator-right')
    expect(markup).toContain('tree-item-container-indicator-soft-fade-right')
    expect(markup).toContain('tree-item-container-icon-left')
    expect(markup).toContain('snapshot-tree-checkbox')
    expect(markup).toContain('data:image/png;base64,cached')
    expect(markup.indexOf('snapshot-tree-checkbox')).toBeLessThan(
      markup.indexOf('tree-item-favicon'),
    )
  })

  it('renders normal and private window labels with the live icons', async () => {
    const normalMarkup = await renderSnapshotItem(windowItem(false))
    const privateMarkup = await renderSnapshotItem(windowItem(true), {
      privateItem: true,
    })

    expect(normalMarkup).toContain('tree-item-window-label')
    expect(normalMarkup).toContain('src="/icon/16.png"')
    expect(privateMarkup).toContain('tree-item-window-private')
    expect(privateMarkup).toContain('tree-item-window-label-private')
    expect(privateMarkup).toContain('src="/icons/private-browsing.svg"')
    expect(privateMarkup).toContain('tree-item-window-private-badge')
  })

  it('renders live note, separator, indent connector, and favicon fallback presentation', async () => {
    const noteMarkup = await renderSnapshotItem(note())
    const separatorMarkup = await renderSnapshotItem(separator())
    const tabMarkup = await renderSnapshotItem(tab())

    expect(noteMarkup).toContain('tree-item-note')
    expect(noteMarkup).toContain('tree-item-note-text')
    expect(noteMarkup).toContain('indent-line-connector')
    expect(separatorMarkup).toContain('tree-item-separator')
    expect(separatorMarkup).toContain('tree-item-separator-line')
    expect(tabMarkup).toContain('src="/icon/16.png"')
  })

  it('contains no live tree interaction surfaces and uses the shared indent algorithm', async () => {
    const itemSource = await fs.readFile(
      new URL(
        '../../../src/entrypoints/options/components/SnapshotTreeItem.vue',
        import.meta.url,
      ),
      'utf8',
    )
    const treeSource = await fs.readFile(
      new URL(
        '../../../src/entrypoints/options/components/SnapshotTree.vue',
        import.meta.url,
      ),
      'utf8',
    )

    expect(itemSource).not.toContain('@dragstart')
    expect(itemSource).not.toContain('@contextmenu')
    expect(itemSource).not.toContain('@dblclick')
    expect(itemSource).not.toContain('foreground-messages')
    expect(treeSource).toContain('buildIndentGuideStates')
    expect(itemSource).toMatch(
      /\.tree-item-separator\.indentLevel-0\s*\{[\s\S]*?padding-inline-start:\s*16px[\s\S]*?padding-inline-end:\s*0/,
    )
    expect(itemSource).toMatch(
      /\.tree-item-separator \.tree-item-spacer\s*\{[\s\S]*?display:\s*none/,
    )
    expect(itemSource).not.toMatch(
      /\.tree-item-separator \.tree-item-action,\s*\.tree-item-separator \.tree-item-spacer\s*\{[\s\S]*?display:\s*none/,
    )
    expect(treeSource).toContain('v-for="row in rows"')
    expect(treeSource).not.toContain('visibleRows')
    expect(treeSource).not.toContain('scrollTop')
    expect(treeSource).not.toContain('viewportHeight')
    expect(treeSource).toMatch(
      /\.snapshot-tree\s*\{[\s\S]*?flex:\s*1 1 auto[\s\S]*?min-height:\s*0[\s\S]*?height:\s*auto/,
    )
  })
})

function tab(overrides: Partial<SnapshotTab> = {}): SnapshotTab {
  return {
    type: TreeItemType.TAB,
    uid: 'tab-1' as UID,
    state: State.OPEN,
    title: 'Example Tab',
    url: 'https://example.test/tab',
    windowUid: 'window-1' as UID,
    indentLevel: 1,
    pinned: false,
    ...overrides,
  }
}

function windowItem(incognito: boolean): SnapshotWindow {
  return {
    type: TreeItemType.WINDOW,
    uid: `${incognito ? 'private' : 'normal'}-window` as UID,
    incognito,
    state: State.SAVED,
    children: [],
    indentLevel: 0,
    title: incognito ? 'Private Research' : 'Research',
  }
}

function note(): SnapshotNote {
  return {
    type: TreeItemType.NOTE,
    uid: 'note-1' as UID,
    text: 'Snapshot note',
    windowUid: 'window-1' as UID,
    indentLevel: 2,
    parentUid: 'tab-1' as UID,
  }
}

function separator(): SnapshotSeparator {
  return {
    type: TreeItemType.SEPARATOR,
    uid: 'separator-1' as UID,
    windowUid: 'window-1' as UID,
    indentLevel: 1,
  }
}
