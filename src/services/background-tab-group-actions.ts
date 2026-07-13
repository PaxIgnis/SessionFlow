import { Tree } from '@/services/background-tree'
import { emitTreeDelta } from '@/services/runtime-port-service'
import { Settings } from '@/services/settings'
import * as Utils from '@/services/utils'
import {
  State,
  Tab,
  TabGroupMetadata,
  TreeItem,
  TreeItemType,
} from '@/types/session-tree'

const NO_GROUP = -1
const groupsByBrowserId = new Map<number, TabGroupMetadata>()

function cloneGroup(
  group: TabGroupMetadata,
  id: number = group.id,
): TabGroupMetadata {
  return { ...group, id }
}

function findTreeTabByBrowserId(
  tabId: number,
  windowId?: number,
): Tab | undefined {
  const matches = [...Tree.tabsByUid.values()].filter((tab) => tab.id === tabId)
  if (windowId === undefined) return matches[0]

  return matches.find(
    (tab) => Tree.windowsByUid.get(tab.windowUid)?.id === windowId,
  )
}

function isLiveTab(tab: Tab): boolean {
  return tab.state === State.OPEN || tab.state === State.DISCARDED
}

function toMetadata(
  group: browser.tabGroups.TabGroup,
  uid: UID,
): TabGroupMetadata {
  return {
    uid,
    id: group.id,
    title: group.title,
    color: group.color,
    collapsed: group.collapsed,
  }
}

/** Synchronizes all currently open Firefox groups into the persisted tree. */
export async function syncOpenTabGroups(): Promise<void> {
  const [browserTabs, browserGroups] = await Promise.all([
    browser.tabs.query({}),
    browser.tabGroups.query({}),
  ])

  for (const browserTab of browserTabs) {
    if (browserTab.id === undefined) continue
    if ((browserTab.groupId ?? NO_GROUP) !== NO_GROUP) continue
    const treeTab = findTreeTabByBrowserId(browserTab.id, browserTab.windowId)
    if (treeTab?.tabGroup) {
      Tree.updateTab({ tabUid: treeTab.uid }, { tabGroup: undefined })
    }
  }

  for (const group of browserGroups) {
    await syncBrowserTabGroup(group)
  }
}

/** Synchronizes one Firefox group and preserves its stable Session tree UID. */
export async function syncBrowserTabGroup(
  group: browser.tabGroups.TabGroup,
): Promise<boolean> {
  const browserTabs = await browser.tabs.query({ groupId: group.id })
  const memberTabs = browserTabs
    .map((tab) =>
      tab.id === undefined
        ? undefined
        : findTreeTabByBrowserId(tab.id, tab.windowId),
    )
    .filter((tab): tab is Tab => Boolean(tab))

  const existingMetadata =
    memberTabs.find((tab) => tab.tabGroup)?.tabGroup ??
    [...Tree.tabsByUid.values()].find((tab) => tab.tabGroup?.id === group.id)
      ?.tabGroup ??
    groupsByBrowserId.get(group.id)
  const uid = existingMetadata?.uid ?? Utils.createUid(Tree.existingUidsSet)
  const metadata = toMetadata(group, uid)
  groupsByBrowserId.set(group.id, metadata)

  const liveMemberUids = new Set(memberTabs.map((tab) => tab.uid))
  for (const tab of Tree.tabsByUid.values()) {
    if (tab.tabGroup?.uid !== uid && !liveMemberUids.has(tab.uid)) continue
    Tree.updateTab(
      { tabUid: tab.uid },
      {
        tabGroup: cloneGroup(
          metadata,
          liveMemberUids.has(tab.uid) ? group.id : NO_GROUP,
        ),
      },
    )
  }

  return memberTabs.length === browserTabs.length
}

/** Applies a Firefox tab membership change to its tree tab. */
export async function tabGroupMembershipChanged(
  tabId: number,
  groupId: number,
): Promise<void> {
  const tab = findTreeTabByBrowserId(tabId)
  if (!tab) return

  if (groupId === NO_GROUP) {
    if (tab.tabGroup) {
      Tree.updateTab({ tabUid: tab.uid }, { tabGroup: undefined })
    }
    return
  }

  const group = await browser.tabGroups.get(groupId)
  await syncBrowserTabGroup(group)
}

