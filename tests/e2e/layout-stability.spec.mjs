import { $, $$, browser, expect } from '@wdio/globals'
import { closeOptionsPage, openOptionsPage } from './support/options-page.mjs'
import {
  closeSessionTreePopupHandle,
  openSessionTreePopup,
} from './support/session-tree-popup.mjs'
import { sendSnapshotRequest } from './support/session-snapshots.mjs'

const storageSampleCount = 36
const popupSampleLimit = 180

describe('layout stability', () => {
  it('keeps the storage snapshot browser within the options panel while a large snapshot loads', async () => {
    const options = await openOptionsPage()
    try {
      await sendSnapshotRequest({ action: 'clearSessionSnapshots' })
      await importLargeSnapshot('wide-a')
      await importLargeSnapshot('wide-b')
      await browser.refresh()
      await options.page.expectLoaded()
      await options.page.selectSection('settings_storage')
      await expect($('.snapshot-entry')).toBeDisplayed()
      await browser.waitUntil(
        async () => (await $$('.snapshot-tree .tree-item')).length > 100,
        {
          timeout: 10_000,
          timeoutMsg:
            'Expected the imported snapshot tree to render many rows.',
        },
      )

      const samples = await browser.executeAsync((frames, done) => {
        const entries = Array.from(document.querySelectorAll('.snapshot-entry'))
        const target =
          entries.find((entry) => !entry.classList.contains('active')) ??
          entries[0]
        const panel = document.querySelector('.content-panel')
        const toolbar = document.querySelector('.snapshot-toolbar')
        const browserElement = document.querySelector('.snapshot-browser')
        const section = document.querySelector('#settings_storage')
        const history = document.querySelector('.snapshot-history')
        const collected = []

        const collect = () => {
          const treeScroll = document.querySelector('.snapshot-tree-scroll')
          const panelRect = panel?.getBoundingClientRect()
          const toolbarRect = toolbar?.getBoundingClientRect()
          const browserRect = browserElement?.getBoundingClientRect()
          const sectionRect = section?.getBoundingClientRect()
          const historyRect = history?.getBoundingClientRect()
          const treeScrollRect = treeScroll?.getBoundingClientRect()
          const snapshotEntryRight = maxRight('.snapshot-entry')
          const treeRowRight = maxRight('.snapshot-tree .tree-item-content')
          collected.push({
            missingElements: [
              panel,
              toolbar,
              browserElement,
              section,
              history,
            ].filter((element) => !element).length,
            viewportWidth: window.innerWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            panelClientWidth: panel?.clientWidth ?? 0,
            panelScrollWidth: panel?.scrollWidth ?? 0,
            panelRight: panelRect?.right ?? 0,
            sectionRight: sectionRect?.right ?? 0,
            toolbarRight: toolbarRect?.right ?? 0,
            toolbarWidth: toolbarRect?.width ?? 0,
            browserRight: browserRect?.right ?? 0,
            browserWidth: browserRect?.width ?? 0,
            historyClientRight:
              historyRect && history
                ? historyRect.left + history.clientWidth
                : 0,
            snapshotEntryRight,
            treeScrollClientRight:
              treeScrollRect && treeScroll
                ? treeScrollRect.left + treeScroll.clientWidth
                : 0,
            treeRowRight,
          })
          if (collected.length >= frames) done(collected)
          else requestAnimationFrame(collect)
        }

        target?.click()
        requestAnimationFrame(collect)

        function maxRight(selector) {
          return Math.max(
            0,
            ...Array.from(document.querySelectorAll(selector)).map(
              (element) => element.getBoundingClientRect().right,
            ),
          )
        }
      }, storageSampleCount)

      expect(samples.length).toBe(storageSampleCount)
      expect(Math.max(...samples.map((sample) => sample.missingElements))).toBe(
        0,
      )
      const storageOverflow = maxStorageOverflow(samples)
      if (storageOverflow > 1) {
        throw new Error(JSON.stringify(maxStorageOverflowDetails(samples)))
      }
      expect(storageOverflow).toBeLessThanOrEqual(1)
      expect(
        range(samples.map((sample) => sample.toolbarWidth)),
      ).toBeLessThanOrEqual(1)
      expect(
        range(samples.map((sample) => sample.browserWidth)),
      ).toBeLessThanOrEqual(1)
    } finally {
      await sendSnapshotRequest({ action: 'clearSessionSnapshots' }).catch(
        () => undefined,
      )
      await closeOptionsPage(options.optionsHandle, options.originalHandle)
    }
  })

  it('keeps the session tree popup width stable while the options page reloads', async () => {
    const popup = await openSessionTreePopup()
    let options
    try {
      await browser.switchToWindow(popup.popupHandle)
      await expect($('.sessiontree')).toBeDisplayed()
      await expect($('.sessiontree-content')).toBeDisplayed()
      await browser.execute((limit) => {
        window.__sessionFlowLayoutSamples = []
        window.__sessionFlowStopLayoutSampling = false

        const collect = () => {
          const root = document.querySelector('#sessiontree')
          const sessionTree = document.querySelector('.sessiontree')
          const content = document.querySelector('.sessiontree-content')
          const firstRow = document.querySelector('.tree-item-content')
          const rootRect = root?.getBoundingClientRect()
          const treeRect = sessionTree?.getBoundingClientRect()
          const contentRect = content?.getBoundingClientRect()
          const firstRowRect = firstRow?.getBoundingClientRect()
          window.__sessionFlowLayoutSamples.push({
            missingElements: [root, sessionTree, content].filter(
              (element) => !element,
            ).length,
            viewportWidth: window.innerWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            rootRight: rootRect?.right ?? 0,
            rootWidth: rootRect?.width ?? 0,
            treeRight: treeRect?.right ?? 0,
            treeWidth: treeRect?.width ?? 0,
            contentClientRight:
              contentRect && content
                ? contentRect.left + content.clientWidth
                : 0,
            contentRight: contentRect?.right ?? 0,
            contentWidth: contentRect?.width ?? 0,
            contentClientWidth: content?.clientWidth ?? 0,
            firstRowRight: firstRowRect?.right ?? 0,
          })
          if (
            !window.__sessionFlowStopLayoutSampling &&
            window.__sessionFlowLayoutSamples.length < limit
          ) {
            window.setTimeout(collect, 16)
          }
        }

        collect()
      }, popupSampleLimit)

      await browser.switchToWindow(popup.originalHandle)
      options = await openOptionsPage()
      await browser.refresh()
      await options.page.expectLoaded()
      await browser.pause(500)

      await browser.switchToWindow(popup.popupHandle)
      const samples = await browser.execute(() => {
        window.__sessionFlowStopLayoutSampling = true
        return window.__sessionFlowLayoutSamples ?? []
      })

      expect(samples.length).toBeGreaterThan(5)
      expect(Math.max(...samples.map((sample) => sample.missingElements))).toBe(
        0,
      )
      expect(maxPopupOverflow(samples)).toBeLessThanOrEqual(1)
      expect(
        range(samples.map((sample) => sample.treeWidth)),
      ).toBeLessThanOrEqual(1)
      expect(
        range(samples.map((sample) => sample.contentClientWidth)),
      ).toBeLessThanOrEqual(1)
    } finally {
      if (options) {
        await closeOptionsPage(options.optionsHandle, popup.popupHandle)
      }
      await closeSessionTreePopupHandle(popup.popupHandle, popup.originalHandle)
    }
  })
})

