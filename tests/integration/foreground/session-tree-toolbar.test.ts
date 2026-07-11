import SessionTreeToolbar from '@/components/SessionTreeToolbar.vue'
import * as Messages from '@/services/foreground-messages'
import {
  addRootNote,
  addRootSeparator,
  createNewTab,
  createNewWindow,
  openSettings,
} from '@/services/session-tree-toolbar-actions'
import { State } from '@/types/session-tree'
import {
  makeForegroundNote,
  makeForegroundWindow,
  resetForegroundTree,
} from '../../helpers/foreground-tree-fixtures'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/foreground-messages', () => ({
  createNote: vi.fn(),
  createSeparator: vi.fn(),
}))

describe('SessionTreeToolbar', () => {
  const createTab = vi.fn().mockResolvedValue({ id: 11 })
  const createWindow = vi.fn().mockResolvedValue({ id: 12 })
  const openOptionsPage = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.stubGlobal('browser', {
      tabs: { create: createTab },
      windows: { create: createWindow },
      runtime: { openOptionsPage },
    })
    resetForegroundTree()
  })

  afterEach(() => {
    resetForegroundTree()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders all tree action buttons with accessible names', async () => {
    const markup = await renderToString(createSSRApp(SessionTreeToolbar))

    expect(markup).toContain('aria-label="Tree actions"')
    for (const label of [
      'Add note',
      'Add separator',
      'New window',
      'New tab',
      'Settings',
    ]) {
      expect(markup).toContain(`aria-label="${label}"`)
    }
  })

  it('appends notes and separators to the root tree', () => {
    resetForegroundTree([
      makeForegroundNote('existing-note' as UID, { indentLevel: 0 }),
    ])

    addRootNote()
    addRootSeparator()

    expect(Messages.createNote).toHaveBeenCalledWith(undefined, 1)
    expect(Messages.createSeparator).toHaveBeenCalledWith(undefined, 1)
  })

  it('creates a new browser window', async () => {
    await createNewWindow()

    expect(createWindow).toHaveBeenCalledWith()
  })

  it('creates a tab in the active open tree window', async () => {
    resetForegroundTree([
      makeForegroundWindow('active-window' as UID, [], {
        id: 42,
        active: true,
        state: State.OPEN,
      }),
    ])

    await createNewTab()

    expect(createTab).toHaveBeenCalledWith({ windowId: 42 })
    expect(createWindow).not.toHaveBeenCalled()
  })

  it('creates a normal window when no active open window can receive a tab', async () => {
    resetForegroundTree([
      makeForegroundWindow('saved-window' as UID, [], {
        id: -1,
        active: true,
        state: State.SAVED,
      }),
    ])

    await createNewTab()

    expect(createTab).not.toHaveBeenCalled()
    expect(createWindow).toHaveBeenCalledWith()
  })

  it('opens the extension settings page', async () => {
    await openSettings()

    expect(openOptionsPage).toHaveBeenCalledWith()
  })
})
