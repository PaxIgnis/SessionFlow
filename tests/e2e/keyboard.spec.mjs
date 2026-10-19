import { $, browser, expect } from '@wdio/globals'
import { Key } from 'webdriverio'
import { openOptionsPage } from './support/options-page.mjs'
import { SessionTreePage } from './support/session-tree-page.mjs'
import { openSessionTreePopup } from './support/session-tree-popup.mjs'
import {
  fixtureDataUrl,
  reloadableFixtureDataUrl,
} from './support/session-fixtures.mjs'
import { sendSnapshotRequest } from './support/session-snapshots.mjs'
import { SESSION_TREE_URL } from './support/firefox-extension.mjs'
import { withFirefoxChromeContext } from './support/firefox-chrome-context.mjs'

async function chord(modifiers, key) {
  const action = browser.action('key')
  for (const modifier of modifiers) action.down(modifier)
  action.down(key).up(key)
  for (const modifier of [...modifiers].reverse()) action.up(modifier)
  await action.perform()
}

const defaultShortcuts = {
  shortcutActivate: 'Enter',
  shortcutCollapse: 'Space',
  shortcutEdit: '',
  shortcutClose: '',
  shortcutSave: '',
  shortcutReload: '',
  shortcutPin: '',
  shortcutAddNote: '',
  shortcutAddSeparator: '',
}

async function updateBrowserShortcuts(commands) {
  const result = await browser.executeAsync((bindings, done) => {
    Promise.all(
      bindings.map(({ name, shortcut }) =>
        window.browser.commands.update({ name, shortcut: shortcut ?? '' }),
      ),
    )
      .then(() => done({ ok: true }))
      .catch((error) => done({ ok: false, error: String(error) }))
  }, commands)
  expect(result).toEqual({ ok: true })
}