async function importLargeSnapshot(prefix) {
  const response = await sendSnapshotRequest({
    action: 'importSessionSnapshot',
    json: JSON.stringify(buildLargeSnapshotPayload(prefix)),
  })
  expect(response.ok).toBe(true)
}

function buildLargeSnapshotPayload(prefix) {
  const windowUid = `${prefix}-window`
  return {
    schemaVersion: 1,
    items: [
      {
        type: 0,
        uid: windowUid,
        incognito: false,
        state: 0,
        indentLevel: 0,
        title: `Large imported snapshot ${prefix}`,
        children: Array.from({ length: 140 }, (_, index) => ({
          type: 1,
          uid: `${prefix}-tab-${index}`,
          state: 0,
          title: `Research tab ${String(index + 1).padStart(3, '0')} with a deliberately long title that must stay clear of the scrollbar`,
          url: `https://example.com/research/${index}`,
          windowUid,
          indentLevel: 1,
          pinned: index % 17 === 0,
        })),
      },
    ],
  }
}

function maxStorageOverflow(samples) {
  return Math.max(
    ...samples.map((sample) =>
      Math.max(
        0,
        sample.documentScrollWidth - sample.viewportWidth,
        sample.bodyScrollWidth - sample.viewportWidth,
        sample.panelScrollWidth - sample.panelClientWidth,
        sample.sectionRight - sample.panelRight,
        sample.toolbarRight - sample.panelRight,
        sample.browserRight - sample.panelRight,
        sample.snapshotEntryRight - sample.historyClientRight,
        sample.treeRowRight - sample.treeScrollClientRight,
      ),
    ),
  )
}

function maxPopupOverflow(samples) {
  return Math.max(
    ...samples.map((sample) =>
      Math.max(
        0,
        sample.documentScrollWidth - sample.viewportWidth,
        sample.bodyScrollWidth - sample.viewportWidth,
        sample.rootRight - sample.viewportWidth,
        sample.treeRight - sample.viewportWidth,
        sample.contentRight - sample.viewportWidth,
        sample.firstRowRight - sample.contentClientRight,
      ),
    ),
  )
}

function range(values) {
  return Math.max(...values) - Math.min(...values)
}

function maxStorageOverflowDetails(samples) {
  const details = samples.map((sample, index) => ({
    index,
    document: sample.documentScrollWidth - sample.viewportWidth,
    body: sample.bodyScrollWidth - sample.viewportWidth,
    panel: sample.panelScrollWidth - sample.panelClientWidth,
    section: sample.sectionRight - sample.panelRight,
    toolbar: sample.toolbarRight - sample.panelRight,
    browser: sample.browserRight - sample.panelRight,
    entry: sample.snapshotEntryRight - sample.historyClientRight,
    treeRow: sample.treeRowRight - sample.treeScrollClientRight,
    sample,
  }))
  return details.reduce((worst, current) => {
    const currentMax = Math.max(
      current.document,
      current.body,
      current.panel,
      current.section,
      current.toolbar,
      current.browser,
      current.entry,
      current.treeRow,
    )
    const worstMax = Math.max(
      worst.document,
      worst.body,
      worst.panel,
      worst.section,
      worst.toolbar,
      worst.browser,
      worst.entry,
      worst.treeRow,
    )
    return currentMax > worstMax ? current : worst
  }, details[0])
}
