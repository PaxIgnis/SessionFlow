import { browser, expect } from '@wdio/globals'
import {
  readStoredSessionTree,
  reloadExtensionBackgroundPage,
  removeTabsByTitles,
  writeStoredSessionTree,
} from './support/extension-lifecycle.mjs'
import { extensionFixtureTitle } from './support/session-fixtures.mjs'
import { SessionTreePage } from './support/session-tree-page.mjs'
import {
  closeSessionTreePopup,
  openSessionTreePopup,
} from './support/session-tree-popup.mjs'

describe('performance and long-running Firefox resilience', () => {
  it('renders and scrolls thousands of visible nested tree items (PF-03)', async () => {
    let originalTree
    let popup
    let sessionTree
    try {
      popup = await openSessionTreePopup()
      originalTree = await readStoredSessionTree()
      await writeStoredSessionTree([...originalTree, largeVisibleWindow(2_000)])
      await reloadExtensionBackgroundPage()
      await closeSessionTreePopup(popup.originalHandle)
      popup = undefined
      popup = await openSessionTreePopup()
      sessionTree = new SessionTreePage()
      await sessionTree.expectLoaded()

      await browser.waitUntil(
        async () =>
          (await browser.execute(
            () => document.querySelectorAll('.tree-item').length,
          )) >= 2_001,
        {
          timeout: 30_000,
          interval: 250,
          timeoutMsg: 'Expected 2,001 rendered tree items within 30 seconds.',
        },
      )

      const scrollResult = await browser.execute(() => {
        const container = document.querySelector('.sessiontree-content')
        const items = [...document.querySelectorAll('.tree-item')]
        const targetItem = document.querySelector(
          '.tree-item[drag-and-drop-id="pf-visible-tab-1999"]',
        )
        if (
          !(container instanceof HTMLElement) ||
          !(targetItem instanceof HTMLElement)
        ) {
          return { ok: false }
        }
        targetItem.scrollIntoView({ block: 'end' })
        return {
          ok: true,
          count: items.length,
          targetUid: targetItem.getAttribute('drag-and-drop-id'),
          scrollTop: container.scrollTop,
          scrollHeight: container.scrollHeight,
          clientHeight: container.clientHeight,
        }
      })

      expect(scrollResult).toMatchObject({
        ok: true,
        targetUid: 'pf-visible-tab-1999',
      })
      expect(scrollResult.count).toBeGreaterThanOrEqual(2_001)
      expect(scrollResult.scrollTop).toBeGreaterThan(0)
      expect(scrollResult.scrollHeight).toBeGreaterThan(
        scrollResult.clientHeight,
      )
    } finally {
      if (popup?.popupHandle) {
        const handles = await browser.getWindowHandles()
        if (handles.includes(popup.popupHandle)) {
          await browser.switchToWindow(popup.popupHandle)
        }
      }
      if (popup?.popupHandle && sessionTree) {
        await sessionTree.sendTreeCommand({
          action: 'closeWindow',
          windowId: -1,
          windowUid: 'pf-visible-window',
        })
        await sessionTree.waitForBackgroundTree(
          (tree) => !tree.some((item) => item.uid === 'pf-visible-window'),
          'Expected the performance fixture to be removed.',
        )
        await writeStoredSessionTree(await sessionTree.backgroundTreeSnapshot())
      }
      if (popup?.popupHandle) {
        const handles = await browser.getWindowHandles()
        if (handles.includes(popup.popupHandle)) {
          await browser.switchToWindow(popup.popupHandle)
          await closeSessionTreePopup(popup.originalHandle)
        }
      }
    }
  })

  it('repeatedly opens and closes the popup without duplicate live views or updates (PF-07)', async () => {
    let popup
    const fixtureTitle = 'SF Popup Lifecycle Stress'
    const title = extensionFixtureTitle(fixtureTitle)
    try {
      for (let cycle = 0; cycle < 10; cycle++) {
        popup = await openSessionTreePopup()
        await closeSessionTreePopup(popup.originalHandle)
        popup = undefined
      }

      popup = await openSessionTreePopup()
      const sessionTree = new SessionTreePage()
      const liveSessionTreeViews = await browser.execute(
        () =>
          window.browser.extension
            .getViews()
            .filter((view) =>
              view.location.pathname.endsWith('/sessiontree.html'),
            ).length,
      )
      expect(liveSessionTreeViews).toBe(1)

      const createResult = await browser.executeAsync((targetTitle, done) => {
        window.browser.windows
          .getAll({ windowTypes: ['normal'] })
          .then((windows) => {
            const targetWindow = windows.find(
              (candidate) => candidate.id !== undefined,
            )
            if (targetWindow?.id === undefined) {
              throw new Error('No normal Firefox window is available.')
            }
            return window.browser.tabs.create({
              active: true,
              windowId: targetWindow.id,
              url:
                window.browser.runtime.getURL('/redirect.html') +
                `?targetTitle=${encodeURIComponent(targetTitle)}`,
            })
          })
          .then((tab) => done({ ok: true, tabId: tab.id }))
          .catch((error) => done({ ok: false, error: String(error) }))
      }, fixtureTitle)
      if (!createResult?.ok) {
        throw new Error(
          createResult?.error || 'Failed to create popup lifecycle fixture.',
        )
      }
      await browser.switchToWindow(popup.popupHandle)
      await sessionTree.waitForBackgroundTree(
        (tree) =>
          tree.some(
            (item) =>
              item.type === 0 &&
              item.children.some(
                (child) => child.type === 1 && child.title === title,
              ),
          ),
        `Expected background tree item "${title}" after popup cycling.`,
        30_000,
      )
      await browser.waitUntil(
        async () => {
          const matchingRows = await browser.execute(
            (expectedTitle) =>
              [...document.querySelectorAll('.tree-item')].filter((item) =>
                item.textContent?.includes(expectedTitle),
              ).length,
            title,
          )
          return matchingRows === 1
        },
        {
          timeout: 30_000,
          timeoutMsg: `Expected one visible tree item "${title}".`,
        },
      )
      const matchingRows = await browser.execute(
        (expectedTitle) =>
          [...document.querySelectorAll('.tree-item')].filter((item) =>
            item.textContent?.includes(expectedTitle),
          ).length,
        title,
      )
      expect(matchingRows).toBe(1)
    } finally {
      if (popup?.popupHandle) {
        const handles = await browser.getWindowHandles()
        if (handles.includes(popup.popupHandle)) {
          await browser.switchToWindow(popup.popupHandle)
        }
      }
      await removeTabsByTitles([title])
      if (popup?.popupHandle) {
        const handles = await browser.getWindowHandles()
        if (handles.includes(popup.popupHandle)) {
          await browser.switchToWindow(popup.popupHandle)
          await closeSessionTreePopup(popup.originalHandle)
        }
      }
    }
  })
})

function largeVisibleWindow(tabCount) {
  const windowUid = 'pf-visible-window'
  return {
    type: 0,
    uid: windowUid,
    id: -1,
    incognito: false,
    selected: false,
    state: 0,
    collapsed: false,
    indentLevel: 0,
    children: Array.from({ length: tabCount }, (_, index) => {
      const depth = (index % 50) + 1
      const parentIndex = depth === 1 ? undefined : index - 1
      return {
        type: 1,
        uid: `pf-visible-tab-${index}`,
        id: -1,
        active: false,
        selected: false,
        state: 0,
        title: `PF visible tab ${index}`,
        url: `https://performance.test/${index}`,
        windowUid,
        indentLevel: depth,
        pinned: false,
        ...(parentIndex === undefined
          ? {}
          : { parentUid: `pf-visible-tab-${parentIndex}` }),
      }
    }),
  }
}
