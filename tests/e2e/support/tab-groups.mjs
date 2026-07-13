import { browser } from '@wdio/globals'

export async function createNativeTabGroup(
  titles,
  { title = 'SessionFlow E2E Group', color = 'blue', collapsed = false } = {},
) {
  const response = await browser.executeAsync(
    (targetTitles, groupProperties, done) => {
      window.browser.tabs
        .query({})
        .then(async (tabs) => {
          const matchingTabs = targetTitles.map((targetTitle) =>
            tabs.find((tab) => tab.title === targetTitle),
          )
          if (matchingTabs.some((tab) => !tab?.id)) {
            throw new Error(
              `Could not find every tab to group: ${targetTitles.join(', ')}`,
            )
          }

          const windowIds = new Set(matchingTabs.map((tab) => tab.windowId))
          if (windowIds.size !== 1) {
            throw new Error('All grouped fixture tabs must be in one window.')
          }

          const windowId = matchingTabs[0].windowId
          const tabIds = matchingTabs.map((tab) => tab.id)
          const groupId = await window.browser.tabs.group({
            tabIds,
            createProperties: { windowId },
          })
          const group = await window.browser.tabGroups.update(
            groupId,
            groupProperties,
          )
          done({ ok: true, group, tabIds })
        })
        .catch((error) => done({ ok: false, error: String(error) }))
    },
    titles,
    { title, color, collapsed },
  )

  if (!response.ok) {
    throw new Error(response.error || 'Failed to create native tab group.')
  }
  return response
}

export async function moveNativeTabGroup(groupId, index, windowId) {
  const response = await browser.executeAsync(
    (targetGroupId, targetIndex, targetWindowId, done) => {
      window.browser.tabGroups
        .move(targetGroupId, {
          index: targetIndex,
          ...(targetWindowId === undefined ? {} : { windowId: targetWindowId }),
        })
        .then((group) => done({ ok: true, group }))
        .catch((error) => done({ ok: false, error: String(error) }))
    },
    groupId,
    index,
    windowId,
  )

  if (!response.ok) {
    throw new Error(response.error || 'Failed to move native tab group.')
  }
  return response.group
}

export async function removeBrowserTabsByTitle(titles) {
  const response = await browser.executeAsync((targetTitles, done) => {
    window.browser.tabs
      .query({})
      .then(async (tabs) => {
        const tabIds = targetTitles
          .map((title) => tabs.find((tab) => tab.title === title)?.id)
          .filter((tabId) => tabId !== undefined)
        if (tabIds.length !== targetTitles.length) {
          throw new Error(
            `Could not find every tab to remove: ${targetTitles.join(', ')}`,
          )
        }
        await window.browser.tabs.remove(tabIds)
        done({ ok: true })
      })
      .catch((error) => done({ ok: false, error: String(error) }))
  }, titles)

  if (!response.ok) {
    throw new Error(response.error || 'Failed to remove browser tabs.')
  }
}

export async function nativeTabGroupSnapshot(titles) {
  const response = await browser.executeAsync((targetTitles, done) => {
    window.browser.tabs
      .query({})
      .then(async (tabs) => {
        const matchingTabs = targetTitles
          .map((title) => tabs.find((tab) => tab.title === title))
          .filter(Boolean)
          .map((tab) => ({
            id: tab.id,
            groupId: tab.groupId,
            index: tab.index,
            title: tab.title,
            windowId: tab.windowId,
          }))
        const groupIds = [
          ...new Set(
            matchingTabs
              .map((tab) => tab.groupId)
              .filter((groupId) => groupId !== undefined && groupId !== -1),
          ),
        ]
        const groups = await Promise.all(
          groupIds.map((groupId) => window.browser.tabGroups.get(groupId)),
        )
        done({ ok: true, groups, tabs: matchingTabs })
      })
      .catch((error) => done({ ok: false, error: String(error) }))
  }, titles)

  if (!response.ok) {
    throw new Error(response.error || 'Failed to inspect native tab groups.')
  }
  return response
}

export async function browserWindowIdContainingTitle(title) {
  const snapshot = await nativeTabGroupSnapshot([title])
  const windowId = snapshot.tabs[0]?.windowId
  if (windowId === undefined) {
    throw new Error(`Could not find browser window containing "${title}".`)
  }
  return windowId
}

export async function browserTabTitlesInWindow(windowId) {
  const response = await browser.executeAsync((targetWindowId, done) => {
    window.browser.tabs
      .query({ windowId: targetWindowId })
      .then((tabs) =>
        done({
          ok: true,
          titles: tabs
            .sort((left, right) => left.index - right.index)
            .map((tab) => tab.title),
        }),
      )
      .catch((error) => done({ ok: false, error: String(error) }))
  }, windowId)

  if (!response.ok) {
    throw new Error(response.error || 'Failed to inspect browser tab order.')
  }
  return response.titles
}
