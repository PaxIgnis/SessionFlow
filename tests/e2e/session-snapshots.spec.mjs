import { $, $$, browser, expect } from '@wdio/globals'
import { closeOptionsPage, openOptionsPage } from './support/options-page.mjs'
import {
  readPersistedSessionTree,
  readSnapshotAlarm,
  sendSnapshotRequest,
} from './support/session-snapshots.mjs'

describe('session snapshot workflows', () => {
  it('creates, browses, exports, and restores a protected manual snapshot', async () => {
    const options = await openOptionsPage()
    try {
      await sendSnapshotRequest({ action: 'clearSessionSnapshots' })
      await browser.refresh()
      await options.page.expectLoaded()
      await options.page.selectSection('settings_storage')

      const section = await $('#settings_storage')
      await expect(section).toBeDisplayed()
      const createButton = await $('[data-testid="create-snapshot"]')
      await expect(createButton).toBeEnabled()
      await createButton.click()

      const snapshotEntry = await $('.snapshot-entry')
      await browser.waitUntil(() => snapshotEntry.isDisplayed(), {
        timeout: 15_000,
        timeoutMsg: 'Expected the manual snapshot to appear in Storage.',
      })
      await expect($('.snapshot-preview')).toBeDisplayed()

      const list = await sendSnapshotRequest({ action: 'listSessionSnapshots' })
      expect(list.ok).toBe(true)
      expect(list.data.snapshots).toHaveLength(1)
      expect(list.data.snapshots[0]).toMatchObject({
        trigger: 'manual',
        protected: true,
        available: true,
      })
      const snapshotId = list.data.snapshots[0].id
      expect(await snapshotEntry.$$('button')).toHaveLength(0)

      let recordActions = await $('.snapshot-record-actions')
      await (await recordActions.$('button=Unprotect')).click()
      await browser.waitUntil(
        async () => {
          const current = await sendSnapshotRequest({
            action: 'listSessionSnapshots',
          })
          return current.data.snapshots[0]?.protected === false
        },
        { timeout: 10_000, timeoutMsg: 'Expected snapshot to be unprotected.' },
      )
      recordActions = await $('.snapshot-record-actions')
      await (await recordActions.$('button=Protect')).click()
      await browser.waitUntil(
        async () => {
          const current = await sendSnapshotRequest({
            action: 'listSessionSnapshots',
          })
          return current.data.snapshots[0]?.protected === true
        },
        { timeout: 10_000, timeoutMsg: 'Expected snapshot to be protected.' },
      )

      const exported = await sendSnapshotRequest({
        action: 'getSessionSnapshotExport',
        snapshotId,
      })
      expect(exported).toMatchObject({
        ok: true,
        data: {
          format: 'session-flow-snapshot',
          schemaVersion: 1,
          metadata: { id: snapshotId },
        },
      })

      const selectedActions = await $('.snapshot-selected-actions')
      await (await selectedActions.$('button=Copy JSON')).click()
      const successToast = await $('.snapshot-success-toast')
      await expect(successToast).toBeDisplayed()
      await expect(successToast).toHaveText('Snapshot JSON copied.')
      await browser.waitUntil(async () => !(await successToast.isDisplayed()), {
        timeout: 5_000,
        timeoutMsg: 'Expected the snapshot success toast to disappear.',
      })

      const handlesBefore = await browser.getWindowHandles()
      const activeTreeBefore = await readPersistedSessionTree()
      const restored = await sendSnapshotRequest({
        action: 'restoreSessionSnapshot',
        snapshotId,
        mode: 'all',
        selectedUids: [],
        allowWithoutSafetySnapshot: false,
      })

      expect(restored.ok).toBe(true)
      const activeTreeAfter = await readPersistedSessionTree()
      expect(activeTreeAfter.length).toBeGreaterThan(activeTreeBefore.length)
      expect(await browser.getWindowHandles()).toEqual(handlesBefore)

      await (await $('button=Delete all snapshots')).click()
      const deleteDialog = await $('[role="dialog"]')
      await expect(deleteDialog).toBeDisplayed()
      await (await deleteDialog.$('button=Delete All')).click()
      await browser.waitUntil(
        async () => {
          const current = await sendSnapshotRequest({
            action: 'listSessionSnapshots',
          })
          return current.data.snapshots.length === 0
        },
        {
          timeout: 10_000,
          timeoutMsg: 'Expected all snapshots to be deleted.',
        },
      )
    } finally {
      await sendSnapshotRequest({ action: 'clearSessionSnapshots' })
      await closeOptionsPage(options.optionsHandle, options.originalHandle)
    }
  })

  it('restores one selected child inside a minimal saved window', async () => {
    const options = await openOptionsPage()
    try {
      await sendSnapshotRequest({ action: 'clearSessionSnapshots' })
      const created = await sendSnapshotRequest({
        action: 'createSessionSnapshot',
      })
      expect(created.ok).toBe(true)
      const snapshot = await sendSnapshotRequest({
        action: 'getSessionSnapshot',
        snapshotId: created.data.id,
      })
      expect(snapshot.ok).toBe(true)
      const sourceWindow = snapshot.data.payload.items.find(
        (item) => item.type === 0 && item.children.length > 0,
      )
      expect(sourceWindow).toBeDefined()
      const sourceChild = sourceWindow.children[0]

      await browser.refresh()
      await options.page.expectLoaded()
      await options.page.selectSection('settings_storage')
      const flattenedItems = snapshot.data.payload.items.flatMap((item) =>
        item.type === 0 ? [item, ...item.children] : [item],
      )
      const windowCheckboxIndex = flattenedItems.findIndex(
        (item) => item.uid === sourceWindow.uid,
      )
      const checkboxIndex = flattenedItems.findIndex(
        (item) => item.uid === sourceChild.uid,
      )
      const treeItems = await $$('.snapshot-tree .tree-item')
      const windowRow = treeItems[windowCheckboxIndex]
      const collapseButton = await windowRow.$('.tree-item-action-button')
      const collapseArrow = await collapseButton.$('.collapse-arrow')
      if ((await collapseArrow.getAttribute('class')).includes('collapsed')) {
        await collapseButton.click()
      }
      await collapseButton.click()

      const windowCheckbox = await windowRow.$('.snapshot-tree-checkbox')
      await windowCheckbox.click()
      expect(await windowCheckbox.getProperty('indeterminate')).toBe(false)
      expect(await windowCheckbox.isSelected()).toBe(true)

      await collapseButton.click()
      let checkboxes = await $$('.snapshot-tree-checkbox')
      expect(await checkboxes[checkboxIndex].isSelected()).toBe(true)

      await windowCheckbox.click()
      expect(await windowCheckbox.getProperty('indeterminate')).toBe(false)
      expect(await windowCheckbox.isSelected()).toBe(false)

      checkboxes = await $$('.snapshot-tree-checkbox')
      expect(await checkboxes[checkboxIndex].isSelected()).toBe(false)
      expect(checkboxIndex).toBeGreaterThanOrEqual(0)
      expect(checkboxIndex).toBeLessThan(checkboxes.length)
      await checkboxes[checkboxIndex].click()
      await expect(checkboxes[checkboxIndex]).toBeSelected()

      const treeBefore = await readPersistedSessionTree()
      const handlesBefore = await browser.getWindowHandles()

      await (await $('button=Restore 1 item')).click()
      const restoreDialog = await $('[role="dialog"]')
      await expect(restoreDialog).toBeDisplayed()
      await expect(restoreDialog).toHaveText(
        expect.stringContaining('Append 1 window'),
      )
      await (await restoreDialog.$('button=Restore 1 item')).click()
      const restoreToast = await $('.snapshot-success-toast')
      await expect(restoreToast).toBeDisplayed()
      await expect(restoreToast).toHaveText(
        expect.stringContaining('Restored 1 window'),
      )

      const treeAfter = await readPersistedSessionTree()
      const previousUids = new Set(treeBefore.map((item) => item.uid))
      const restoredWindows = treeAfter.filter(
        (item) =>
          !previousUids.has(item.uid) &&
          item.type === 0 &&
          item.id === -1 &&
          item.state === 0,
      )
      expect(restoredWindows).toHaveLength(1)
      const restoredWindow = restoredWindows[0]
      expect(restoredWindow.uid).not.toBe(sourceWindow.uid)
      expect(restoredWindow.children).toHaveLength(1)
      expect(restoredWindow.children[0]).toMatchObject({
        type: sourceChild.type,
        indentLevel: 1,
      })
      expect(restoredWindow.children[0].uid).not.toBe(sourceChild.uid)
      expect(await browser.getWindowHandles()).toEqual(handlesBefore)
    } finally {
      await sendSnapshotRequest({ action: 'clearSessionSnapshots' })
      await closeOptionsPage(options.optionsHandle, options.originalHandle)
    }
  })

  it('persists interval settings and reschedules the snapshot alarm', async () => {
    const options = await openOptionsPage()
    try {
      await options.page.selectSection('settings_storage')
      const interval = await $(
        '//div[contains(@class, "number-container")][.//label[normalize-space()="Snapshot every"]]',
      )
      const hours = await interval.$('button=Hours')
      await hours.click()
      await options.page.expectStoredSetting(
        'sessionSnapshotIntervalUnit',
        'hours',
      )
      const input = await interval.$('input[type="number"]')
      await input.click()
      await browser.keys(['Control', 'a'])
      await browser.keys('2')
      await options.page.expectStoredSetting('sessionSnapshotInterval', 2)

      await browser.waitUntil(
        async () => (await readSnapshotAlarm())?.periodInMinutes === 120,
        {
          timeout: 10_000,
          timeoutMsg:
            'Expected the snapshot alarm to repeat every 120 minutes.',
        },
      )
    } finally {
      await browser.executeAsync((done) => {
        window.browser.storage.local
          .get('settings')
          .then(({ settings }) =>
            window.browser.storage.local.set({
              settings: {
                ...(settings || {}),
                sessionSnapshotInterval: 30,
                sessionSnapshotIntervalUnit: 'minutes',
              },
            }),
          )
          .then(() =>
            window.browser.runtime.sendMessage({ type: 'settingsUpdated' }),
          )
          .then(() => done({ ok: true }))
          .catch((error) => done({ ok: false, error: String(error) }))
      })
      await closeOptionsPage(options.optionsHandle, options.originalHandle)
    }
  })
})