describe('keyboard mappings and tree navigation', () => {
  let options
  let popupHandle
  let page
  const noteUids = []
  const fixtureWindows = []

  let initialHandles
  let previousShortcuts
  let previousCommands

  beforeEach(async () => {
    initialHandles = await browser.getWindowHandles()
    options = undefined
    previousShortcuts = undefined
    previousCommands = undefined
    noteUids.length = 0
    fixtureWindows.length = 0
    options = await openOptionsPage()
    page = new SessionTreePage()
    previousShortcuts = Object.fromEntries(
      await Promise.all(
        Object.entries(defaultShortcuts).map(async ([name, fallback]) => [
          name,
          (await options.page.storedSetting(name)) ?? fallback,
        ]),
      ),
    )
    previousCommands = await browser.executeAsync((done) =>
      window.browser.commands.getAll().then(done),
    )
    await page.updateSettings(defaultShortcuts)
    await updateBrowserShortcuts([
      { name: 'open-session-tree', shortcut: 'Ctrl+Alt+J' },
      { name: 'open-settings', shortcut: 'Ctrl+Alt+K' },
      { name: 'shortcutSnapshot', shortcut: 'Ctrl+Alt+L' },
    ])
  })

  async function openTree(shortcuts = {}) {
    await page.updateSettings(shortcuts)
    const popup = await openSessionTreePopup()
    popupHandle = popup.popupHandle
    await page.expectLoaded()
  }

  afterEach(async () => {
    const handles = await browser.getWindowHandles()
    if (options) {
      if (!handles.includes(options.optionsHandle))
        options = await openOptionsPage()
      await browser.switchToWindow(options.optionsHandle)
      page = new SessionTreePage()
      for (const uid of noteUids.reverse())
        await page.sendTreeCommand({ action: 'removeNote', noteUid: uid })
      for (const uid of fixtureWindows) {
        const item = (await page.backgroundTreeSnapshot()).find(
          (item) => item.uid === uid,
        )
        if (item)
          await page.sendTreeCommand({
            action: 'closeWindow',
            windowId: item.id,
            windowUid: uid,
          })
      }
      if (previousShortcuts) await page.updateSettings(previousShortcuts)
      if (previousCommands) await updateBrowserShortcuts(previousCommands)
    }
    for (const handle of await browser.getWindowHandles()) {
      if (initialHandles.includes(handle)) continue
      await browser.switchToWindow(handle)
      await browser.closeWindow()
    }
    const remaining = await browser.getWindowHandles()
    if (remaining.length) await browser.switchToWindow(remaining[0])
  })

  it('records, rejects conflicts, previews held keys, clears, and persists mappings', async () => {
    await options.page.selectSection('settings_keyboard')
    const activate = await $('#shortcutActivate')
    await expect(activate).toBeEnabled()
    const storedBefore = await options.page.storedSetting('shortcutActivate')
    await $('#shortcutActivate-label').click()
    await expect(activate).not.toBeFocused()
    await expect(activate).not.toHaveElementClass('recording')
    await browser.keys('z')
    await expect(activate).toHaveValue('Enter')
    expect(await options.page.storedSetting('shortcutActivate')).toBe(
      storedBefore,
    )
    const snapshotInput = await $('#shortcutSnapshot')
    await snapshotInput.click()
    await expect(snapshotInput).toHaveElementClass('recording')
    await browser.keys('Tab')
    await expect(snapshotInput).not.toHaveElementClass('recording')
    await browser.execute((element) => element.focus(), activate)
    await expect(activate).toBeFocused()
    await browser.keys('Enter')
    await expect(activate).toHaveElementClass('recording')
    await expect(activate).toHaveValue('')
    await expect(activate).toHaveAttribute(
      'placeholder',
      'Press keyboard shortcut',
    )
    await browser.keys('F8')
    await expect(activate).toHaveValue('F8')
    await options.page.expectStoredSetting('shortcutActivate', 'F8')
    await expect(activate).not.toBeFocused()
    await expect(activate).not.toHaveElementClass('recording')
    await browser.keys('z')
    await options.page.expectStoredSetting('shortcutActivate', 'F8')
    await browser.execute((element) => element.focus(), activate)
    await browser.keys('Space')
    await expect(activate).toHaveElementClass('recording')
    await expect(activate).toHaveValue('')
    await browser.keys('Escape')
    await expect(activate).not.toHaveElementClass('recording')
    await expect(activate).toHaveValue('F8')
    await expect(activate).not.toBeFocused()
    await $('#shortcutCollapse').click()
    await browser.keys('F8')
    await expect(await $('[role="alert"]')).toHaveText(
      'This shortcut is already assigned to another action.',
    )
    await expect(await $('#shortcutCollapse')).toHaveValue('Space')
    await expect(await $('#shortcutCollapse')).not.toBeFocused()
    await expect(await $('#shortcutCollapse')).toHaveElementClass('invalid')
    await expect(await $('#shortcutCollapse')).not.toHaveElementClass('invalid')

    await activate.click()
    await browser.keys('ArrowUp')
    await expect(activate).toHaveValue('F8')
    await expect(activate).not.toBeFocused()
    await $(
      'button[aria-label="Clear shortcut for Activate selected item (double-click action)"]',
    ).click()
    await options.page.expectStoredSetting('shortcutActivate', '')
    await expect(activate).toHaveAttribute('placeholder', '---')
    await activate.click()
    await browser.keys('Enter')
    await expect(activate).toHaveValue('Enter')

    await $('#shortcutEdit').click()
    await browser.action('key', { id: 'recorder' }).down(Key.Ctrl).perform(true)
    await expect(await $('#shortcutEdit')).toHaveValue('Ctrl +')
    await browser
      .action('key', { id: 'recorder' })
      .down(Key.Shift)
      .perform(true)
    await expect(await $('#shortcutEdit')).toHaveValue('Ctrl + Shift +')
    await browser.action('key', { id: 'recorder' }).down('k').perform(true)
    await expect(await $('#shortcutEdit')).toHaveValue('Ctrl + Shift + K')
    await options.page.expectStoredSetting('shortcutEdit', '')
    await browser
      .action('key', { id: 'recorder' })
      .up('k')
      .up(Key.Shift)
      .up(Key.Ctrl)
      .perform()
    await options.page.expectStoredSetting('shortcutEdit', 'Ctrl+Shift+K')
    await expect(await $('#shortcutEdit')).not.toBeFocused()
    await $('#shortcutEdit').click()
    await browser
      .action('key', { id: 'recorder' })
      .down(Key.Ctrl)
      .up(Key.Ctrl)
      .perform()
    await expect(await $('[role="alert"]')).toHaveText(
      expect.stringContaining('Choose a different shortcut.'),
    )
    await options.page.expectStoredSetting('shortcutEdit', 'Ctrl+Shift+K')
    await expect(await $('#shortcutEdit')).not.toBeFocused()
    await $('#shortcutEdit').click()
    await browser.keys('F2')
    await options.page.expectStoredSetting('shortcutEdit', 'F2')
    for (const name of [
      'open-session-tree',
      'open-settings',
      'shortcutSnapshot',
    ]) {
      const input = await $('#' + name)
      const previous = await input.getValue()
      await input.click()
      await browser.keys('k')
      await expect(input).toHaveValue(previous)
      await expect(input).not.toBeFocused()
      await expect(await $('[role="alert"]')).toHaveText(
        expect.stringContaining('Choose a different shortcut.'),
      )
    }
    await $('#open-settings').click()
    await chord([Key.Ctrl, Key.Alt], 'k')
    await expect(await $('#open-settings')).toHaveValue('Ctrl+Alt+K')
    await $('#shortcutSnapshot').click()
    await chord([Key.Ctrl, Key.Alt], 'l')
    await expect(await $('#shortcutSnapshot')).toHaveValue('Ctrl+Alt+L')
    await $('#open-session-tree').click()
    await chord([Key.Ctrl, Key.Alt], 'j')
    await expect(await $('#open-session-tree')).toHaveValue('Ctrl+Alt+J')
    await browser.refresh()
    await options.page.expectLoaded()
    await options.page.selectSection('settings_keyboard')
    await expect(await $('#open-session-tree')).toHaveValue('Ctrl+Alt+J')
    await expect(await $('#shortcutEdit')).toHaveValue('F2')
  })

  it('opens settings and creates a snapshot from an ordinary Firefox tab with no tree open', async () => {
    await browser.newWindow(fixtureDataUrl('Keyboard ordinary tab'), {
      type: 'tab',
    })
    const ordinaryHandle = await browser.getWindowHandle()
    await browser.switchToWindow(options.optionsHandle)
    await browser.closeWindow()
    await browser.switchToWindow(ordinaryHandle)
    const before = await browser.getWindowHandles()
    await withFirefoxChromeContext(() => chord([Key.Ctrl, Key.Alt], 'k'))
    await browser.waitUntil(async () =>
      (await browser.getWindowHandles()).some(
        (handle) => !before.includes(handle),
      ),
    )
    options.optionsHandle = (await browser.getWindowHandles()).find(
      (handle) => !before.includes(handle),
    )
    await browser.switchToWindow(options.optionsHandle)
    await expect(browser).toHaveUrl(expect.stringContaining('/options.html'))
    const snapshotsBefore = (
      await sendSnapshotRequest({ action: 'listSessionSnapshots' })
    ).data.snapshots.map((snapshot) => snapshot.id)
    await browser.switchToWindow(ordinaryHandle)
    await withFirefoxChromeContext(() => chord([Key.Ctrl, Key.Alt], 'l'))
    await expect(browser).toHaveTitle('Keyboard ordinary tab')
    await browser.switchToWindow(options.optionsHandle)
    let snapshot
    await browser.waitUntil(
      async () => {
        snapshot = (
          await sendSnapshotRequest({ action: 'listSessionSnapshots' })
        ).data.snapshots.find(
          (item) =>
            !snapshotsBefore.includes(item.id) && item.trigger === 'manual',
        )
        return Boolean(snapshot)
      },
      {
        timeoutMsg:
          'Expected a browser-wide manual snapshot without a tree page.',
      },
    )
    const record = await sendSnapshotRequest({
      action: 'getSessionSnapshot',
      snapshotId: snapshot.id,
    })
    expect(record.ok).toBe(true)
    expect(record.data.payload.items.length).toBeGreaterThan(0)
    await sendSnapshotRequest({
      action: 'deleteSessionSnapshot',
      snapshotId: snapshot.id,
    })
  })

  it('opens the tree with the configured Firefox shortcut', async () => {
    await browser.newWindow(fixtureDataUrl('Keyboard tree shortcut'), {
      type: 'tab',
    })
    const before = await browser.getWindowHandles()
    await browser.execute(() => document.activeElement?.blur())
    await withFirefoxChromeContext(() => chord([Key.Ctrl, Key.Alt], 'j'))
    await browser.waitUntil(async () =>
      (await browser.getWindowHandles()).some(
        (handle) => !before.includes(handle),
      ),
    )
    popupHandle = (await browser.getWindowHandles()).find(
      (handle) => !before.includes(handle),
    )
    await browser.switchToWindow(popupHandle)
    await expect(browser).toHaveUrl(expect.stringContaining(SESSION_TREE_URL))
    page = new SessionTreePage()
    await page.expectLoaded()
  })

  it('navigates, collapses, moves sibling subtrees, and changes indent with real keys', async () => {
    await openTree({ shortcutEdit: 'F2' })
    for (const text of ['Keyboard parent', 'Keyboard sibling']) {
      await page.sendTreeCommand({ action: 'createNote', text })
      const tree = await page.backgroundTreeSnapshot()
      noteUids.push(tree.find((item) => item.text === text).uid)
    }
    await page.sendTreeCommand({
      action: 'createNote',
      parentUid: noteUids[0],
      text: 'Keyboard child',
    })
    const tree = await page.backgroundTreeSnapshot()
    noteUids.push(tree.find((item) => item.text === 'Keyboard child').uid)
    const [parentUid, siblingUid, childUid] = noteUids
    const parent = await page.treeItemByUid(parentUid)
    await parent.click()
    await browser.keys('ArrowRight')
    await expect(await page.treeItemByUid(childUid)).toHaveElementClass(
      'tree-item-selected',
    )
    await browser.keys('ArrowLeft')
    await expect(parent).toHaveElementClass('tree-item-selected')
    await browser.keys('Space')
    await expect(await page.treeItemByUid(childUid)).not.toBeDisplayed()
    await browser.keys('ArrowDown')
    await expect(await page.treeItemByUid(siblingUid)).toHaveElementClass(
      'tree-item-selected',
    )
    const firstUid = await browser.execute(() =>
      [...document.querySelectorAll('.tree-item[drag-and-drop-id]')]
        .find((row) => row.getClientRects().length)
        ?.getAttribute('drag-and-drop-id'),
    )
    await browser.keys('ArrowDown')
    await expect(await page.treeItemByUid(firstUid)).toHaveElementClass(
      'tree-item-selected',
    )
    await browser.keys('ArrowUp')
    await expect(await page.treeItemByUid(siblingUid)).toHaveElementClass(
      'tree-item-selected',
    )
    await chord([Key.Ctrl], Key.ArrowUp)
    await page.waitForBackgroundTree(
      (items) =>
        items.findIndex((item) => item.uid === siblingUid) <
        items.findIndex((item) => item.uid === parentUid),
      'Expected sibling moved before parent subtree.',
    )
    await expect(await page.treeItemByUid(siblingUid)).toHaveElementClass(
      'tree-item-selected',
    )
    await chord([Key.Ctrl], Key.ArrowDown)
    await page.waitForBackgroundTree(
      (items) =>
        items.findIndex((item) => item.uid === siblingUid) >
        items.findIndex((item) => item.uid === childUid),
      'Expected sibling moved after the complete parent subtree.',
    )
    await chord([Key.Ctrl], Key.ArrowRight)
    await page.waitForBackgroundTree(
      (items) =>
        items.find((item) => item.uid === siblingUid)?.parentUid === parentUid,
      'Expected increased indent.',
    )
    // Indenting under a collapsed parent hides the selection. Reopen the parent
    // with the mouse before checking keyboard outdent.
    await parent.click()
    await browser.keys('Space')
    await (await page.treeItemByUid(siblingUid)).click()
    await chord([Key.Ctrl], Key.ArrowLeft)
    await page.waitForBackgroundTree(
      (items) =>
        items.find((item) => item.uid === siblingUid)?.parentUid === undefined,
      'Expected decreased indent.',
    )
    await browser.keys('Enter')
    await expect(
      await $('[aria-labelledby="edit-text-modal-title"]'),
    ).toBeDisplayed()
    await browser.keys('Escape')
    await expect(
      await $('[aria-labelledby="edit-text-modal-title"]'),
    ).not.toBeExisting()
    await browser.keys('F2')
    await expect(
      await $('[aria-labelledby="edit-text-modal-title"]'),
    ).toBeDisplayed()
    await browser.keys('Escape')
  })

  it('runs reload, pin/unpin, label/note editing, note/separator creation, save, activate, and close on real tabs', async () => {
    await openTree({
      shortcutEdit: 'F2',
      shortcutReload: 'R',
      shortcutPin: 'P',
      shortcutSave: 'S',
      shortcutClose: 'C',
      shortcutAddNote: 'N',
      shortcutAddSeparator: 'B',
    })
    await browser.newWindow(reloadableFixtureDataUrl('Keyboard live fixture'), {
      type: 'window',
    })
    await browser.switchToWindow(popupHandle)
    let fixture
    await page.waitForBackgroundTree((items) => {
      fixture = items.find(
        (item) =>
          item.type === 0 &&
          item.children.some((tab) =>
            tab.title?.startsWith('Keyboard live fixture '),
          ),
      )
      return Boolean(fixture)
    }, 'Expected keyboard fixture window.')
    fixtureWindows.push(fixture.uid)
    const tab = fixture.children.find((item) =>
      item.title?.startsWith('Keyboard live fixture '),
    )
    const getTab = (items) =>
      items
        .find((item) => item.uid === fixture.uid)
        ?.children.find((item) => item.uid === tab.uid)
    const press = async (uid, key) => {
      await browser.switchToWindow(popupHandle)
      const row = await page.treeItemByUid(uid)
      await row.scrollIntoView({ block: 'center', inline: 'nearest' })
      await row.click()
      await browser.keys(key)
    }
    const nativeTab = () =>
      browser.executeAsync(
        (id, done) => window.browser.tabs.get(id).then(done),
        tab.id,
      )
    const neighbor = await browser.executeAsync(
      (windowId, url, done) => {
        window.browser.tabs
          .create({ windowId, url, active: false, index: 0 })
          .then(done)
      },
      fixture.id,
      'about:blank',
    )
    let neighborUid
    await page.waitForBackgroundTree((items) => {
      const children =
        items.find((item) => item.uid === fixture.uid)?.children ?? []
      neighborUid = children.find((item) => item.id === neighbor.id)?.uid
      return (
        Boolean(neighborUid) &&
        children.findIndex((item) => item.uid === tab.uid) > 0
      )
    }, 'Expected the pin target to start after another tab.')
    await press(tab.uid, 'p')
    await page.waitForBackgroundTree((items) => {
      const children =
        items.find((item) => item.uid === fixture.uid)?.children ?? []
      return children[0]?.uid === tab.uid && children[0]?.pinned
    }, 'Expected pinning to move the tab before its neighbor.')
    await expect(await page.treeItemByUid(neighborUid)).toBeFocused()
    await expect(await $('.tree-item-selected')).not.toBeExisting()
    expect(
      await browser.execute(
        () => getComputedStyle(document.activeElement).outlineStyle,
      ),
    ).toBe('none')
    await browser.keys('ArrowUp')
    await expect(await page.treeItemByUid(tab.uid)).toHaveElementClass(
      'tree-item-selected',
    )
    await browser.keys('p')
    await browser.waitUntil(async () => (await nativeTab()).pinned === false)
    const previousUid = await browser.execute(() => {
      const rows = [
        ...document.querySelectorAll('.tree-item[drag-and-drop-id]'),
      ].filter((row) => row.getClientRects().length > 0)
      const index = rows.indexOf(document.activeElement)
      return index < 0
        ? null
        : rows[(index - 1 + rows.length) % rows.length].getAttribute(
            'drag-and-drop-id',
          )
    })
    expect(previousUid).not.toBeNull()
    await browser.keys('ArrowUp')
    await expect(await page.treeItemByUid(previousUid)).toHaveElementClass(
      'tree-item-selected',
    )
    await press(tab.uid, 'r')
    await page.waitForBackgroundTree(
      (items) => getTab(items)?.title !== tab.title,
      'Expected a real page reload with a new fixture title.',
    )
    await press(tab.uid, 'F2')
    await $('.modal-input').setValue('Keyboard label')
    await browser.keys('Enter')
    await page.waitForBackgroundTree(
      (items) => getTab(items)?.customLabel === 'Keyboard label',
      'Expected edited tab label.',
    )
    await press(fixture.uid, 'n')
    let note
    await page.waitForBackgroundTree((items) => {
      note = items
        .find((item) => item.uid === fixture.uid)
        ?.children.find((item) => item.type === 2)
      return Boolean(note)
    }, 'Expected note created by keyboard.')
    await press(note.uid, 'F2')
    await $('.modal-input').setValue('Keyboard edited note')
    await browser.keys('Enter')
    await page.waitForBackgroundTree(
      (items) =>
        items
          .find((item) => item.uid === fixture.uid)
          ?.children.some(
            (item) =>
              item.uid === note.uid && item.text === 'Keyboard edited note',
          ),
      'Expected edited note text.',
    )
    await press(fixture.uid, 'b')
    await page.waitForBackgroundTree(
      (items) =>
        items
          .find((item) => item.uid === fixture.uid)
          ?.children.some((item) => item.type === 3),
      'Expected separator created by keyboard.',
    )
    const deleteAndResume = async (uid) => {
      const expectedNeighbor = await browser.execute((deletedUid) => {
        const rows = [
          ...document.querySelectorAll('.tree-item[drag-and-drop-id]'),
        ]
          .filter((row) => row.getClientRects().length > 0)
          .map((row) => row.getAttribute('drag-and-drop-id'))
        const index = rows.indexOf(deletedUid)
        return rows[index + 1] ?? rows[index - 1]
      }, uid)
      await press(uid, 'c')
      await expect(await page.treeItemByUid(uid)).not.toBeExisting()
      const neighborRow = await page.treeItemByUid(expectedNeighbor)
      await expect(neighborRow).toBeFocused()
      await expect(await $('.tree-item-selected')).not.toBeExisting()
      expect(
        await browser.execute(
          () => getComputedStyle(document.activeElement).outlineStyle,
        ),
      ).toBe('none')
      await expect(await $('[role="dialog"]')).not.toBeExisting()
      await browser.keys('ArrowDown')
      await expect(await $('.tree-item-selected')).toBeExisting()
    }
    await deleteAndResume(note.uid)
    const separator = (await page.backgroundTreeSnapshot())
      .find((item) => item.uid === fixture.uid)
      .children.find((item) => item.type === 3)
    await deleteAndResume(separator.uid)
    await press(fixture.uid, 'Space')
    await expect(await page.treeItemByUid(tab.uid)).not.toBeDisplayed()
    await browser.keys('Space')
    await expect(await page.treeItemByUid(tab.uid)).toBeDisplayed()
    await press(tab.uid, 's')
    await page.waitForBackgroundTree(
      (items) => getTab(items)?.state === 0,
      'Expected tab saved by keyboard.',
    )
    await press(tab.uid, 'Enter')
    await browser.switchToWindow(popupHandle)
    await page.waitForBackgroundTree(
      (items) => getTab(items)?.state === 1,
      'Expected Enter to reopen the saved tab.',
    )
    await deleteAndResume(tab.uid)
    await page.waitForBackgroundTree(
      (items) => !getTab(items),
      'Expected tab closed and removed by keyboard.',
    )
    await browser.waitUntil(async () =>
      browser.executeAsync((done) =>
        window.browser.tabs
          .query({})
          .then((tabs) =>
            done(
              !tabs.some((tab) =>
                tab.title?.startsWith('Keyboard live fixture '),
              ),
            ),
          ),
      ),
    )
  })

  it('edits window titles, saves/reopens/closes windows, and wraps Alt navigation between live tabs', async () => {
    await openTree({
      shortcutEdit: 'F2',
      shortcutSave: 'S',
      shortcutClose: 'C',
    })
    await browser.newWindow(fixtureDataUrl('Keyboard window first'), {
      type: 'window',
    })
    await browser.newWindow(fixtureDataUrl('Keyboard window second'), {
      type: 'tab',
    })
    await browser.switchToWindow(popupHandle)
    let fixture
    await page.waitForBackgroundTree((items) => {
      fixture = items.find(
        (item) =>
          item.type === 0 &&
          item.children.some((tab) => tab.title === 'Keyboard window first') &&
          item.children.some((tab) => tab.title === 'Keyboard window second'),
      )
      return Boolean(fixture)
    }, 'Expected both tabs in the keyboard window.')
    fixtureWindows.push(fixture.uid)
    const visibleUids = await browser.execute(() =>
      [...document.querySelectorAll('.tree-item[drag-and-drop-id]')]
        .filter((row) => row.getClientRects().length)
        .map((row) => row.getAttribute('drag-and-drop-id')),
    )
    const liveTabs = (await page.backgroundTreeSnapshot())
      .flatMap((item) => item.children ?? [])
      .filter(
        (item) =>
          item.type === 1 && item.state !== 0 && visibleUids.includes(item.uid),
      )
    const select = async (uid) => {
      const row = await page.treeItemByUid(uid)
      await row.scrollIntoView({ block: 'center', inline: 'nearest' })
      await row.click()
    }
    const first = liveTabs[0],
      last = liveTabs.at(-1)
    await select(first.uid)
    await chord([Key.Alt], Key.ArrowUp)
    await expect(await page.treeItemByUid(last.uid)).toHaveElementClass(
      'tree-item-selected',
    )
    await chord([Key.Alt], Key.ArrowDown)
    await expect(await page.treeItemByUid(first.uid)).toHaveElementClass(
      'tree-item-selected',
    )
    await select(fixture.uid)
    await browser.keys('F2')
    await $('.modal-input').setValue('Keyboard window title')
    await browser.keys('Enter')
    await page.waitForBackgroundTree(
      (items) =>
        items.find((item) => item.uid === fixture.uid)?.title ===
        'Keyboard window title',
      'Expected edited window title.',
    )
    await select(fixture.uid)
    await browser.keys('s')
    await page.waitForBackgroundTree((items) => {
      const window = items.find((item) => item.uid === fixture.uid)
      return (
        window?.state === 0 &&
        window.children
          .filter((item) => item.type === 1)
          .every((tab) => tab.state === 0)
      )
    }, 'Expected window and both tabs saved by keyboard.')
    await select(fixture.uid)
    await browser.keys('Enter')
    await browser.switchToWindow(popupHandle)
    await page.waitForBackgroundTree(
      (items) => items.find((item) => item.uid === fixture.uid)?.state === 1,
      'Expected Enter to reopen the saved window.',
    )
    await select(fixture.uid)
    await browser.keys('c')
    await page.waitForBackgroundTree(
      (items) => !items.some((item) => item.uid === fixture.uid),
      'Expected window closed and removed by keyboard.',
    )
    await expect(await page.treeItemByUid(fixture.uid)).not.toBeExisting()
    const focusedUid = await browser.execute(() =>
      document.activeElement
        ?.closest('.tree-item')
        ?.getAttribute('drag-and-drop-id'),
    )
    expect(focusedUid).toBeTruthy()
    await expect(await $('.tree-item-selected')).not.toBeExisting()
    await browser.keys('ArrowDown')
    await expect(await $('.tree-item-selected')).toBeExisting()
    await browser.waitUntil(
      async () =>
        browser.executeAsync((done) =>
          window.browser.tabs
            .query({})
            .then((tabs) =>
              done(
                !tabs.some((tab) =>
                  ['Keyboard window first', 'Keyboard window second'].includes(
                    tab.title,
                  ),
                ),
              ),
            ),
        ),
      { timeoutMsg: 'Expected the actual Firefox window and tabs to close.' },
    )
  })
  it('creates one snapshot from the tree and displays its success notification', async () => {
    await openTree()
    const before = (
      await sendSnapshotRequest({ action: 'listSessionSnapshots' })
    ).data.snapshots.map((item) => item.id)
    await withFirefoxChromeContext(() => chord([Key.Ctrl, Key.Alt], 'l'))
    await expect($('.sessiontree-notification')).toHaveText('Snapshot created.')
    const created = (
      await sendSnapshotRequest({ action: 'listSessionSnapshots' })
    ).data.snapshots.filter((item) => !before.includes(item.id))
    expect(created).toHaveLength(1)
    expect(created[0].trigger).toBe('manual')
    await sendSnapshotRequest({
      action: 'deleteSessionSnapshot',
      snapshotId: created[0].id,
    })
  })
})