/** Updates metadata when Firefox changes a group's title, color, or state. */
export function tabGroupUpdated(group: browser.tabGroups.TabGroup): void {
  void syncBrowserTabGroup(group).catch((error) => {
    console.error('Error synchronizing tab group:', error)
  })
}

/** Reconciles a moved group after Firefox finishes rebuilding its window. */
export async function tabGroupMoved(
  group: browser.tabGroups.TabGroup,
  retries: number = 5,
): Promise<void> {
  const metadataSynchronized = await syncBrowserTabGroup(group)
  const orderSynchronized = await syncBrowserWindowTabOrder(
    group.windowId,
    group.id,
  )
  if ((metadataSynchronized && orderSynchronized) || retries <= 0) return

  setTimeout(() => {
    void tabGroupMoved(group, retries - 1).catch((error) => {
      console.error('Error synchronizing moved tab group:', error)
    })
  }, 50)
}

/** Reorders every live tree-tab slot to match Firefox's final window order. */
export async function syncBrowserWindowTabOrder(
  windowId: number,
  movedGroupId?: number,
): Promise<boolean> {
  const window = [...Tree.windowsByUid.values()].find(
    (candidate) => candidate.id === windowId,
  )
  if (!window) return false

  const browserTabs = await browser.tabs.query({ windowId })
  const liveTabs = Tree.getTabs(window.children).filter(isLiveTab)
  if (browserTabs.length !== liveTabs.length) return false

  const liveTabsById = new Map(liveTabs.map((tab) => [tab.id, tab] as const))
  const orderedTabs = browserTabs
    .map((tab) => (tab.id === undefined ? undefined : liveTabsById.get(tab.id)))
    .filter((tab): tab is Tab => Boolean(tab))
  if (orderedTabs.length !== liveTabs.length) return false

  const liveTabSlots = window.children
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.type === TreeItemType.TAB && isLiveTab(item))
    .map(({ index }) => index)
  const orderChanged = liveTabSlots.some(
    (slot, index) => window.children[slot].uid !== orderedTabs[index].uid,
  )
  const movedGroupTabs =
    movedGroupId === undefined
      ? []
      : orderedTabs.filter((tab) => tab.tabGroup?.id === movedGroupId)
  const movedGroupUids = new Set(movedGroupTabs.map((tab) => tab.uid))
  const firstMovedIndex = orderedTabs.findIndex((tab) =>
    movedGroupUids.has(tab.uid),
  )
  const lastMovedIndex = orderedTabs.findLastIndex((tab) =>
    movedGroupUids.has(tab.uid),
  )
  const destinationSibling =
    firstMovedIndex === -1
      ? undefined
      : (orderedTabs[lastMovedIndex + 1] ?? orderedTabs[firstMovedIndex - 1])
  let destinationParentUid = destinationSibling?.parentUid
  let destinationIndentLevel = destinationSibling?.indentLevel ?? 1
  if (
    destinationParentUid !== undefined &&
    movedGroupUids.has(destinationParentUid)
  ) {
    const movedParent = Tree.tabsByUid.get(destinationParentUid)
    destinationParentUid = movedParent?.parentUid
    destinationIndentLevel = movedParent?.indentLevel ?? 1
  }

  const affectedParentUids = new Set<UID>()
  if (destinationParentUid !== undefined) {
    affectedParentUids.add(destinationParentUid)
  }
  let hierarchyChanged = false

  for (const [index, slot] of liveTabSlots.entries()) {
    const tab = orderedTabs[index]
    window.children[slot] = tab
    if (movedGroupId !== undefined && tab.tabGroup?.id === movedGroupId) {
      if (tab.parentUid !== undefined) {
        affectedParentUids.add(tab.parentUid)
      }
      hierarchyChanged ||=
        tab.parentUid !== destinationParentUid ||
        tab.indentLevel !== destinationIndentLevel
      tab.parentUid = destinationParentUid
      tab.indentLevel = destinationIndentLevel
    }
  }

  for (const parentUid of affectedParentUids) {
    const parent =
      Tree.tabsByUid.get(parentUid) ?? Tree.notesByUid.get(parentUid)
    if (!parent) continue

    const isParent = Tree.hasChildrenInContainer(parent, window.children)
    if (parent.isParent === isParent) continue

    hierarchyChanged = true
    if (parent.type === TreeItemType.TAB) {
      Tree.updateTab({ tabUid: parent.uid }, { isParent }, false)
    } else {
      Tree.updateNote(parent.uid, { isParent }, false)
    }
  }

  if (orderChanged || hierarchyChanged) {
    Tree.recomputeSessionTree(false)
    emitTreeDelta({
      op: 'windowUpdated',
      window: structuredClone(window),
    })
  }
  return true
}

