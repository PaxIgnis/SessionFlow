import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Settings } from '@/services/settings'
import { closeModal, ModalState } from '@/services/modal-state'
import { State } from '@/types/session-tree'
import {
  makeForegroundTab,
  makeForegroundWindow,
  resetForegroundTree,
} from '../../helpers/foreground-tree-fixtures'
import { installFakeBrowser } from '../../helpers/fake-browser'

const sendTreeCommand = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const isPrivateWindowAccessAllowed = vi.hoisted(() =>
  vi.fn().mockResolvedValue(true),
)
const showPrivateWindowAccessRequired = vi.hoisted(() => vi.fn())
const showNotification = vi.hoisted(() => vi.fn())

vi.mock('@/services/runtime-port-service', () => ({
  sendTreeCommand,
}))
vi.mock('@/services/utils', () => ({
  isPrivateWindowAccessAllowed,
}))
vi.mock('@/services/notification-state', () => ({
  showNotification,
  showPrivateWindowAccessRequired,
}))

describe('foreground message helpers', () => {
  beforeEach(() => {
    installFakeBrowser()
    sendTreeCommand.mockClear()
    isPrivateWindowAccessAllowed.mockReset().mockResolvedValue(true)
    showPrivateWindowAccessRequired.mockReset()
    showNotification.mockReset()
    closeModal()
    resetForegroundTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })

  it('does not expose the legacy moveTabs command helper', async () => {
    const messages = await import('@/services/foreground-messages')

    expect('moveTabs' in messages).toBe(false)
  })

  it('sends moveTreeItems and moveWindows command payloads', async () => {
    const { moveTreeItems, moveWindows } =
      await import('@/services/foreground-messages')

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

  it('sends generic tree item action payloads', async () => {
    const {
      duplicateTreeItems,
      treeItemIndentDecrease,
      treeItemIndentIncrease,
    } = await import('@/services/foreground-messages')

    duplicateTreeItems(['note-1' as UID, 'window-1' as UID])
    treeItemIndentIncrease(['note-1' as UID])
    treeItemIndentDecrease(['window-1' as UID])

    expect(sendTreeCommand).toHaveBeenNthCalledWith(1, {
      action: 'duplicateTreeItems',
      itemUIDs: ['note-1', 'window-1'],
    })
    expect(sendTreeCommand).toHaveBeenNthCalledWith(2, {
      action: 'treeItemIndentIncrease',
      itemUIDs: ['note-1'],
    })
    expect(sendTreeCommand).toHaveBeenNthCalledWith(3, {
      action: 'treeItemIndentDecrease',
      itemUIDs: ['window-1'],
    })
  })

  it('shows a notification when duplicate state restoration fails', async () => {
    const error = new Error('could not restore duplicated tab')
    sendTreeCommand.mockRejectedValueOnce(error)
    const { duplicateTreeItems } =
      await import('@/services/foreground-messages')

    duplicateTreeItems(['tab-1' as UID])

    await vi.waitFor(() => {
      expect(showNotification).toHaveBeenCalledWith(
        `Session Flow could not duplicate the selected items: ${error}`,
      )
    })
  })

  it('does not expose item-specific foreground duplicate helpers', async () => {
    const messages = await import('@/services/foreground-messages')

    expect('duplicateTab' in messages).toBe(false)
    expect('duplicateTabs' in messages).toBe(false)
  })

  it('does not expose item-specific foreground indent helpers', async () => {
    const messages = await import('@/services/foreground-messages')

    expect('tabIndentIncrease' in messages).toBe(false)
    expect('tabIndentDecrease' in messages).toBe(false)
    expect('separatorIndentIncrease' in messages).toBe(false)
    expect('separatorIndentDecrease' in messages).toBe(false)
  })

  it('sends note command payloads', async () => {
    const { createNote, removeNote, updateNoteText } =
      await import('@/services/foreground-messages')

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

  it('sends separator command payloads', async () => {
    const { createSeparator, createSeparatorBelow, removeSeparator } =
      await import('@/services/foreground-messages')

    createSeparator('window-1' as UID, 2)
    removeSeparator('separator-1' as UID)
    createSeparatorBelow('separator-1' as UID)

    expect(sendTreeCommand).toHaveBeenNthCalledWith(1, {
      action: 'createSeparator',
      parentUid: 'window-1',
      index: 2,
    })
    expect(sendTreeCommand).toHaveBeenNthCalledWith(2, {
      action: 'removeSeparator',
      separatorUid: 'separator-1',
    })
    expect(sendTreeCommand).toHaveBeenNthCalledWith(3, {
      action: 'createSeparatorBelow',
      separatorUid: 'separator-1',
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
    ['duplicate', 'duplicateTreeItems'],
    ['focus', 'focusTab'],
  ] as const)(
    'uses open-tab double-click action %s',
    async (setting, action) => {
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
    },
  )

  it.each([
    ['open', 'openTab'],
    ['remove', 'closeTab'],
    ['duplicate', 'duplicateTreeItems'],
  ] as const)(
    'uses saved-tab double-click action %s',
    async (setting, action) => {
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
    },
  )

  it('shows instructions instead of opening a denied private saved tab', async () => {
    const { tabDoubleClick } = await import('@/services/foreground-messages')
    Settings.values.doubleClickOnSavedTab = 'open'
    isPrivateWindowAccessAllowed.mockResolvedValue(false)

    await tabDoubleClick(
      -1,
      -1,
      'tab-private' as UID,
      'window-private' as UID,
      State.SAVED,
      'https://example.test/private',
      true,
    )

    expect(showPrivateWindowAccessRequired).toHaveBeenCalledWith('tab')
    expect(sendTreeCommand).not.toHaveBeenCalled()
  })

  it('shows instructions instead of opening a denied private saved window', async () => {
    const { windowDoubleClick } = await import('@/services/foreground-messages')
    isPrivateWindowAccessAllowed.mockResolvedValue(false)

    await windowDoubleClick('window-private' as UID, -1, State.SAVED, true)

    expect(showPrivateWindowAccessRequired).toHaveBeenCalledWith('window')
    expect(sendTreeCommand).not.toHaveBeenCalled()
  })

  it('opens saved private tabs and windows when Firefox access is allowed', async () => {
    const { tabDoubleClick, windowDoubleClick } =
      await import('@/services/foreground-messages')
    Settings.values.doubleClickOnSavedTab = 'open'

    await tabDoubleClick(
      -1,
      -1,
      'tab-private' as UID,
      'window-private' as UID,
      State.SAVED,
      'https://example.test/private',
      true,
    )
    await windowDoubleClick('window-private' as UID, -1, State.SAVED, true)

    expect(sendTreeCommand).toHaveBeenNthCalledWith(1, {
      action: 'openTab',
      tabUid: 'tab-private',
      windowUid: 'window-private',
      url: 'https://example.test/private',
    })
    expect(sendTreeCommand).toHaveBeenNthCalledWith(2, {
      action: 'openWindow',
      windowUid: 'window-private',
    })
    expect(showPrivateWindowAccessRequired).not.toHaveBeenCalled()
  })

  it('derives a saved tab private identity from its actual parent window', async () => {
    const { treeItemDoubleClick } =
      await import('@/services/foreground-messages')
    const tab = makeForegroundTab('tab-private' as UID)
    const window = makeForegroundWindow('window-private' as UID, [tab], {
      incognito: true,
    })
    resetForegroundTree([window])
    Settings.values.doubleClickOnSavedTab = 'open'
    isPrivateWindowAccessAllowed.mockResolvedValue(false)

    await treeItemDoubleClick(tab)

    expect(showPrivateWindowAccessRequired).toHaveBeenCalledWith('tab')
    expect(sendTreeCommand).not.toHaveBeenCalled()
  })

  it('coalesces concurrent recovery clicks and scopes consent to shown containers', async () => {
    const { openContainerRecoveryModal } =
      await import('@/services/modal-state')
    const { resolveContainerRecoveryModal } =
      await import('@/services/foreground-messages')
    let releaseCommand: () => void = () => undefined
    sendTreeCommand.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseCommand = resolve
        }),
    )
    openContainerRecoveryModal(
      {
        type: 'tab',
        tabUid: 'tab-work' as UID,
        windowUid: 'window-1' as UID,
        url: 'https://example.test/work',
      },
      [
        {
          cookieStoreId: 'firefox-container-work',
          name: 'Work',
          color: 'blue',
          colorCode: '#37adff',
          icon: 'briefcase',
        },
      ],
    )

    const first = resolveContainerRecoveryModal('recreate')
    const second = resolveContainerRecoveryModal('recreate')

    expect(sendTreeCommand).toHaveBeenCalledTimes(1)
    expect(sendTreeCommand).toHaveBeenCalledWith({
      action: 'openTab',
      tabUid: 'tab-work',
      windowUid: 'window-1',
      url: 'https://example.test/work',
      containerRecovery: 'recreate',
      containerRecoveryStoreIds: ['firefox-container-work'],
    })
    releaseCommand()
    await Promise.all([first, second])
  })

  it('keeps every selected tab in one bulk container recovery request', async () => {
    const { openTabs, resolveContainerRecoveryModal } =
      await import('@/services/foreground-messages')
    const work = {
      cookieStoreId: 'firefox-container-work',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
    }
    const personal = {
      ...work,
      cookieStoreId: 'firefox-container-personal',
      name: 'Personal',
    }
    const first = makeForegroundTab('tab-work' as UID, { container: work })
    const second = makeForegroundTab('tab-personal' as UID, {
      container: personal,
    })
    const window = makeForegroundWindow('window-1' as UID, [first, second])
    resetForegroundTree([window])

    await openTabs([first, second])
    await vi.waitFor(() => {
      expect(ModalState.active?.kind).toBe('containerRecovery')
    })

    expect(ModalState.active).toMatchObject({
      kind: 'containerRecovery',
      target: {
        type: 'tabs',
        tabs: [
          {
            tabUid: 'tab-work',
            windowUid: 'window-1',
            url: first.url,
            containerStoreId: 'firefox-container-work',
          },
          {
            tabUid: 'tab-personal',
            windowUid: 'window-1',
            url: second.url,
            containerStoreId: 'firefox-container-personal',
          },
        ],
      },
      missingContainers: [work, personal],
    })
    expect(sendTreeCommand).not.toHaveBeenCalled()

    await resolveContainerRecoveryModal('without-container')

    expect(sendTreeCommand).toHaveBeenNthCalledWith(1, {
      action: 'openTab',
      tabUid: 'tab-work',
      windowUid: 'window-1',
      url: first.url,
      containerRecovery: 'without-container',
      containerRecoveryStoreIds: ['firefox-container-work'],
    })
    expect(sendTreeCommand).toHaveBeenNthCalledWith(2, {
      action: 'openTab',
      tabUid: 'tab-personal',
      windowUid: 'window-1',
      url: second.url,
      containerRecovery: 'without-container',
      containerRecoveryStoreIds: ['firefox-container-personal'],
    })
  })

  it('refreshes stale recovery choices when the missing set changes', async () => {
    const { openContainerRecoveryModal } =
      await import('@/services/modal-state')
    const { resolveContainerRecoveryModal } =
      await import('@/services/foreground-messages')
    const work = {
      cookieStoreId: 'firefox-container-work',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
    }
    const personal = {
      ...work,
      cookieStoreId: 'firefox-container-personal',
      name: 'Personal',
    }
    const first = makeForegroundTab('tab-work' as UID, { container: work })
    const second = makeForegroundTab('tab-personal' as UID, {
      container: personal,
    })
    const window = makeForegroundWindow('window-1' as UID, [first, second])
    resetForegroundTree([window])
    openContainerRecoveryModal({ type: 'window', windowUid: window.uid }, [
      work,
    ])
    sendTreeCommand.mockRejectedValueOnce(
      new Error(
        'Missing Firefox containers changed after recovery choices were shown',
      ),
    )

    await resolveContainerRecoveryModal('recreate')

    expect(ModalState.active).toMatchObject({
      kind: 'containerRecovery',
      target: { type: 'window', windowUid: 'window-1' },
      missingContainers: [work, personal],
    })
    expect(showNotification).not.toHaveBeenCalled()
  })

  it('reports a failed normal retry after stale recovery choices clear', async () => {
    const { openContainerRecoveryModal } =
      await import('@/services/modal-state')
    const { resolveContainerRecoveryModal } =
      await import('@/services/foreground-messages')
    const work = {
      cookieStoreId: 'firefox-container-work',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
    }
    const tab = makeForegroundTab('tab-work' as UID, { container: work })
    const window = makeForegroundWindow('window-1' as UID, [tab])
    resetForegroundTree([window])
    vi.mocked(browser.contextualIdentities.query).mockResolvedValue([
      {
        ...work,
        iconUrl: 'resource://usercontext-content/briefcase.svg',
      },
    ])
    openContainerRecoveryModal(
      {
        type: 'tab',
        tabUid: tab.uid,
        windowUid: window.uid,
        url: tab.url,
      },
      [work],
    )
    sendTreeCommand
      .mockRejectedValueOnce(
        new Error(
          'Missing Firefox containers changed after recovery choices were shown',
        ),
      )
      .mockRejectedValueOnce(new Error('normal retry failed'))

    await expect(
      resolveContainerRecoveryModal('recreate'),
    ).resolves.toBeUndefined()

    expect(showNotification).toHaveBeenCalledWith(
      expect.stringContaining('normal retry failed'),
    )
    expect(ModalState.active?.kind).toBe('containerRecovery')
  })

  it('retries only the remaining tabs after a partial bulk recovery failure', async () => {
    const { openContainerRecoveryModal } =
      await import('@/services/modal-state')
    const { resolveContainerRecoveryModal } =
      await import('@/services/foreground-messages')
    const work = {
      cookieStoreId: 'firefox-container-work',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
    }
    const personal = {
      ...work,
      cookieStoreId: 'firefox-container-personal',
      name: 'Personal',
    }
    const first = makeForegroundTab('tab-work' as UID, { container: work })
    const second = makeForegroundTab('tab-personal' as UID, {
      container: personal,
    })
    const window = makeForegroundWindow('window-1' as UID, [first, second])
    resetForegroundTree([window])
    openContainerRecoveryModal(
      {
        type: 'tabs',
        tabs: [
          {
            type: 'tab',
            tabUid: first.uid,
            windowUid: window.uid,
            url: first.url,
            containerStoreId: work.cookieStoreId,
          },
          {
            type: 'tab',
            tabUid: second.uid,
            windowUid: window.uid,
            url: second.url,
            containerStoreId: personal.cookieStoreId,
          },
        ],
      },
      [work, personal],
    )
    sendTreeCommand
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('second tab failed'))

    await resolveContainerRecoveryModal('without-container')

    expect(ModalState.active).toMatchObject({
      kind: 'containerRecovery',
      target: {
        type: 'tabs',
        tabs: [{ tabUid: 'tab-personal' }],
      },
      missingContainers: [personal],
    })
    expect(showNotification).toHaveBeenCalledWith(
      expect.stringContaining('second tab failed'),
    )

    sendTreeCommand.mockResolvedValueOnce(undefined)
    await resolveContainerRecoveryModal('without-container')

    expect(sendTreeCommand.mock.calls).toHaveLength(3)
    expect(sendTreeCommand.mock.calls[0][0]).toMatchObject({
      tabUid: 'tab-work',
    })
    expect(sendTreeCommand.mock.calls[1][0]).toMatchObject({
      tabUid: 'tab-personal',
    })
    expect(sendTreeCommand.mock.calls[2][0]).toMatchObject({
      tabUid: 'tab-personal',
    })
  })

  it('closes recovery when a remaining failed tab has no missing container', async () => {
    const { openContainerRecoveryModal } =
      await import('@/services/modal-state')
    const { resolveContainerRecoveryModal } =
      await import('@/services/foreground-messages')
    const work = {
      cookieStoreId: 'firefox-container-work',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
    }
    const personal = {
      ...work,
      cookieStoreId: 'firefox-container-personal',
      name: 'Personal',
      iconUrl: 'resource://usercontext-content/briefcase.svg',
    }
    const first = makeForegroundTab('tab-work' as UID, { container: work })
    const second = makeForegroundTab('tab-personal' as UID, {
      container: personal,
    })
    const window = makeForegroundWindow('window-1' as UID, [first, second])
    resetForegroundTree([window])
    vi.mocked(browser.contextualIdentities.query).mockResolvedValue([personal])
    openContainerRecoveryModal(
      {
        type: 'tabs',
        tabs: [
          {
            type: 'tab',
            tabUid: first.uid,
            windowUid: window.uid,
            url: first.url,
            containerStoreId: work.cookieStoreId,
          },
          {
            type: 'tab',
            tabUid: second.uid,
            windowUid: window.uid,
            url: second.url,
            containerStoreId: personal.cookieStoreId,
          },
        ],
      },
      [work],
    )
    sendTreeCommand
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('live tab failed'))

    await resolveContainerRecoveryModal('recreate')

    expect(ModalState.active).toBeNull()
    expect(showNotification).toHaveBeenCalledWith(
      expect.stringContaining('live tab failed'),
    )
  })

  it('passes a saved window private identity through the tree-item helper', async () => {
    const { treeItemDoubleClick } =
      await import('@/services/foreground-messages')
    const window = makeForegroundWindow('window-private' as UID, [], {
      incognito: true,
    })
    isPrivateWindowAccessAllowed.mockResolvedValue(false)

    await treeItemDoubleClick(window)

    expect(showPrivateWindowAccessRequired).toHaveBeenCalledWith('window')
    expect(sendTreeCommand).not.toHaveBeenCalled()
  })

  it('keeps denied-access checks out of open private item actions', async () => {
    const { treeItemDoubleClick } =
      await import('@/services/foreground-messages')
    const tab = makeForegroundTab('tab-private' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const window = makeForegroundWindow('window-private' as UID, [tab], {
      id: 20,
      incognito: true,
      state: State.OPEN,
    })
    resetForegroundTree([window])
    Settings.values.doubleClickOnOpenTab = 'focus'
    isPrivateWindowAccessAllowed.mockResolvedValue(false)

    await treeItemDoubleClick(tab)
    await treeItemDoubleClick(window)

    expect(isPrivateWindowAccessAllowed).not.toHaveBeenCalled()
    expect(sendTreeCommand).toHaveBeenNthCalledWith(1, {
      action: 'focusTab',
      tabId: 10,
      windowId: 20,
    })
    expect(sendTreeCommand).toHaveBeenNthCalledWith(2, {
      action: 'focusWindow',
      windowId: 20,
    })
  })

  it('keeps denied-access checks out of normal saved item actions', async () => {
    const { treeItemDoubleClick } =
      await import('@/services/foreground-messages')
    const tab = makeForegroundTab('tab-normal' as UID)
    const window = makeForegroundWindow('window-normal' as UID, [tab], {
      incognito: false,
    })
    resetForegroundTree([window])
    Settings.values.doubleClickOnSavedTab = 'open'
    isPrivateWindowAccessAllowed.mockResolvedValue(false)

    await treeItemDoubleClick(tab)
    await treeItemDoubleClick(window)

    expect(isPrivateWindowAccessAllowed).not.toHaveBeenCalled()
    expect(sendTreeCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ action: 'openTab', tabUid: 'tab-normal' }),
    )
    expect(sendTreeCommand).toHaveBeenNthCalledWith(2, {
      action: 'openWindow',
      windowUid: 'window-normal',
    })
  })

  it('sends multi-tab helper commands in item order', async () => {
    const { closeTabs, openTabs, unpinTabs } =
      await import('@/services/foreground-messages')
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
