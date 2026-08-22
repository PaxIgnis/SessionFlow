import TreeItemComponent from '@/components/TreeItem.vue'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Settings } from '@/services/settings'
import { TreeItem } from '@/types/session-tree'
import {
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

describe('window tree item identity', () => {
  beforeEach(() => {
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })

  afterEach(() => {
    resetForegroundTree()
  })

  it('renders every window with a distinct icon-and-title label', async () => {
    const window = makeForegroundWindow('window-normal' as UID, [], {
      incognito: false,
      title: 'Work',
    })

    const markup = await renderTreeItem(window)

    expect(markup).toContain('tree-item-window')
    expect(markup).toContain('tree-item-window-label')
    expect(markup).toContain('tree-item-window-favicon')
    expect(markup).not.toContain('tree-item-window-label-private')
    expect(markup).not.toContain('tree-item-window-private-badge')
  })

  it('renders private windows with purple-treatment hooks and an explicit badge', async () => {
    const window = makeForegroundWindow('window-private' as UID, [], {
      incognito: true,
      title: 'Research',
    })

    const markup = await renderTreeItem(window)

    expect(markup).toContain('tree-item-window-private')
    expect(markup).toContain('tree-item-window-label-private')
    expect(markup).toContain('tree-item-window-private-badge')
    expect(markup).toContain('aria-label="Private window: Research"')
    // The row tooltip now summarises the window's contents, so it leads with
    // the private label rather than being only that label.
    expect(markup).toContain(
      'title="Private window: Research\nState: Saved\nTabs: 0"',
    )
    expect(markup).toContain('Private')
  })
})
