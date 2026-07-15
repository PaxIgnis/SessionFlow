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
    expect(markup).toContain('title="Private window"')
    expect(markup).toContain('Private')
  })
})