/** Clears live membership when Firefox removes a group, preserving saved tabs. */
export function tabGroupRemoved(
  group: browser.tabGroups.TabGroup,
  saveTabs: boolean = false,
): void {
  const metadata = groupsByBrowserId.get(group.id)
  groupsByBrowserId.delete(group.id)

  for (const tab of Tree.tabsByUid.values()) {
    if (tab.tabGroup?.id !== group.id) continue
    if (saveTabs && isLiveTab(tab)) {
      Tree.setTabSaved(tab.uid)
      continue
    }
    Tree.updateTab(
      { tabUid: tab.uid },
      {
        tabGroup:
          tab.state === State.SAVED && metadata
            ? cloneGroup(metadata, NO_GROUP)
            : undefined,
      },
    )
  }
}

/** Preserves group metadata while Firefox closes the group's browser window. */
export function tabGroupWindowClosed(group: browser.tabGroups.TabGroup): void {
  groupsByBrowserId.delete(group.id)

  for (const tab of Tree.tabsByUid.values()) {
    if (tab.tabGroup?.id !== group.id) continue
    Tree.updateTab(
      { tabUid: tab.uid },
      { tabGroup: cloneGroup(tab.tabGroup, NO_GROUP) },
    )
  }
}

/** Marks a tab's group identity as saved rather than browser-backed. */
export function savedTabGroup(
  group: TabGroupMetadata | undefined,
): TabGroupMetadata | undefined {
  return group ? cloneGroup(group, NO_GROUP) : undefined
}

/** Recreates or rejoins the persisted group for a newly opened saved tab. */
export async function restoreTabGroup(tabUid: UID): Promise<void> {
  const tab = Tree.tabsByUid.get(tabUid)
  if (!tab?.tabGroup || !isLiveTab(tab) || tab.id < 0) return

  await restoreWindowTabGroups(tab.windowUid)
}

/** Recreates every persisted group whose tabs are live in a window. */
export async function restoreWindowTabGroups(windowUid: UID): Promise<void> {
  const targetWindow = Tree.windowsByUid.get(windowUid)
  if (!targetWindow || targetWindow.id < 0) return

  const groupedTabs = new Map<UID, Tab[]>()
  for (const tab of Tree.getTabs(targetWindow.children)) {
    if (!tab.tabGroup || !isLiveTab(tab) || tab.id < 0) continue
    const members = groupedTabs.get(tab.tabGroup.uid) ?? []
    members.push(tab)
    groupedTabs.set(tab.tabGroup.uid, members)
  }

  for (const tabs of groupedTabs.values()) {
    const persistedGroup = cloneGroup(tabs[0].tabGroup!, NO_GROUP)
    const tabIds = tabs.map((tab) => tab.id)
    const existingGroupId = tabs.find(
      (tab) => (tab.tabGroup?.id ?? NO_GROUP) !== NO_GROUP,
    )?.tabGroup?.id

    let groupId: number
    if (existingGroupId !== undefined) {
      try {
        groupId = await browser.tabs.group({
          groupId: existingGroupId,
          tabIds,
        })
      } catch {
        groupId = await browser.tabs.group({
          tabIds,
          createProperties: { windowId: targetWindow.id },
        })
      }
    } else {
      groupId = await browser.tabs.group({
        tabIds,
        createProperties: { windowId: targetWindow.id },
      })
    }

    const updatedGroup = await browser.tabGroups.update(groupId, {
      title: persistedGroup.title,
      color: persistedGroup.color,
      collapsed: persistedGroup.collapsed,
    })
    await syncBrowserTabGroup(updatedGroup)
  }
}

/**
 * Resolves group membership from the direct tree items around a drop point.
 * Notes and separators intentionally break adjacency.
 */
