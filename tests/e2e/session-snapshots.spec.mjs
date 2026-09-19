import { $, $$, browser, expect } from '@wdio/globals'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { closeOptionsPage, openOptionsPage } from './support/options-page.mjs'
import {
  readPersistedSessionTree,
  readSnapshotAlarm,
  sendSnapshotRequest,
} from './support/session-snapshots.mjs'

describe('session snapshot workflows', () => {
  it('imports Tab Session Manager sessions with hierarchy and a persistent protected import label', async () => {
    const options = await openOptionsPage()
    try {
      await sendSnapshotRequest({ action: 'clearSessionSnapshots' })
      await browser.refresh()
      await options.page.expectLoaded()
      await options.page.selectSection('settings_storage')
      const treeBefore = await readPersistedSessionTree()
      const handlesBefore = await browser.getWindowHandles()
      const input = await $('[data-testid="import-snapshot-file"]')
      await browser.execute((element) => {
        element.hidden = false
      }, input)
      await input.setValue(
        path.resolve('tests/fixtures/tab-session-manager-export.json'),
      )
      await expect($('.snapshot-success-toast')).toHaveText(
        'Snapshot imported and protected.',
      )
      const list = await sendSnapshotRequest({ action: 'listSessionSnapshots' })
      expect(list.data.snapshots).toHaveLength(1)
      const imported = list.data.snapshots[0]
      expect(imported).toMatchObject({
        protected: true,
        trigger: 'import',
        containsPrivateWindows: true,
        counts: { windows: 2, tabs: 4, notes: 3, separators: 0 },
        importSummary: { source: 'tab-session-manager' },
      })
      const record = await sendSnapshotRequest({
        action: 'getSessionSnapshot',
        snapshotId: imported.id,
      })
      expect(record.data.payload.items[0]).toMatchObject({ text: 'Research' })
      const windows = record.data.payload.items.filter(
        (item) => item.type === 0,
      )
      const [parent, child] = windows[0].children
      expect(parent).toMatchObject({
        title: 'Example',
        pinned: true,
        tabGroup: { title: 'Reading', color: 'blue', collapsed: true },
      })
      expect(child).toMatchObject({
        title: 'Article',
        parentUid: parent.uid,
        indentLevel: 3,
      })
      expect(await readPersistedSessionTree()).toEqual(treeBefore)
      expect(await browser.getWindowHandles()).toEqual(handlesBefore)
      await browser.refresh()
      await options.page.expectLoaded()
      await options.page.selectSection('settings_storage')
      await expect($('[data-testid="snapshot-import-source"]')).toHaveText(
        'Imported from Tab Session Manager',
      )
      await expect(
        $('.snapshot-entry [aria-label="Imported snapshot"]'),
      ).toBeDisplayed()
      await expect(
        $('.snapshot-entry [aria-label="Protected snapshot"]'),
      ).toBeDisplayed()
      const details = await $('[data-testid="snapshot-import-warnings"]')
      await details.$('summary').click()
      await expect(details).toHaveText(
        expect.stringContaining('Container assignments were not imported'),
      )
    } finally {
      await sendSnapshotRequest({ action: 'clearSessionSnapshots' }).catch(
        () => undefined,
      )
      await closeOptionsPage(options.optionsHandle, options.originalHandle)
    }
  })

  it('imports Session Buddy collections as a protected snapshot with a persistent source label', async () => {
    const options = await openOptionsPage()
    try {
      await sendSnapshotRequest({ action: 'clearSessionSnapshots' })
      await browser.refresh()
      await options.page.expectLoaded()
      await options.page.selectSection('settings_storage')
      const treeBefore = await readPersistedSessionTree()
      const handlesBefore = await browser.getWindowHandles()
      const input = await $('[data-testid="import-snapshot-file"]')
      await browser.execute((element) => {
        element.hidden = false
      }, input)
      await input.setValue(
        path.resolve('tests/fixtures/session-buddy-export.json'),
      )
      await expect($('.snapshot-success-toast')).toHaveText(
        'Snapshot imported and protected.',
      )
      const list = await sendSnapshotRequest({ action: 'listSessionSnapshots' })
      expect(list.data.snapshots).toHaveLength(1)
      const imported = list.data.snapshots[0]
      expect(imported).toMatchObject({
        protected: true,
        trigger: 'import',
        containsPrivateWindows: true,
        counts: { windows: 3, tabs: 4, notes: 2, separators: 0 },
        importSummary: { source: 'session-buddy' },
      })
      const record = await sendSnapshotRequest({
        action: 'getSessionSnapshot',
        snapshotId: imported.id,
      })
      expect(record.data.payload.items[0]).toMatchObject({ text: 'Research' })
      const windows = record.data.payload.items.filter(
        (item) => item.type === 0,
      )
      expect(windows.map((window) => window.title)).toEqual([
        'Reading',
        'Private reading',
        'Browser',
      ])
      expect(windows[0].children[0]).toMatchObject({
        title: 'Example article',
        customLabel: 'Read this first',
        pinned: true,
      })
      expect(await readPersistedSessionTree()).toEqual(treeBefore)
      expect(await browser.getWindowHandles()).toEqual(handlesBefore)
      await browser.refresh()
      await options.page.expectLoaded()
      await options.page.selectSection('settings_storage')
      await expect($('[data-testid="snapshot-import-source"]')).toHaveText(
        'Imported from Session Buddy',
      )
      await expect(
        $('.snapshot-entry [aria-label="Imported snapshot"]'),
      ).toBeDisplayed()
      await expect(
        $('.snapshot-entry [aria-label="Protected snapshot"]'),
      ).toBeDisplayed()
      const details = await $('[data-testid="snapshot-import-warnings"]')
      await details.$('summary').click()
      await expect(details).toHaveText(
        expect.stringContaining('Collections were preserved as note branches'),
      )
    } finally {
      await sendSnapshotRequest({ action: 'clearSessionSnapshots' }).catch(
        () => undefined,
      )
      await closeOptionsPage(options.optionsHandle, options.originalHandle)
    }
  })

  it('imports a Tabs Outliner backup and retains its conversion details after reload', async () => {
    const options = await openOptionsPage()
    try {
      await sendSnapshotRequest({ action: 'clearSessionSnapshots' })
      await browser.refresh()
      await options.page.expectLoaded()
      await options.page.selectSection('settings_storage')
      const treeBefore = await readPersistedSessionTree()
      const handlesBefore = await browser.getWindowHandles()
      const fixturePath = path.resolve(
        'tests/fixtures/tabs-outliner-backup.json',
      )
      const input = await $('[data-testid="import-snapshot-file"]')
      await browser.execute((element) => {
        element.hidden = false
      }, input)
      await input.setValue(fixturePath)
      await expect($('.snapshot-success-toast')).toHaveText(
        'Snapshot imported and protected.',
      )
      const list = await sendSnapshotRequest({ action: 'listSessionSnapshots' })
      expect(list.data.snapshots).toHaveLength(1)
      const imported = list.data.snapshots[0]
      expect(imported).toMatchObject({
        protected: true,
        trigger: 'import',
        counts: { windows: 3, tabs: 4, notes: 4, separators: 1 },
        importSummary: {
          source: 'tabs-outliner',
          sourceCreatedAt: 1700000000000,
        },
      })
      const record = await sendSnapshotRequest({
        action: 'getSessionSnapshot',
        snapshotId: imported.id,
      })
      const windows = record.data.payload.items.filter(
        (item) => item.type === 0,
      )
      expect(windows.map((window) => window.title)).toEqual([
        'Main',
        'Nested',
        'Deep',
      ])
      expect(windows[0].children[0].url).toBe('https://example.com/a')
      expect(
        windows.every((window) => window.parentUid === windows[0].parentUid),
      ).toBe(true)
      expect(await readPersistedSessionTree()).toEqual(treeBefore)
      expect(await browser.getWindowHandles()).toEqual(handlesBefore)
      await browser.refresh()
      await options.page.expectLoaded()
      await options.page.selectSection('settings_storage')
      await expect($('[data-testid="snapshot-import-source"]')).toHaveText(
        expect.stringContaining('Imported from Tabs Outliner'),
      )
      await expect(
        $('.snapshot-entry [aria-label="Imported snapshot"]'),
      ).toBeDisplayed()
      await expect(
        $('.snapshot-entry [aria-label="Protected snapshot"]'),
      ).toBeDisplayed()
      const details = await $('[data-testid="snapshot-import-warnings"]')
      await details.$('summary').click()
      await expect(details).toHaveText(
        expect.stringContaining(
          'Nested windows were moved below their containing window as siblings. (2)',
        ),
      )

      // The older, unwrapped DevTools dump uses the same adapter through the runtime API.
      const backup = JSON.parse(await readFile(fixturePath, 'utf8'))
      const rawImport = await sendSnapshotRequest({
        action: 'importSessionSnapshot',
        json: JSON.stringify(backup.data),
      })
      expect(rawImport.ok).toBe(true)
      expect(rawImport.data.importSummary).toEqual(imported.importSummary)
    } finally {
      await sendSnapshotRequest({ action: 'clearSessionSnapshots' }).catch(
        () => undefined,
      )
      await closeOptionsPage(options.optionsHandle, options.originalHandle)
    }
  })

  it('imports a JSON file as a protected snapshot and rejects invalid files', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'session-flow-import-'))
    const options = await openOptionsPage()
    try {
      await sendSnapshotRequest({ action: 'clearSessionSnapshots' })
      const created = await sendSnapshotRequest({
        action: 'createSessionSnapshot',
      })
      const exported = await sendSnapshotRequest({
        action: 'getSessionSnapshotExport',
        snapshotId: created.data.id,
      })
      expect(exported.ok).toBe(true)
      await sendSnapshotRequest({ action: 'clearSessionSnapshots' })
      await browser.refresh()
      await options.page.expectLoaded()
      await options.page.selectSection('settings_storage')
      await expect($('[data-testid="import-snapshot"]')).toBeEnabled()
      const treeBefore = await readPersistedSessionTree()
      const handlesBefore = await browser.getWindowHandles()
      const filePath = path.join(directory, 'snapshot.json')
      const input = await $('[data-testid="import-snapshot-file"]')
      // WebDriver supplies the file directly instead of interacting with the OS dialog.
      await browser.execute((element) => {
        element.hidden = false
      }, input)
      await writeFile(filePath, '{', 'utf8')
      await input.setValue(filePath)
      await expect($('[role="dialog"]')).toHaveText(
        expect.stringContaining('not a valid snapshot file'),
      )
      expect(
        (await sendSnapshotRequest({ action: 'listSessionSnapshots' })).data
          .snapshots,
      ).toHaveLength(0)
      await $('button=Dismiss').click()

      await writeFile(filePath, JSON.stringify(exported.data), 'utf8')
      await input.setValue(filePath)
      await expect($('.snapshot-success-toast')).toHaveText(
        'Snapshot imported and protected.',
      )
      const list = await sendSnapshotRequest({ action: 'listSessionSnapshots' })
      expect(list.data.snapshots).toHaveLength(1)
      const imported = list.data.snapshots[0]
      expect(imported).toMatchObject({
        trigger: 'import',
        protected: true,
        available: true,
        counts: exported.data.metadata.counts,
      })
      expect(imported.id).not.toBe(exported.data.metadata.id)
      await expect(
        $('.snapshot-entry.active [aria-label="Protected snapshot"]'),
      ).toBeDisplayed()
      await expect(
        $('.snapshot-entry.active [aria-label="Imported snapshot"]'),
      ).toBeDisplayed()
      await expect($('.snapshot-preview')).toBeDisplayed()
      const record = await sendSnapshotRequest({
        action: 'getSessionSnapshot',
        snapshotId: imported.id,
      })
      expect(record.data.payload).toEqual(exported.data.payload)
      expect(await readPersistedSessionTree()).toEqual(treeBefore)
      expect(await browser.getWindowHandles()).toHaveLength(
        handlesBefore.length,
      )
      await browser.refresh()
      await options.page.expectLoaded()
      await options.page.selectSection('settings_storage')
      await expect(
        $('.snapshot-entry [aria-label="Protected snapshot"]'),
      ).toBeDisplayed()
      await expect(
        $('.snapshot-entry [aria-label="Imported snapshot"]'),
      ).toBeDisplayed()
      const recordActions = await $('.snapshot-record-actions')
      await (await recordActions.$('button=Unprotect')).click()
      await expect(
        $('.snapshot-entry [aria-label="Protected snapshot"]'),
      ).not.toBeExisting()
      await expect(
        $('.snapshot-entry [aria-label="Imported snapshot"]'),
      ).toBeDisplayed()
    } finally {
      await sendSnapshotRequest({ action: 'clearSessionSnapshots' }).catch(
        () => undefined,
      )
      await closeOptionsPage(options.optionsHandle, options.originalHandle)
      await rm(directory, { recursive: true, force: true })
    }
  })

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
      await expect(
        snapshotEntry.$('[aria-label="Imported snapshot"]'),
      ).not.toBeExisting()

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
      const selectableRows = await $$('.snapshot-tree .tree-item')
      await (
        await selectableRows[checkboxIndex].$('.tree-item-content')
      ).click()
      checkboxes = await $$('.snapshot-tree-checkbox')
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
