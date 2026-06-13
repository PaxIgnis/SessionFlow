import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Settings } from '@/services/settings'
import { State } from '@/types/session-tree'

const sendTreeCommand = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@/services/runtime-port-service', () => ({
  sendTreeCommand,
}))

describe('foreground message helpers', () => {
  beforeEach(() => {
    sendTreeCommand.mockClear()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })

  it('sends moveTabs command payloads', async () => {
    const { moveTabs } = await import('@/services/foreground-messages')

    moveTabs(['tab-1' as UID], 'window-1' as UID, 2, undefined, false)

    expect(sendTreeCommand).toHaveBeenCalledWith({
      action: 'moveTabs',
      tabUIDs: ['tab-1'],
      targetWindowUid: 'window-1',
      targetIndex: 2,
      parentUid: undefined,
      copy: false,
    })
  })

  it('sends moveTreeItems and moveWindows command payloads', async () => {
    const { moveTreeItems, moveWindows } = await import(
      '@/services/foreground-messages'
    )

    moveTreeItems(
      ['note-1' as UID],
      1,
      'tab-parent' as UID,
      'window-1' as UID,
      false,
    )
    moveWindows(['window-2' as UID], 0, false)

    expect(sendTreeCommand).toHaveBeenNthCalledWith(1, {
      action: 'moveTreeItems',
      itemUIDs: ['note-1'],
      targetIndex: 1,
      parentUid: 'tab-parent',
      targetWindowUid: 'window-1',
      copy: false,
    })
    expect(sendTreeCommand).toHaveBeenNthCalledWith(2, {
      action: 'moveWindows',
      windowUIDs: ['window-2'],
      targetIndex: 0,
      copy: false,
    })
  })

  it('sends note command payloads', async () => {
    const { createNote, removeNote, updateNoteText } = await import(
      '@/services/foreground-messages'
    )

    createNote('window-1' as UID, 1, 'hello')
    updateNoteText('note-1' as UID, 'updated')
    removeNote('note-1' as UID)

    expect(sendTreeCommand).toHaveBeenNthCalledWith(1, {
      action: 'createNote',
      parentUid: 'window-1',
      index: 1,
      text: 'hello',
    })
    expect(sendTreeCommand).toHaveBeenNthCalledWith(2, {
      action: 'updateNoteText',
      noteUid: 'note-1',
      text: 'updated',
    })
    expect(sendTreeCommand).toHaveBeenNthCalledWith(3, {
      action: 'removeNote',
      noteUid: 'note-1',
    })
  })

  it('uses settings-driven tab double-click actions', async () => {
    const { tabDoubleClick } = await import('@/services/foreground-messages')

    Settings.values.doubleClickOnOpenTab = 'focus'
    Settings.values.doubleClickOnSavedTab = 'open'

    tabDoubleClick(
      10,
      20,
      'tab-open' as UID,
      'window-1' as UID,
      State.OPEN,
      'https://example.test/open',
    )
    tabDoubleClick(
      -1,
      -1,
      'tab-saved' as UID,
      'window-1' as UID,
      State.SAVED,
      'https://example.test/saved',
    )

    expect(sendTreeCommand).toHaveBeenNthCalledWith(1, {
      action: 'focusTab',
      tabId: 10,
      windowId: 20,
    })
    expect(sendTreeCommand).toHaveBeenNthCalledWith(2, {
      action: 'openTab',
      tabUid: 'tab-saved',
      windowUid: 'window-1',
      url: 'https://example.test/saved',
    })
  })

  it.each([
    ['save', 'saveTab'],
    ['close', 'closeTab'],
    ['reload', 'reloadTab'],
    ['duplicate', 'duplicateTab'],
    ['focus', 'focusTab'],
  ] as const)('uses open-tab double-click action %s', async (setting, action) => {
    const { tabDoubleClick } = await import('@/services/foreground-messages')
    Settings.values.doubleClickOnOpenTab = setting

    tabDoubleClick(
      10,
      20,
      'tab-1' as UID,
      'window-1' as UID,
      State.OPEN,
      'https://example.test',
    )

    expect(sendTreeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ action }),
    )
  })

  it.each([
    ['open', 'openTab'],
    ['remove', 'closeTab'],
    ['duplicate', 'duplicateTab'],
  ] as const)('uses saved-tab double-click action %s', async (setting, action) => {
    const { tabDoubleClick } = await import('@/services/foreground-messages')
    Settings.values.doubleClickOnSavedTab = setting

    tabDoubleClick(
      -1,
      -1,
      'tab-1' as UID,
      'window-1' as UID,
      State.SAVED,
      'https://example.test',
    )

    expect(sendTreeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ action }),
    )
  })

  it('sends multi-tab helper commands in item order', async () => {
    const { closeTabs, openTabs, unpinTabs } = await import(
      '@/services/foreground-messages'
    )
    const tabs = [
      {
        uid: 'tab-1' as UID,
        id: 1,
        windowUid: 'window-1' as UID,
        url: 'https://one.example',
      },
      {
        uid: 'tab-2' as UID,
        id: 2,
        windowUid: 'window-1' as UID,
        url: 'https://two.example',
      },
    ] as Parameters<typeof closeTabs>[0]

    closeTabs(tabs)
    openTabs(tabs)
    unpinTabs(tabs)

    expect(sendTreeCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ action: 'closeTab', tabUid: 'tab-1' }),
    )
    expect(sendTreeCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: 'closeTab', tabUid: 'tab-2' }),
    )
    expect(sendTreeCommand).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ action: 'openTab', tabUid: 'tab-1' }),
    )
    expect(sendTreeCommand).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ action: 'openTab', tabUid: 'tab-2' }),
    )
    expect(sendTreeCommand).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({ action: 'unpinTab', tabUid: 'tab-2' }),
    )
    expect(sendTreeCommand).toHaveBeenNthCalledWith(
      6,
      expect.objectContaining({ action: 'unpinTab', tabUid: 'tab-1' }),
    )
  })

  it('sends updateCustomLabel and logs rejected commands', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendTreeCommand.mockRejectedValueOnce(new Error('failed'))
    const { updateCustomLabel } = await import('@/services/foreground-messages')

    updateCustomLabel('tab-1' as UID, 'Label')
    await Promise.resolve()

    expect(sendTreeCommand).toHaveBeenCalledWith({
      action: 'updateCustomLabel',
      uid: 'tab-1',
      customLabel: 'Label',
    })
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to update custom label:',
      expect.any(Error),
    )
  })
})
