import { $, browser, expect } from '@wdio/globals'
import { Key } from 'webdriverio'
import {
  cleanupSeededTabs,
  navigateSeededHandle,
  openFixtureTab,
  seedSingleSessionTab,
  SESSION_FIXTURE_TITLES,
} from './support/session-fixtures.mjs'
import { SessionTreePage } from './support/session-tree-page.mjs'
import {
  closeSessionTreePopup,
  openSessionTreePopup,
} from './support/session-tree-popup.mjs'
import {
  dismissFirefoxContextMenu,
  readFirefoxContextMenu,
} from './support/firefox-chrome-context.mjs'

describe('Firefox context-menu and presentation workflows', () => {
  const NOTE_TEXT = 'Native menu note'
  let seed
  let popup
  let sessionTree

  beforeEach(async () => {
    seed = await seedSingleSessionTab()
    popup = await openSessionTreePopup()
    sessionTree = new SessionTreePage()
    await sessionTree.expectLoaded()
    await navigateSeededHandle(seed, SESSION_FIXTURE_TITLES.initial)
    await browser.switchToWindow(popup.popupHandle)
    await sessionTree.waitForItemTextVisible(SESSION_FIXTURE_TITLES.initial)
  })

  afterEach(async () => {
    try {
      await dismissFirefoxContextMenu()
    } catch {
      // The menu may already be closed by the failed assertion or Firefox.
    }
    if (popup?.popupHandle) {
      const handles = await browser.getWindowHandles()
      if (handles.includes(popup.popupHandle)) {
        await browser.switchToWindow(popup.popupHandle)
        await removePresentationItems()
      }
    }
    if (seed) await cleanupSeededTabs(seed)
    if (popup?.popupHandle) {
      const handles = await browser.getWindowHandles()
      if (handles.includes(popup.popupHandle)) {
        await browser.switchToWindow(popup.popupHandle)
        await closeSessionTreePopup(popup.originalHandle)
      }
    }
  })

  it('renders every extension context menu in native Firefox chrome', async () => {
    await sessionTree.sendTreeCommand({
      action: 'createNote',
      text: NOTE_TEXT,
    })
    await sessionTree.sendTreeCommand({ action: 'createSeparator' })
    await sessionTree.expectNoteVisible(NOTE_TEXT)

    const cases = [
      {
        name: 'window',
        open: () => sessionTree.openWindowContextMenu(),
        labels: ['Add Note', 'Duplicate', 'Edit Title'],
      },
      {
        name: 'tab',
        open: () =>
          sessionTree.openTabContextMenu(SESSION_FIXTURE_TITLES.initial),
        labels: ['Add Note', 'Open', 'Reload', 'Save', 'Close'],
      },
      {
        name: 'note',
        open: () => sessionTree.openNoteContextMenu(NOTE_TEXT),
        labels: ['Add Note', 'Duplicate', 'Edit Note', 'Remove Note'],
      },
      {
        name: 'separator',
        open: () => sessionTree.openSeparatorContextMenu(),
        labels: ['Add Note', 'Add Separator', 'Remove Separator'],
      },
      {
        name: 'panel',
        open: async () => {
          await sessionTree.captureContextMenuItems()
          await sessionTree.openPanelContextMenu()
          await browser.waitUntil(
            async () =>
              (await sessionTree.capturedContextMenuTitles()).includes(
                'Add Note',
              ),
            {
              timeout: 10_000,
              timeoutMsg:
                'Expected the panel handler to create extension menu items.',
            },
          )
        },
        labels: ['Add Note', 'Add Separator', 'New Window'],
      },
    ]

    for (const contextCase of cases) {
      try {
        await contextCase.open()
        const menu = await readFirefoxContextMenu()
        expect(menu.open).toBe(true)
        expect(menu.items.map((item) => item.label)).toEqual(
          expect.arrayContaining(contextCase.labels),
        )
        await dismissFirefoxContextMenu()
      } catch (error) {
        const capturedLabels =
          contextCase.name === 'panel'
            ? await sessionTree.capturedContextMenuTitles()
            : []
        throw new Error(
          `Native ${contextCase.name} context-menu assertion failed. Captured labels: ${JSON.stringify(capturedLabels)}`,
          { cause: error },
        )
      }
    }
  })

  it('clears native-menu selection and restores focus to its tree row', async () => {
    const tabItem = await sessionTree.tabItemByText(
      SESSION_FIXTURE_TITLES.initial,
    )
    await sessionTree.openTabContextMenu(SESSION_FIXTURE_TITLES.initial)
    await readFirefoxContextMenu()

    await dismissFirefoxContextMenu()

    await browser.waitUntil(
      async () =>
        browser.execute(
          (element) =>
            document.activeElement === element &&
            !element.classList.contains('tree-item-selected'),
          tabItem,
        ),
      {
        timeout: 10_000,
        timeoutMsg:
          'Expected native menu dismissal to clear selection and restore row focus.',
      },
    )
  })

  it('enables partially applicable commands for a mixed tab selection', async () => {
    await browser.switchToWindow(seed.handles[0])
    await openFixtureTab(seed, SESSION_FIXTURE_TITLES.alpha)
    await browser.switchToWindow(popup.popupHandle)
    await sessionTree.waitForBackgroundTree(
      (tree) =>
        tree.some(
          (item) =>
            item.type === 0 &&
            item.children.some(
              (child) =>
                child.type === 1 &&
                child.title.includes(SESSION_FIXTURE_TITLES.alpha),
            ),
        ),
      'Expected the mixed-selection live fixture in the background tree.',
    )
    await sessionTree.waitForItemTextVisible(SESSION_FIXTURE_TITLES.alpha)

    let savedTab
    let liveTab
    await sessionTree.waitForBackgroundTree((tree) => {
      const tabs = tree.flatMap((item) =>
        item.type === 0
          ? item.children.filter((child) => child.type === 1)
          : [],
      )
      savedTab = tabs.find((tab) =>
        tab.title.includes(SESSION_FIXTURE_TITLES.initial),
      )
      liveTab = tabs.find((tab) =>
        tab.title.includes(SESSION_FIXTURE_TITLES.alpha),
      )
      return Boolean(savedTab && liveTab)
    }, 'Expected both mixed-selection fixture tabs in the tree.')

    await sessionTree.sendTreeCommand({
      action: 'pinTab',
      tabUid: liveTab.uid,
    })
    await sessionTree.sendTreeCommand({
      action: 'saveTab',
      tabId: savedTab.id,
      tabUid: savedTab.uid,
    })
    await sessionTree.waitForBackgroundTree((tree) => {
      const tabs = tree.flatMap((item) =>
        item.type === 0
          ? item.children.filter((child) => child.type === 1)
          : [],
      )
      const saved = tabs.find((tab) => tab.uid === savedTab.uid)
      const live = tabs.find((tab) => tab.uid === liveTab.uid)
      return saved?.state === 0 && live?.state === 1 && live.pinned === true
    }, 'Expected one saved tab and one live pinned tab.')

    await sessionTree.selectTreeItemRange(
      SESSION_FIXTURE_TITLES.initial,
      SESSION_FIXTURE_TITLES.alpha,
    )
    await sessionTree.openTabContextMenu(SESSION_FIXTURE_TITLES.alpha)
    const menu = await readFirefoxContextMenu()
    const byLabel = new Map(menu.items.map((item) => [item.label, item]))

    for (const label of ['Open', 'Reload', 'Save', 'Close', 'Pin', 'Unpin']) {
      expect(byLabel.get(label)?.disabled).toBe(false)
    }
  })

  it('creates a normal window from the toolbar when none exists', async () => {
    const tree = await sessionTree.backgroundTreeSnapshot()
    const normalWindow = tree.find(
      (item) => item.type === 0 && item.state === 1,
    )
    expect(normalWindow?.id).toBeGreaterThan(0)

    const removeResult = await browser.executeAsync((windowId, done) => {
      window.browser.windows
        .remove(windowId)
        .then(() => done({ ok: true }))
        .catch((error) => done({ ok: false, error: String(error) }))
    }, normalWindow.id)
    expect(removeResult).toEqual({ ok: true })
    seed = undefined

    await browser.switchToWindow(popup.popupHandle)
    await sessionTree.waitForBackgroundTree(
      (items) =>
        !items.some(
          (item) => item.type === 0 && item.state === 1 && item.id >= 0,
        ),
      'Expected no open normal browser window in the session tree.',
    )
    for (const label of [
      'Add note',
      'Add separator',
      'New window',
      'New tab',
      'Settings',
    ]) {
      expect(await $(`button[aria-label="${label}"]`).isEnabled()).toBe(true)
    }

    await $('button[aria-label="New tab"]').click()

    await browser.waitUntil(
      async () => (await normalWindowIds()).length === 1,
      {
        timeout: 10_000,
        timeoutMsg: 'Expected New tab to create a normal browser window.',
      },
    )
    const newNormalHandle = (await browser.getWindowHandles()).find(
      (handle) => handle !== popup.popupHandle,
    )
    expect(newNormalHandle).toBeDefined()
    seed = { handles: [newNormalHandle], titles: [] }
  })

  it('keeps the toolbar fixed and the final tree row visible at maximum scroll', async () => {
    for (let index = 0; index < 50; index++) {
      await sessionTree.sendTreeCommand({
        action: 'createNote',
        text: `Scroll note ${String(index).padStart(2, '0')}`,
      })
    }
    await sessionTree.expectNoteVisible('Scroll note 49')

    const geometry = await browser.executeAsync((done) => {
      const content = document.querySelector('.sessiontree-content')
      const toolbar = document.querySelector('.session-tree-toolbar')
      const notes = document.querySelectorAll(
        '.tree-item[drag-and-drop-type="note"]',
      )
      const finalItem = notes[notes.length - 1]
      const toolbarTopBefore = toolbar.getBoundingClientRect().top
      content.scrollTop = content.scrollHeight
      requestAnimationFrame(() => {
        const contentRect = content.getBoundingClientRect()
        const finalRect = finalItem.getBoundingClientRect()
        const toolbarRect = toolbar.getBoundingClientRect()
        done({
          toolbarTopBefore,
          toolbarTopAfter: toolbarRect.top,
          contentTop: contentRect.top,
          contentBottom: contentRect.bottom,
          finalTop: finalRect.top,
          finalBottom: finalRect.bottom,
          scrollTop: content.scrollTop,
          maxScrollTop: content.scrollHeight - content.clientHeight,
        })
      })
    })

    expect(geometry.scrollTop).toBe(geometry.maxScrollTop)
    expect(geometry.toolbarTopAfter).toBeCloseTo(geometry.toolbarTopBefore, 1)
    expect(geometry.finalTop).toBeGreaterThanOrEqual(geometry.contentTop)
    expect(geometry.finalBottom).toBeLessThanOrEqual(geometry.contentBottom)
  })

  it('contains long text and a multiline modal in a narrow large-font popup', async () => {
    const longNote = `First line\n${'Long localized note text '.repeat(30)}`
    await sessionTree.sendTreeCommand({ action: 'createNote', text: longNote })
    await sessionTree.expectNoteVisible('First line')
    await browser.setWindowSize(240, 500)
    await browser.execute(() => {
      document.documentElement.style.setProperty('--font-size-xs', '20px')
    })
    const note = await sessionTree.noteItemByText('First line')
    await note.doubleClick()
    await expect(await $('.modal-container')).toBeDisplayed()

    const layout = await browser.execute(() => {
      const root = document.documentElement
      const toolbar = document.querySelector('.session-tree-toolbar')
      const buttons = Array.from(toolbar.querySelectorAll('button'))
      const noteItem = document.querySelector(
        '.tree-item[drag-and-drop-type="note"]',
      )
      const noteTitle = noteItem.querySelector('.tree-item-title')
      const modal = document.querySelector('.modal-container')
      const textarea = modal.querySelector('textarea')
      const modalRect = modal.getBoundingClientRect()
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        horizontalOverflow: root.scrollWidth - root.clientWidth,
        buttonsVisible: buttons.every((button) => {
          const rect = button.getBoundingClientRect()
          return (
            rect.width > 0 && rect.left >= 0 && rect.right <= window.innerWidth
          )
        }),
        noteWhiteSpace: getComputedStyle(noteTitle).whiteSpace,
        noteOverflow: getComputedStyle(noteTitle).textOverflow,
        noteScrollWidth: noteTitle.scrollWidth,
        noteClientWidth: noteTitle.clientWidth,
        modalLeft: modalRect.left,
        modalRight: modalRect.right,
        modalTop: modalRect.top,
        modalBottom: modalRect.bottom,
        multiline: textarea instanceof HTMLTextAreaElement,
      }
    })

    expect(layout.horizontalOverflow).toBeLessThanOrEqual(0)
    expect(layout.buttonsVisible).toBe(true)
    expect(layout.noteWhiteSpace).toBe('nowrap')
    expect(layout.noteOverflow).toBe('ellipsis')
    expect(layout.noteScrollWidth).toBeGreaterThan(layout.noteClientWidth)
    expect(layout.modalLeft).toBeGreaterThanOrEqual(0)
    expect(layout.modalRight).toBeLessThanOrEqual(layout.innerWidth)
    expect(layout.modalTop).toBeGreaterThanOrEqual(0)
    expect(layout.modalBottom).toBeLessThanOrEqual(layout.innerHeight)
    expect(layout.multiline).toBe(true)
  })

  it('traps modal focus, supports multiline notes, and restores row focus', async () => {
    await sessionTree.sendTreeCommand({
      action: 'createNote',
      text: 'Modal focus note',
    })
    await sessionTree.expectNoteVisible('Modal focus note')
    const note = await sessionTree.noteItemByText('Modal focus note')
    await note.doubleClick()
    const textarea = await $('.modal-textarea')
    const cancel = await $('.modal-buttons .btn-secondary')
    await expect(textarea).toBeFocused()

    await browser.keys([Key.Shift, Key.Tab])
    await expect(cancel).toBeFocused()
    await browser.keys(Key.Tab)
    await expect(textarea).toBeFocused()

    await textarea.clearValue()
    await textarea.setValue('First α')
    await browser.keys([Key.Shift, Key.Enter])
    await browser.keys('Second β')
    expect(await textarea.getValue()).toBe('First α\nSecond β')
    await browser.keys(Key.Enter)
    await sessionTree.expectNoteVisible('First α')

    const updatedNote = await sessionTree.noteItemByText('First α')
    await updatedNote.doubleClick()
    await expect(await $('.modal-textarea')).toBeFocused()
    await browser.keys(Key.Escape)
    await browser.waitUntil(
      async () =>
        browser.execute(
          (element) =>
            !document.querySelector('.modal-container') &&
            document.activeElement === element,
          updatedNote,
        ),
      {
        timeout: 10_000,
        timeoutMsg:
          'Expected Escape to close the modal and restore note-row focus.',
      },
    )
  })

  async function removePresentationItems() {
    const tree = await sessionTree.backgroundTreeSnapshot()
    const items = tree.flatMap((item) =>
      item.type === 0 ? [item, ...(item.children || [])] : [item],
    )
    for (const item of items) {
      if (item.type === 2) {
        await sessionTree.sendTreeCommand({
          action: 'removeNote',
          noteUid: item.uid,
        })
      } else if (item.type === 3) {
        await sessionTree.sendTreeCommand({
          action: 'removeSeparator',
          separatorUid: item.uid,
        })
      } else if (
        item.type === 1 &&
        item.state === 0 &&
        item.title?.includes('SF E2E')
      ) {
        await sessionTree.sendTreeCommand({
          action: 'closeTab',
          tabId: item.id,
          tabUid: item.uid,
        })
      }
    }
  }

  function normalWindowIds() {
    return browser.executeAsync((done) => {
      window.browser.windows
        .getAll({ windowTypes: ['normal'] })
        .then((windows) => done(windows.map((item) => item.id)))
        .catch((error) => done({ error: String(error) }))
    })
  }
})