export function getDropTabGroup(
  children: TreeItem[],
  targetIndex: number,
  movedItemUids: Set<UID>,
): TabGroupMetadata | undefined {
  const remaining = children.filter((item) => !movedItemUids.has(item.uid))
  const removedBeforeTarget = children
    .slice(0, targetIndex)
    .filter((item) => movedItemUids.has(item.uid)).length
  const adjustedIndex = Math.max(
    0,
    Math.min(targetIndex - removedBeforeTarget, remaining.length),
  )
  const above = remaining[adjustedIndex - 1]
  const below = remaining[adjustedIndex]
  const aboveGroup =
    above?.type === TreeItemType.TAB ? above.tabGroup : undefined
  const belowGroup =
    below?.type === TreeItemType.TAB ? below.tabGroup : undefined

  if (aboveGroup && belowGroup) {
    return aboveGroup.uid === belowGroup.uid
      ? cloneGroup(aboveGroup)
      : undefined
  }
  if (Settings.values.tabGroupDropBehavior === 'any-adjacent-group') {
    return aboveGroup
      ? cloneGroup(aboveGroup)
      : belowGroup && cloneGroup(belowGroup)
  }
  return undefined
}

/** Applies the resolved drop group to every moved tab, including descendants. */
export async function applyDropTabGroup(
  tabUids: UID[],
  targetWindowUid: UID,
  targetGroup: TabGroupMetadata | undefined,
  sourceTabGroups: ReadonlyMap<UID, TabGroupMetadata | undefined> = new Map(),
): Promise<void> {
  const movedTabs = tabUids
    .map((uid) => Tree.tabsByUid.get(uid))
    .filter((tab): tab is Tab => Boolean(tab))
  const liveTabs = movedTabs.filter(isLiveTab)
  const liveTabIds = liveTabs.map((tab) => tab.id).filter((id) => id >= 0)
  const movedTabSourceGroup =
    movedTabs.length === 1
      ? (movedTabs[0].tabGroup ?? sourceTabGroups.get(movedTabs[0].uid))
      : undefined
  const existingSoleGroup =
    !targetGroup && movedTabSourceGroup ? movedTabSourceGroup : undefined
  const preserveSoleGroup =
    existingSoleGroup !== undefined &&
    ![...Tree.tabsByUid.values()].some(
      (tab) =>
        tab.uid !== movedTabs[0].uid &&
        tab.tabGroup?.uid === existingSoleGroup.uid,
    )
  const effectiveTargetGroup =
    targetGroup ??
    (preserveSoleGroup ? cloneGroup(existingSoleGroup) : undefined)

  if (!effectiveTargetGroup) {
    for (const tab of movedTabs) {
      Tree.updateTab({ tabUid: tab.uid }, { tabGroup: undefined })
    }
    if (liveTabIds.length > 0) await browser.tabs.ungroup(liveTabIds)
    return
  }

  const existingLiveMember = [...Tree.tabsByUid.values()].find(
    (tab) =>
      !tabUids.includes(tab.uid) &&
      tab.windowUid === targetWindowUid &&
      tab.tabGroup?.uid === effectiveTargetGroup.uid &&
      tab.tabGroup.id !== NO_GROUP &&
      isLiveTab(tab),
  )

  let groupId = existingLiveMember?.tabGroup?.id
  if (liveTabIds.length > 0) {
    const targetBrowserWindowId = Tree.windowsByUid.get(targetWindowUid)?.id
    if (groupId === undefined && (targetBrowserWindowId ?? -1) < 0) return
    groupId = await browser.tabs.group({
      tabIds: liveTabIds,
      ...(groupId !== undefined ? { groupId } : {}),
      ...(groupId === undefined
        ? { createProperties: { windowId: targetBrowserWindowId } }
        : {}),
    })
    const updatedGroup = await browser.tabGroups.update(groupId, {
      title: effectiveTargetGroup.title,
      color: effectiveTargetGroup.color,
      collapsed: effectiveTargetGroup.collapsed,
    })
    groupsByBrowserId.set(
      groupId,
      toMetadata(updatedGroup, effectiveTargetGroup.uid),
    )
  }

  const liveUidSet = new Set(liveTabs.map((tab) => tab.uid))
  for (const tab of movedTabs) {
    Tree.updateTab(
      { tabUid: tab.uid },
      {
        tabGroup: cloneGroup(
          effectiveTargetGroup,
          liveUidSet.has(tab.uid) && groupId !== undefined ? groupId : NO_GROUP,
        ),
      },
    )
  }
}

export function resetTabGroupState(): void {
  groupsByBrowserId.clear()
}
