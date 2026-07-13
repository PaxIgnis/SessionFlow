import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Tree } from '@/services/background-tree'
import { normalizeExternalDropItems } from '@/services/external-drop'
import * as Utils from '@/services/utils'
import type { ImportExternalUrlsMessage } from '@/types/messages'
import { State, TreeItemType } from '@/types/session-tree'

/** Imports externally dragged URLs into an existing tree window or a new one. */
export async function importExternalUrls(
  message: ImportExternalUrlsMessage,
): Promise<void> {
  const items = normalizeExternalDropItems(message.items)
  if (items.length === 0) return

  if (!message.targetWindowUid) {
    const urls = items.map((item) => getBrowserUrl(item.url, item.title))
    const createdWindow = await OnCreatedQueue.createWindowAndWait({
      url: urls,
    })
    if (createdWindow.id === undefined) {
      throw new Error('External drop window creation returned no ID')
    }
    await Tree.addWindow(createdWindow.id)
    return
  }

  const targetWindow = Tree.windowsByUid.get(message.targetWindowUid)
  if (!targetWindow) {
    throw new Error('External drop target window not found')
  }

  const parent = message.parentUid
    ? (Tree.tabsByUid.get(message.parentUid) ??
      Tree.notesByUid.get(message.parentUid))
    : undefined
  if (message.parentUid && (!parent || parent.windowUid !== targetWindow.uid)) {
    throw new Error('External drop parent is not in the target window')
  }

  const requestedIndex = Number.isFinite(message.targetIndex)
    ? Math.trunc(message.targetIndex)
    : targetWindow.children.length
  let targetIndex = Math.max(
    0,
    Math.min(requestedIndex, targetWindow.children.length),
  )
  let parentUid = message.parentUid
  const lastPinnedIndex = targetWindow.children.reduce(
    (lastIndex, item, index) =>
      item.type === TreeItemType.TAB && item.pinned ? index : lastIndex,
    -1,
  )
  if (targetIndex <= lastPinnedIndex) {
    targetIndex = lastPinnedIndex + 1
    parentUid = undefined
  }
  const targetGroup = Tree.savedTabGroup(
    Tree.getDropTabGroup(targetWindow.children, targetIndex, new Set()),
  )
  const importedTabUids: UID[] = []

  for (const [offset, item] of items.entries()) {
    const tabUid = Tree.addTab(
      false,
      targetWindow.uid,
      -1,
      false,
      State.SAVED,
      item.title ?? item.url,
      item.url,
      false,
      targetIndex + offset,
      parentUid,
      undefined,
      true,
      targetGroup,
    )
    if (tabUid) importedTabUids.push(tabUid)
  }

  if (targetWindow.state === State.SAVED) return

  for (const tabUid of importedTabUids) {
    await Tree.openTab({
      tabUid,
      windowUid: targetWindow.uid,
    })
  }
}

function getBrowserUrl(url: string, title?: string): string {
  return Utils.isPrivilegedUrl(url)
    ? Utils.getRedirectUrl(url, title ?? url)
    : url
}
