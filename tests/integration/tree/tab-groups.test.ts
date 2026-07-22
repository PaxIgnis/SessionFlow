import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import { State, TabGroupMetadata } from '@/types/session-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import {
  createNote,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function group(uid: string = 'group-uid', id: number = 7): TabGroupMetadata {
  return {
    uid: uid as UID,
    id,
    title: 'Research',
    color: 'blue',
    collapsed: false,
  }
}

describe('tab groups', () => {
  const browser = installFakeBrowser()

  beforeEach(() => {
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
    vi.mocked(browser.tabGroups.query).mockResolvedValue([])
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('requires matching groups on both direct adjacent tabs by default', () => {
    const above = createTab('above' as UID, { tabGroup: group() })
    const below = createTab('below' as UID, { tabGroup: group() })
    const moved = createTab('moved' as UID)
    const children = [above, below, moved]

    expect(Tree.getDropTabGroup(children, 1, new Set([moved.uid]))).toEqual(
      group(),
    )
    expect(Tree.getDropTabGroup(children, 0, new Set([moved.uid]))).toBe(
      undefined,
    )
  })

  it('treats notes and separators as adjacency boundaries', () => {
    const above = createTab('above' as UID, { tabGroup: group() })
    const note = createNote('note' as UID)
    const below = createTab('below' as UID, { tabGroup: group() })
    const moved = createTab('moved' as UID)

    expect(
      Tree.getDropTabGroup(
        [above, note, below, moved],
        2,
        new Set([moved.uid]),
      ),
    ).toBe(undefined)
  })

  it('accepts one directly adjacent grouped tab in the permissive mode', () => {
    Settings.values.tabGroupDropBehavior = 'any-adjacent-group'
    const grouped = createTab('grouped' as UID, { tabGroup: group() })
    const ungrouped = createTab('ungrouped' as UID)
    const moved = createTab('moved' as UID)

    expect(
      Tree.getDropTabGroup(
        [grouped, ungrouped, moved],
        1,
        new Set([moved.uid]),
      ),
    ).toEqual(group())
  })

  it('does not choose between two different adjacent groups', () => {
    Settings.values.tabGroupDropBehavior = 'any-adjacent-group'
    const above = createTab('above' as UID, {
      tabGroup: group('group-a'),
    })
    const below = createTab('below' as UID, {
      tabGroup: group('group-b', 8),
    })
    const moved = createTab('moved' as UID)

    expect(
      Tree.getDropTabGroup([above, below, moved], 1, new Set([moved.uid])),
    ).toBe(undefined)
  })

  it('groups saved tabs moved between matching direct tree neighbors', async () => {
    const above = createTab('above' as UID, {
      tabGroup: group('group-uid', -1),
    })
    const below = createTab('below' as UID, {
      tabGroup: group('group-uid', -1),
    })
    const moved = createTab('moved' as UID)
    const window = createWindow('window' as UID, [above, below, moved])

    await Tree.moveTreeItems([moved.uid], 1, undefined, window.uid, false, true)

    expect(Tree.tabsByUid.get(moved.uid)?.tabGroup?.uid).toBe('group-uid')
    expect(Tree.tabsByUid.get(moved.uid)?.tabGroup?.id).toBe(-1)
  })

  it('ungroups every live moved tab when the tree drop has no group', async () => {
    const first = createTab('first' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: group(),
    })
    const second = createTab('second' as UID, {
      id: 11,
      state: State.DISCARDED,
      tabGroup: group(),
    })
    createWindow('window' as UID, [first, second], { state: State.OPEN })

    await Tree.applyDropTabGroup(
      [first.uid, second.uid],
      'window' as UID,
      undefined,
    )

    expect(browser.tabs.ungroup).toHaveBeenCalledWith([10, 11])
    expect(first.tabGroup).toBeUndefined()
    expect(second.tabGroup).toBeUndefined()
  })

  it('preserves a sole tab member when its drop has no inferred group', async () => {
    const onlyMember = createTab('only-member' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: group('sole-group', 7),
    })
    const window = createWindow('window' as UID, [onlyMember], {
      id: 100,
      state: State.OPEN,
    })
    vi.mocked(browser.tabs.group).mockResolvedValue(8)
    vi.mocked(browser.tabGroups.update).mockResolvedValue({
      id: 8,
      windowId: window.id,
      title: 'Research',
      color: 'blue',
      collapsed: false,
    })

    await Tree.applyDropTabGroup([onlyMember.uid], window.uid, undefined)

    expect(browser.tabs.ungroup).not.toHaveBeenCalled()
    expect(browser.tabs.group).toHaveBeenCalledWith({
      tabIds: [10],
      createProperties: { windowId: window.id },
    })
    expect(onlyMember.tabGroup).toEqual(group('sole-group', 8))
  })

  it('preserves a sole group from pre-move metadata after Firefox reports it ungrouped', async () => {
    const onlyMember = createTab('only-member' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const window = createWindow('window' as UID, [onlyMember], {
      id: 100,
      state: State.OPEN,
    })
    vi.mocked(browser.tabs.group).mockResolvedValue(8)
    vi.mocked(browser.tabGroups.update).mockResolvedValue({
      id: 8,
      windowId: window.id,
      title: 'Research',
      color: 'blue',
      collapsed: false,
    })

    await Tree.applyDropTabGroup(
      [onlyMember.uid],
      window.uid,
      undefined,
      new Map([[onlyMember.uid, group('sole-group', 7)]]),
    )

    expect(browser.tabs.ungroup).not.toHaveBeenCalled()
    expect(browser.tabs.group).toHaveBeenCalledWith({
      tabIds: [10],
      createProperties: { windowId: window.id },
    })
    expect(onlyMember.tabGroup).toEqual(group('sole-group', 8))
  })

  it('ungroups one member moved away from a multi-tab group', async () => {
    const moved = createTab('moved' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: group(),
    })
    const remaining = createTab('remaining' as UID, {
      id: 11,
      state: State.OPEN,
      tabGroup: group(),
    })
    const window = createWindow('window' as UID, [moved, remaining], {
      state: State.OPEN,
    })

    await Tree.applyDropTabGroup([moved.uid], window.uid, undefined)

    expect(browser.tabs.ungroup).toHaveBeenCalledWith([10])
    expect(moved.tabGroup).toBeUndefined()
    expect(remaining.tabGroup).toEqual(group())
  })

  it('uses an inferred destination group instead of preserving a sole group', async () => {
    const moved = createTab('moved' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: group('source-group', 7),
    })
    const destination = createTab('destination' as UID, {
      id: 11,
      state: State.OPEN,
      tabGroup: group('destination-group', 8),
    })
    const window = createWindow('window' as UID, [moved, destination], {
      id: 100,
      state: State.OPEN,
    })
    vi.mocked(browser.tabs.group).mockResolvedValue(8)
    vi.mocked(browser.tabGroups.update).mockResolvedValue({
      id: 8,
      windowId: window.id,
      title: 'Research',
      color: 'blue',
      collapsed: false,
    })

    await Tree.applyDropTabGroup([moved.uid], window.uid, destination.tabGroup)

    expect(browser.tabs.group).toHaveBeenCalledWith({
      tabIds: [10],
      groupId: 8,
    })
    expect(moved.tabGroup).toEqual(group('destination-group', 8))
  })

  it('groups live descendant tabs when their parent is dropped into a group', async () => {
    const above = createTab('above' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: group(),
    })
    const below = createTab('below' as UID, {
      id: 11,
      state: State.OPEN,
      tabGroup: group(),
    })
    const parent = createNote('parent' as UID, {
      isParent: true,
      indentLevel: 1,
    })
    const child = createTab('child' as UID, {
      id: 12,
      state: State.OPEN,
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const window = createWindow(
      'window' as UID,
      [above, below, parent, child],
      { state: State.OPEN },
    )
    vi.mocked(browser.tabs.move).mockImplementation(async (tabId) => ({
      id: Array.isArray(tabId) ? tabId[0] : tabId,
    }))
    vi.mocked(browser.tabs.group).mockResolvedValue(7)
    vi.mocked(browser.tabGroups.update).mockResolvedValue({
      id: 7,
      windowId: window.id,
      title: 'Research',
      color: 'blue',
      collapsed: false,
    })

    await Tree.moveTreeItems(
      [parent.uid],
      1,
      undefined,
      window.uid,
      false,
      true,
    )

    expect(browser.tabs.group).toHaveBeenCalledWith({
      tabIds: [12],
      groupId: 7,
    })
    expect(Tree.tabsByUid.get(child.uid)?.tabGroup?.uid).toBe('group-uid')
  })

  it('recreates a one-tab group when a saved group member is opened', async () => {
    const tab = createTab('tab' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: group('stable-group', -1),
    })
    const window = createWindow('window' as UID, [tab], { state: State.OPEN })
    const firefoxGroup: browser.tabGroups.TabGroup = {
      id: 23,
      windowId: window.id,
      title: 'Research',
      color: 'blue',
      collapsed: false,
    }
    vi.mocked(browser.tabs.group).mockResolvedValue(23)
    vi.mocked(browser.tabGroups.update).mockResolvedValue(firefoxGroup)
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 10, windowId: window.id, groupId: 23 } as browser.tabs.Tab,
    ])

    await Tree.restoreTabGroup(tab.uid)

    expect(browser.tabs.group).toHaveBeenCalledWith({
      tabIds: [10],
      createProperties: { windowId: window.id },
    })
    expect(browser.tabGroups.update).toHaveBeenCalledWith(23, {
      title: 'Research',
      color: 'blue',
      collapsed: false,
    })
    expect(tab.tabGroup).toEqual(group('stable-group', 23))
  })

  it('persists group metadata without retaining a live Firefox group ID', () => {
    const tab = createTab('tab' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: group('stable-group', 7),
    })
    const window = createWindow('window' as UID, [tab], {
      id: 20,
      state: State.OPEN,
    })

    Tree.saveWindow(window.uid)

    expect(tab.tabGroup).toEqual(group('stable-group', -1))
    expect(tab.state).toBe(State.SAVED)
  })

  it('retains group metadata when a previously saved window closes', () => {
    const tab = createTab('tab' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: group('stable-group', 7),
    })
    const window = createWindow('window' as UID, [tab], {
      id: 20,
      state: State.OPEN,
      savedTime: 1,
    })
    const firefoxGroup = {
      id: 7,
      windowId: 20,
      title: 'Research',
      color: 'blue',
      collapsed: false,
    } satisfies browser.tabGroups.TabGroup

    Tree.tabGroupWindowClosed(firefoxGroup)
    Tree.saveWindow(window.uid)

    expect(tab.state).toBe(State.SAVED)
    expect(tab.tabGroup).toEqual(group('stable-group', -1))
  })

  it('synchronizes group changes to live and saved members', async () => {
    const live = createTab('live' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: group('stable-group', 7),
    })
    const saved = createTab('saved' as UID, {
      id: -1,
      state: State.SAVED,
      tabGroup: group('stable-group', -1),
    })
    createWindow('window' as UID, [live, saved], { state: State.OPEN })
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 10, windowId: 1, groupId: 7 } as browser.tabs.Tab,
    ])

    await Tree.syncBrowserTabGroup({
      id: 7,
      windowId: 1,
      title: 'Updated',
      color: 'red',
      collapsed: true,
    })

    expect(live.tabGroup).toMatchObject({
      uid: 'stable-group',
      id: 7,
      title: 'Updated',
      color: 'red',
      collapsed: true,
    })
    expect(saved.tabGroup).toMatchObject({
      uid: 'stable-group',
      id: -1,
      title: 'Updated',
      color: 'red',
      collapsed: true,
    })
  })

  it('saves every live member when a deleted group uses the save override', () => {
    const first = createTab('first' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: group(),
    })
    const second = createTab('second' as UID, {
      id: 11,
      state: State.DISCARDED,
      tabGroup: group(),
    })
    createWindow('window' as UID, [first, second], { state: State.OPEN })

    Tree.tabGroupRemoved(
      {
        id: 7,
        windowId: 100,
        title: 'Research',
        color: 'blue',
        collapsed: false,
      },
      true,
    )

    expect(first.state).toBe(State.SAVED)
    expect(second.state).toBe(State.SAVED)
    expect(first.tabGroup).toEqual(group('group-uid', -1))
    expect(second.tabGroup).toEqual(group('group-uid', -1))
  })

  it('retries moved-group synchronization after the destination window is populated', async () => {
    vi.useFakeTimers()
    const original = createTab('original' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: group('stable-group', 7),
    })
    createWindow('old-window' as UID, [original], {
      id: 100,
      state: State.OPEN,
    })
    const movedGroup: browser.tabGroups.TabGroup = {
      id: 7,
      windowId: 200,
      title: 'Research',
      color: 'blue',
      collapsed: false,
    }
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 10, windowId: 200, groupId: 7 } as browser.tabs.Tab,
    ])

    await Tree.tabGroupMoved(movedGroup)
    Tree.removeTab(original.uid)
    const moved = createTab('moved' as UID, {
      id: 10,
      state: State.OPEN,
    })
    createWindow('new-window' as UID, [moved], {
      id: 200,
      state: State.OPEN,
    })
    await vi.advanceTimersByTimeAsync(50)

    expect(moved.tabGroup).toEqual(group('stable-group', 7))
    vi.useRealTimers()
  })

  it('reconciles the complete browser order when a multi-tab group moves', async () => {
    const first = createTab('first' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: group(),
    })
    const second = createTab('second' as UID, {
      id: 11,
      state: State.OPEN,
      tabGroup: group(),
    })
    const other = createTab('other' as UID, {
      id: 12,
      state: State.OPEN,
    })
    const window = createWindow('window' as UID, [first, second, other], {
      id: 100,
      state: State.OPEN,
    })
    const movedGroup: browser.tabGroups.TabGroup = {
      id: 7,
      windowId: window.id,
      title: 'Research',
      color: 'blue',
      collapsed: false,
    }
    vi.mocked(browser.tabs.query).mockImplementation(async (queryInfo) => {
      if (queryInfo.groupId === 7) {
        return [
          { id: 10, windowId: window.id, groupId: 7 },
          { id: 11, windowId: window.id, groupId: 7 },
        ] as browser.tabs.Tab[]
      }
      return [
        { id: 12, windowId: window.id, groupId: -1 },
        { id: 10, windowId: window.id, groupId: 7 },
        { id: 11, windowId: window.id, groupId: 7 },
      ] as browser.tabs.Tab[]
    })

    await Tree.tabGroupMoved(movedGroup)

    expect(Tree.getTabs(window.children).map((tab) => tab.id)).toEqual([
      12, 10, 11,
    ])
  })

  it('clears former parent flags when moving a nested group to the window root', async () => {
    const ungroupedParent = createTab('ungrouped-parent' as UID, {
      id: 12,
      state: State.OPEN,
      isParent: true,
    })
    const groupedParent = createTab('grouped-parent' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: group(),
      parentUid: ungroupedParent.uid,
      indentLevel: 2,
      isParent: true,
    })
    const groupedChild = createTab('grouped-child' as UID, {
      id: 11,
      state: State.OPEN,
      tabGroup: group(),
      parentUid: groupedParent.uid,
      indentLevel: 3,
    })
    const window = createWindow(
      'window' as UID,
      [ungroupedParent, groupedParent, groupedChild],
      { id: 100, state: State.OPEN },
    )
    const movedGroup = {
      id: 7,
      windowId: window.id,
      title: 'Research',
      color: 'blue',
      collapsed: false,
    } satisfies browser.tabGroups.TabGroup
    vi.mocked(browser.tabs.query).mockImplementation(async (queryInfo) => {
      if (queryInfo.groupId === 7) {
        return [
          { id: 10, windowId: window.id, groupId: 7 },
          { id: 11, windowId: window.id, groupId: 7 },
        ] as browser.tabs.Tab[]
      }
      return [
        { id: 10, windowId: window.id, groupId: 7 },
        { id: 11, windowId: window.id, groupId: 7 },
        { id: 12, windowId: window.id, groupId: -1 },
      ] as browser.tabs.Tab[]
    })

    await Tree.tabGroupMoved(movedGroup)

    expect(Tree.getTabs(window.children).map((tab) => tab.id)).toEqual([
      10, 11, 12,
    ])
    expect(groupedParent).toMatchObject({
      parentUid: undefined,
      indentLevel: 1,
      isParent: false,
    })
    expect(groupedChild).toMatchObject({
      parentUid: undefined,
      indentLevel: 1,
    })
    expect(ungroupedParent.isParent).toBe(false)
  })

  it('places a moved group at the hierarchy of its new siblings', async () => {
    const parent = createTab('parent' as UID, {
      id: 20,
      state: State.OPEN,
      isParent: true,
    })
    const before = createTab('before' as UID, {
      id: 21,
      state: State.OPEN,
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const after = createTab('after' as UID, {
      id: 22,
      state: State.OPEN,
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const firstGrouped = createTab('first-grouped' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: group(),
    })
    const secondGrouped = createTab('second-grouped' as UID, {
      id: 11,
      state: State.OPEN,
      tabGroup: group(),
    })
    const window = createWindow(
      'window' as UID,
      [parent, before, after, firstGrouped, secondGrouped],
      { id: 100, state: State.OPEN },
    )
    const movedGroup = {
      id: 7,
      windowId: window.id,
      title: 'Research',
      color: 'blue',
      collapsed: false,
    } satisfies browser.tabGroups.TabGroup
    vi.mocked(browser.tabs.query).mockImplementation(async (queryInfo) => {
      if (queryInfo.groupId === 7) {
        return [
          { id: 10, windowId: window.id, groupId: 7 },
          { id: 11, windowId: window.id, groupId: 7 },
        ] as browser.tabs.Tab[]
      }
      return [
        { id: 20, windowId: window.id, groupId: -1 },
        { id: 21, windowId: window.id, groupId: -1 },
        { id: 10, windowId: window.id, groupId: 7 },
        { id: 11, windowId: window.id, groupId: 7 },
        { id: 22, windowId: window.id, groupId: -1 },
      ] as browser.tabs.Tab[]
    })

    await Tree.tabGroupMoved(movedGroup)

    expect(Tree.getTabs(window.children).map((tab) => tab.id)).toEqual([
      20, 21, 10, 11, 22,
    ])
    expect(firstGrouped).toMatchObject({
      parentUid: parent.uid,
      indentLevel: 2,
    })
    expect(secondGrouped).toMatchObject({
      parentUid: parent.uid,
      indentLevel: 2,
    })
    expect(parent.isParent).toBe(true)
  })

  it('restores all live saved members as one Firefox group', async () => {
    const first = createTab('first' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: group('stable-group', -1),
    })
    const second = createTab('second' as UID, {
      id: 11,
      state: State.OPEN,
      tabGroup: group('stable-group', -1),
    })
    const window = createWindow('window' as UID, [first, second], {
      id: 100,
      state: State.OPEN,
    })
    vi.mocked(browser.tabs.group).mockResolvedValue(23)
    vi.mocked(browser.tabGroups.update).mockResolvedValue({
      id: 23,
      windowId: window.id,
      title: 'Research',
      color: 'blue',
      collapsed: false,
    })
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 10, windowId: window.id, groupId: 23 },
      { id: 11, windowId: window.id, groupId: 23 },
    ] as browser.tabs.Tab[])

    await Tree.restoreWindowTabGroups(window.uid)

    expect(browser.tabs.group).toHaveBeenCalledWith({
      tabIds: [10, 11],
      createProperties: { windowId: window.id },
    })
    expect(first.tabGroup).toEqual(group('stable-group', 23))
    expect(second.tabGroup).toEqual(group('stable-group', 23))
  })

  it('continues restoring later groups when one Firefox grouping call fails', async () => {
    const failedTab = createTab('failed' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: group('failed-group', -1),
    })
    const restoredTab = createTab('restored' as UID, {
      id: 11,
      state: State.OPEN,
      tabGroup: group('restored-group', -1),
    })
    const window = createWindow('window' as UID, [failedTab, restoredTab], {
      id: 100,
      state: State.OPEN,
    })
    vi.mocked(browser.tabs.group).mockImplementation(async ({ tabIds }) => {
      if (tabIds === 10 || (Array.isArray(tabIds) && tabIds.includes(10))) {
        throw new Error('group failed')
      }
      return 24
    })
    vi.mocked(browser.tabGroups.update).mockResolvedValue({
      id: 24,
      windowId: window.id,
      title: 'Research',
      color: 'blue',
      collapsed: false,
    })
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 11, windowId: window.id, groupId: 24 },
    ] as browser.tabs.Tab[])

    const result = await Tree.restoreWindowTabGroups(window.uid)

    expect(browser.tabs.group).toHaveBeenCalledTimes(2)
    expect(failedTab.tabGroup).toEqual(group('failed-group', -1))
    expect(restoredTab.tabGroup).toEqual(group('restored-group', 24))
    expect(result.failures).toEqual([
      expect.objectContaining({
        groupUid: 'failed-group',
        stage: 'group',
      }),
    ])
  })

  it('adopts Firefox group metadata when updating the restored group fails', async () => {
    const tab = createTab('tab' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: group('stable-group', -1),
    })
    const window = createWindow('window' as UID, [tab], {
      id: 100,
      state: State.OPEN,
    })
    vi.mocked(browser.tabs.group).mockResolvedValue(23)
    vi.mocked(browser.tabGroups.update).mockRejectedValue(
      new Error('update failed'),
    )
    vi.mocked(browser.tabGroups.get).mockResolvedValue({
      id: 23,
      windowId: window.id,
      title: 'Firefox title',
      color: 'red',
      collapsed: true,
    })
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 10, windowId: window.id, groupId: 23 },
    ] as browser.tabs.Tab[])

    const result = await Tree.restoreWindowTabGroups(window.uid)

    expect(browser.tabGroups.get).toHaveBeenCalledWith(23)
    expect(tab.tabGroup).toMatchObject({
      uid: 'stable-group',
      id: 23,
      title: 'Firefox title',
      color: 'red',
      collapsed: true,
    })
    expect(result.failures).toEqual([])
  })

  it('retains intended metadata and the live ID when update recovery also fails', async () => {
    const tab = createTab('tab' as UID, {
      id: 10,
      state: State.OPEN,
      tabGroup: group('stable-group', -1),
    })
    const window = createWindow('window' as UID, [tab], {
      id: 100,
      state: State.OPEN,
    })
    vi.mocked(browser.tabs.group).mockResolvedValue(23)
    vi.mocked(browser.tabGroups.update).mockRejectedValue(
      new Error('update failed'),
    )
    vi.mocked(browser.tabGroups.get).mockRejectedValue(new Error('get failed'))

    const result = await Tree.restoreWindowTabGroups(window.uid)

    expect(tab.tabGroup).toEqual(group('stable-group', 23))
    expect(result.failures).toEqual([
      expect.objectContaining({
        groupUid: 'stable-group',
        stage: 'read',
      }),
    ])
  })
})
