import { browser } from '@wdio/globals'
import {
  cleanupSeededTabs,
  closeSeededTab,
  extensionFixtureTitle,
  navigateSeededHandle,
  openExtensionFixtureTab,
  openFixtureTab,
  openFixtureWindow,
  openReloadableFixtureTab,
  seedSingleSessionTab,
  SESSION_FIXTURE_TITLES,
  switchToSeededHandle,
  trackExtensionFixtureTabByTitle,
  waitForExtensionTabClosed,
} from './support/session-fixtures.mjs'
import {
  DropPosition,
  childNotesOf,
  notesInWindow,
  openWindowsInTree,
  savedWindowsInTree,
  SessionTreePage,
  tabsInWindow,
  TreeItemState,
  windowsInTree,
} from './support/session-tree-page.mjs'
import {
  closeSessionTreePopup,
  openSessionTreePopup,
} from './support/session-tree-popup.mjs'
import { closeOptionsPage, openOptionsPage } from './support/options-page.mjs'

const NOTE_TEXT = 'New note'
const EDITED_NOTE_TEXT = 'Updated note'
const CUSTOM_LABEL_TEXT = 'Project Alpha'
const WINDOW_TITLE_TEXT = 'Project Window'

let seed
let popup
let sessionTree

describe('critical Firefox UI workflows', () => {
  afterEach(async () => {
    if (popup?.popupHandle) {
      const handles = await browser.getWindowHandles()
      if (handles.includes(popup.popupHandle)) {
        await browser.switchToWindow(popup.popupHandle)
        if (sessionTree) {
          await sessionTree.removeAllNotes()
          await sessionTree.updateSettings({
            saveWindowOnClose: false,
            saveTabOnClose: false,
          })
        }
      }
    }

    if (seed) {
      await cleanupSeededTabs(seed)
      seed = undefined
    }

    if (popup?.popupHandle) {
      const handles = await browser.getWindowHandles()
      if (handles.includes(popup.popupHandle)) {
        await browser.switchToWindow(popup.popupHandle)
        await closeSessionTreePopup(popup.originalHandle)
      }
    }

    popup = undefined
    sessionTree = undefined
  })

  it('adds two browser tabs and shows three open root tabs at the correct indent', async () => {
    await openSeededSessionTree()

    await switchToPrimaryBrowserWindow()
    await openFixtureTab(seed, SESSION_FIXTURE_TITLES.alpha)
    await openFixtureTab(seed, SESSION_FIXTURE_TITLES.beta)
    await browser.switchToWindow(popup.popupHandle)

    await expectSingleOpenWindowWithRootTabs([
      SESSION_FIXTURE_TITLES.initial,
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
    ])
  })

  it('adds a note from the window context menu as a window child', async () => {
    await openSeededSessionTree()

    await sessionTree.captureContextMenuItems()
    await sessionTree.openWindowContextMenu()
    await sessionTree.clickCapturedContextMenuItem('Add Note')

    await sessionTree.waitForBackgroundTree((tree) => {
      const windowItem = onlyOpenWindow(tree)
      if (!windowItem) return false

      const tabs = tabsInWindow(windowItem)
      const notes = notesInWindow(windowItem)
      return (
        windowItem.children.length === 2 &&
        tabs.length === 1 &&
        notes.length === 1 &&
        tabs[0].title === SESSION_FIXTURE_TITLES.initial &&
        tabs[0].indentLevel === 1 &&
        notes[0].text === NOTE_TEXT &&
        notes[0].parentUid === undefined &&
        notes[0].indentLevel === 1
      )
    }, 'Expected one open window with one root tab and one root note.')
  })

  it('edits a window title from the session tree context menu', async () => {
    await openSeededSessionTree()

    await sessionTree.captureContextMenuItems()
    await sessionTree.openWindowContextMenu()
    await sessionTree.clickCapturedContextMenuItem('Edit Title')
    await sessionTree.setEditTextModalValue(WINDOW_TITLE_TEXT)
    await sessionTree.confirmEditTextModal()
    await browser.switchToWindow(popup.popupHandle)

    await expectOnlyOpenWindowTitle(WINDOW_TITLE_TEXT)
    await sessionTree.waitForItemTextVisible(WINDOW_TITLE_TEXT)

    await updateOnlyOpenWindowTitle('')
    await expectOnlyOpenWindowTitle('')
  })

  it('saves a window from the session tree context menu and keeps it in the tree', async () => {
    await openSeededSessionTree()

    await switchToPrimaryBrowserWindow()
    const secondWindowHandle = await openFixtureWindow(
      seed,
      SESSION_FIXTURE_TITLES.secondWindow,
    )
    await browser.switchToWindow(popup.popupHandle)
    await updateWindowTitleContainingTab(
      SESSION_FIXTURE_TITLES.secondWindow,
      SESSION_FIXTURE_TITLES.secondWindow,
    )

    await sessionTree.captureContextMenuItems()
    await sessionTree.openWindowContextMenuByText(
      SESSION_FIXTURE_TITLES.secondWindow,
    )
    await sessionTree.clickCapturedContextMenuItem('Save')

    await waitForBrowserHandleClosed(
      secondWindowHandle,
      SESSION_FIXTURE_TITLES.secondWindow,
    )
    await expectOneOpenWindowAndOneSavedWindowWithRootTabs(
      [SESSION_FIXTURE_TITLES.initial],
      [SESSION_FIXTURE_TITLES.secondWindow],
    )
    await removeOnlySavedWindow()
    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
  })

  it('closes a window from the session tree context menu and removes it from the tree', async () => {
    await openSeededSessionTree()

    await switchToPrimaryBrowserWindow()
    const secondWindowHandle = await openFixtureWindow(
      seed,
      SESSION_FIXTURE_TITLES.secondWindow,
    )
    await browser.switchToWindow(popup.popupHandle)
    await updateWindowTitleContainingTab(
      SESSION_FIXTURE_TITLES.secondWindow,
      SESSION_FIXTURE_TITLES.secondWindow,
    )

    await sessionTree.captureContextMenuItems()
    await sessionTree.openWindowContextMenuByText(
      SESSION_FIXTURE_TITLES.secondWindow,
    )
    await sessionTree.clickCapturedContextMenuItem('Close')

    await waitForBrowserHandleClosed(
      secondWindowHandle,
      SESSION_FIXTURE_TITLES.secondWindow,
    )
    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
  })

  it('adds a note from the tab context menu as a child of the selected tab', async () => {
    await openSeededSessionTree()

    await addNoteFromTabContextMenu(SESSION_FIXTURE_TITLES.initial)

    await sessionTree.waitForBackgroundTree((tree) => {
      const windowItem = onlyOpenWindow(tree)
      if (!windowItem) return false

      const rootTabs = rootTabsInWindow(windowItem)
      if (rootTabs.length !== 1) return false

      const tab = rootTabs[0]
      const childNotes = childNotesOf(tab, windowItem)
      return (
        tab.title === SESSION_FIXTURE_TITLES.initial &&
        tab.indentLevel === 1 &&
        tab.isParent === true &&
        childNotes.length === 1 &&
        childNotes[0].text === NOTE_TEXT &&
        childNotes[0].indentLevel === 2
      )
    }, 'Expected one root tab with one child note.')
  })

  it('edits and removes a note from the note context menu', async () => {
    await openSeededSessionTree()

    await addNoteFromTabContextMenu(SESSION_FIXTURE_TITLES.initial)
    await sessionTree.expectNoteVisible(NOTE_TEXT)

    await sessionTree.captureContextMenuItems()
    await sessionTree.openNoteContextMenu(NOTE_TEXT)
    await sessionTree.clickCapturedContextMenuItem('Edit Note')
    await sessionTree.setEditTextModalValue(EDITED_NOTE_TEXT)
    await sessionTree.confirmEditTextModal()
    await browser.switchToWindow(popup.popupHandle)

    await expectSingleNoteText(EDITED_NOTE_TEXT)
    await sessionTree.expectNoteVisible(EDITED_NOTE_TEXT)

    await sessionTree.captureContextMenuItems()
    await sessionTree.openNoteContextMenu(EDITED_NOTE_TEXT)
    await sessionTree.clickCapturedContextMenuItem('Remove Note')

    await expectNoNotes()
    await sessionTree.expectNoteNotVisible(EDITED_NOTE_TEXT)
    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
  })

  it('adds a note under the first tab while a second root tab remains separate', async () => {
    await openSeededSessionTree()

    await switchToPrimaryBrowserWindow()
    await openFixtureTab(seed, SESSION_FIXTURE_TITLES.alpha)
    await browser.switchToWindow(popup.popupHandle)
    await addNoteFromTabContextMenu(SESSION_FIXTURE_TITLES.initial)

    await sessionTree.waitForBackgroundTree((tree) => {
      const windowItem = onlyOpenWindow(tree)
      if (!windowItem) return false

      const rootTabs = rootTabsInWindow(windowItem)
      const firstTab = rootTabs.find(
        (tab) => tab.title === SESSION_FIXTURE_TITLES.initial,
      )
      const secondTab = rootTabs.find(
        (tab) => tab.title === SESSION_FIXTURE_TITLES.alpha,
      )
      if (!firstTab || !secondTab || rootTabs.length !== 2) return false

      const childNotes = childNotesOf(firstTab, windowItem)
      return (
        firstTab.indentLevel === 1 &&
        secondTab.indentLevel === 1 &&
        secondTab.parentUid === undefined &&
        childNotes.length === 1 &&
        childNotes[0].text === NOTE_TEXT &&
        childNotes[0].parentUid === firstTab.uid &&
        childNotes[0].indentLevel === 2
      )
    }, 'Expected two root tabs with one note nested under the first tab.')
  })

  it('drags a tab onto another tab to nest it as a child', async () => {
    await openSeededSessionTree()

    await switchToPrimaryBrowserWindow()
    const alphaHandle = await openFixtureTab(seed, SESSION_FIXTURE_TITLES.alpha)
    await browser.switchToWindow(popup.popupHandle)

    await expectSingleOpenWindowWithRootTabs([
      SESSION_FIXTURE_TITLES.initial,
      SESSION_FIXTURE_TITLES.alpha,
    ])

    await sessionTree.dragTreeItem(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.initial,
      DropPosition.Middle,
    )
    await browser.switchToWindow(popup.popupHandle)

    await expectTabNestedUnder(
      SESSION_FIXTURE_TITLES.initial,
      SESSION_FIXTURE_TITLES.alpha,
    )

    await removeFixtureTab(SESSION_FIXTURE_TITLES.alpha)
    await waitForBrowserHandleClosed(alphaHandle, SESSION_FIXTURE_TITLES.alpha)
    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
  })

  it('Alt-copies an explicitly selected expanded parent and child hierarchy', async () => {
    await openSeededSessionTree()
    await sessionTree.updateSettings({
      enableCopyOnDragAndDrop: true,
      includeChildrenOfSelectedItems: 'collapsed',
    })

    await switchToPrimaryBrowserWindow()
    const alphaHandle = await openFixtureTab(seed, SESSION_FIXTURE_TITLES.alpha)
    const betaHandle = await openFixtureTab(seed, SESSION_FIXTURE_TITLES.beta)
    await browser.switchToWindow(popup.popupHandle)

    await sessionTree.dragTreeItem(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.initial,
      DropPosition.Middle,
    )
    await sessionTree.dragTreeItem(
      SESSION_FIXTURE_TITLES.beta,
      SESSION_FIXTURE_TITLES.alpha,
      DropPosition.Middle,
    )
    await sessionTree.selectTreeItemRange(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
    )
    await sessionTree.dragTreeItem(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.initial,
      DropPosition.Above,
      { altKey: true },
    )

    await sessionTree.waitForBackgroundTree((tree) => {
      const windowItem = onlyOpenWindow(tree)
      if (!windowItem) return false
      const tabs = tabsInWindow(windowItem)
      const alphaTabs = tabs.filter(
        (tab) => tab.title === SESSION_FIXTURE_TITLES.alpha,
      )
      const betaTabs = tabs.filter(
        (tab) => tab.title === SESSION_FIXTURE_TITLES.beta,
      )
      const initial = tabs.find(
        (tab) => tab.title === SESSION_FIXTURE_TITLES.initial,
      )
      const openAlpha = alphaTabs.find(
        (tab) => tab.state === TreeItemState.Open,
      )
      const copiedAlpha = alphaTabs.find(
        (tab) => tab.state === TreeItemState.Saved,
      )
      const openBeta = betaTabs.find((tab) => tab.state === TreeItemState.Open)
      const copiedBeta = betaTabs.find(
        (tab) => tab.state === TreeItemState.Saved,
      )

      return Boolean(
        initial &&
        openAlpha &&
        copiedAlpha &&
        openBeta &&
        copiedBeta &&
        openAlpha.parentUid === initial.uid &&
        openBeta.parentUid === openAlpha.uid &&
        copiedAlpha.parentUid === undefined &&
        copiedAlpha.indentLevel === 1 &&
        copiedBeta.parentUid === copiedAlpha.uid &&
        copiedBeta.indentLevel === 2,
      )
    }, 'Expected Alt-copy to preserve both explicitly selected tabs and their hierarchy.')
    await expectBrowserTabCountByTitle(SESSION_FIXTURE_TITLES.alpha, 1)
    await expectBrowserTabCountByTitle(SESSION_FIXTURE_TITLES.beta, 1)

    await removeSavedFixtureTab(SESSION_FIXTURE_TITLES.beta)
    await removeSavedFixtureTab(SESSION_FIXTURE_TITLES.alpha)
    await removeFixtureTab(SESSION_FIXTURE_TITLES.beta)
    await removeFixtureTab(SESSION_FIXTURE_TITLES.alpha)
    await waitForBrowserHandleClosed(betaHandle, SESSION_FIXTURE_TITLES.beta)
    await waitForBrowserHandleClosed(alphaHandle, SESSION_FIXTURE_TITLES.alpha)
    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
  })

  it('drags a tab below its descendant tab without blocking or corrupting the tree', async () => {
    await openSeededSessionTree()

    await switchToPrimaryBrowserWindow()
    const alphaHandle = await openFixtureTab(seed, SESSION_FIXTURE_TITLES.alpha)
    const betaHandle = await openFixtureTab(seed, SESSION_FIXTURE_TITLES.beta)
    await browser.switchToWindow(popup.popupHandle)

    await sessionTree.dragTreeItem(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.initial,
      DropPosition.Middle,
    )
    await sessionTree.dragTreeItem(
      SESSION_FIXTURE_TITLES.beta,
      SESSION_FIXTURE_TITLES.alpha,
      DropPosition.Middle,
    )

    await sessionTree.dragTreeItem(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
      DropPosition.Below,
    )

    await sessionTree.waitForBackgroundTree((tree) => {
      const windowItem = onlyOpenWindow(tree)
      if (!windowItem) return false
      const tabs = tabsInWindow(windowItem)
      const initial = tabs.find(
        (tab) => tab.title === SESSION_FIXTURE_TITLES.initial,
      )
      const alpha = tabs.find(
        (tab) => tab.title === SESSION_FIXTURE_TITLES.alpha,
      )
      const beta = tabs.find((tab) => tab.title === SESSION_FIXTURE_TITLES.beta)
      if (!initial || !alpha || !beta) return false

      const order = windowItem.children.map((item) => item.uid)
      return (
        order.indexOf(beta.uid) < order.indexOf(alpha.uid) &&
        initial.parentUid === undefined &&
        alpha.parentUid === initial.uid &&
        beta.parentUid === initial.uid &&
        alpha.indentLevel === 2 &&
        beta.indentLevel === 2
      )
    }, 'Expected dragged tab to move below its descendant without remaining blocked.')

    await removeFixtureTab(SESSION_FIXTURE_TITLES.beta)
    await removeFixtureTab(SESSION_FIXTURE_TITLES.alpha)
    await waitForBrowserHandleClosed(betaHandle, SESSION_FIXTURE_TITLES.beta)
    await waitForBrowserHandleClosed(alphaHandle, SESSION_FIXTURE_TITLES.alpha)
    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
  })

  it('promotes a remaining child tab to root after its parent is moved above another root tab', async () => {
    await openSeededSessionTree()

    await switchToPrimaryBrowserWindow()
    const alphaHandle = await openFixtureTab(seed, SESSION_FIXTURE_TITLES.alpha)
    const betaHandle = await openFixtureTab(seed, SESSION_FIXTURE_TITLES.beta)
    await browser.switchToWindow(popup.popupHandle)

    await sessionTree.dragTreeItem(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.initial,
      DropPosition.Middle,
    )
    await sessionTree.dragTreeItem(
      SESSION_FIXTURE_TITLES.beta,
      SESSION_FIXTURE_TITLES.initial,
      DropPosition.Middle,
    )
    await sessionTree.waitForBackgroundTree((tree) => {
      const windowItem = onlyOpenWindow(tree)
      if (!windowItem) return false
      const tabs = tabsInWindow(windowItem)
      const initial = tabs.find(
        (tab) => tab.title === SESSION_FIXTURE_TITLES.initial,
      )
      const alpha = tabs.find(
        (tab) => tab.title === SESSION_FIXTURE_TITLES.alpha,
      )
      const beta = tabs.find((tab) => tab.title === SESSION_FIXTURE_TITLES.beta)

      return (
        initial &&
        alpha &&
        beta &&
        alpha.parentUid === initial.uid &&
        beta.parentUid === initial.uid &&
        initial.isParent === true
      )
    }, 'Expected two child tabs nested under the initial tab.')

    await sessionTree.dragTreeItem(
      SESSION_FIXTURE_TITLES.beta,
      SESSION_FIXTURE_TITLES.initial,
      DropPosition.Above,
    )
    await sessionTree.waitForBackgroundTree((tree) => {
      const windowItem = onlyOpenWindow(tree)
      if (!windowItem) return false
      const tabs = tabsInWindow(windowItem)
      const initial = tabs.find(
        (tab) => tab.title === SESSION_FIXTURE_TITLES.initial,
      )
      const alpha = tabs.find(
        (tab) => tab.title === SESSION_FIXTURE_TITLES.alpha,
      )
      const beta = tabs.find((tab) => tab.title === SESSION_FIXTURE_TITLES.beta)
      if (!initial || !alpha || !beta) return false

      return (
        windowItem.children.map((item) => item.uid).join('|') ===
          [beta.uid, initial.uid, alpha.uid].join('|') &&
        beta.parentUid === undefined &&
        initial.parentUid === undefined &&
        alpha.parentUid === initial.uid &&
        initial.isParent === true
      )
    }, 'Expected the second child tab to become a root tab above the initial tab.')

    await sessionTree.dragTreeItem(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
      DropPosition.Above,
    )

    await sessionTree.waitForBackgroundTree((tree) => {
      const windowItem = onlyOpenWindow(tree)
      if (!windowItem) return false
      const tabs = tabsInWindow(windowItem)
      const initial = tabs.find(
        (tab) => tab.title === SESSION_FIXTURE_TITLES.initial,
      )
      const alpha = tabs.find(
        (tab) => tab.title === SESSION_FIXTURE_TITLES.alpha,
      )
      const beta = tabs.find((tab) => tab.title === SESSION_FIXTURE_TITLES.beta)
      if (!initial || !alpha || !beta) return false

      return (
        windowItem.children.map((item) => item.uid).join('|') ===
          [alpha.uid, beta.uid, initial.uid].join('|') &&
        alpha.parentUid === undefined &&
        beta.parentUid === undefined &&
        initial.parentUid === undefined &&
        alpha.indentLevel === 1 &&
        beta.indentLevel === 1 &&
        initial.indentLevel === 1 &&
        initial.isParent === false
      )
    }, 'Expected remaining child tab to become a root tab after moving above the former parent.')

    await removeFixtureTab(SESSION_FIXTURE_TITLES.beta)
    await removeFixtureTab(SESSION_FIXTURE_TITLES.alpha)
    await waitForBrowserHandleClosed(betaHandle, SESSION_FIXTURE_TITLES.beta)
    await waitForBrowserHandleClosed(alphaHandle, SESSION_FIXTURE_TITLES.alpha)
    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
  })

  it('drags a parent tab onto the middle of its child tab', async () => {
    await openSeededSessionTree()

    await switchToPrimaryBrowserWindow()
    const alphaHandle = await openFixtureTab(seed, SESSION_FIXTURE_TITLES.alpha)
    await browser.switchToWindow(popup.popupHandle)

    await sessionTree.dragTreeItem(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.initial,
      DropPosition.Middle,
    )
    await sessionTree.waitForBackgroundTree((tree) => {
      const windowItem = onlyOpenWindow(tree)
      if (!windowItem) return false
      const tabs = tabsInWindow(windowItem)
      const initial = tabs.find(
        (tab) => tab.title === SESSION_FIXTURE_TITLES.initial,
      )
      const alpha = tabs.find(
        (tab) => tab.title === SESSION_FIXTURE_TITLES.alpha,
      )

      return (
        initial &&
        alpha &&
        alpha.parentUid === initial.uid &&
        initial.isParent === true
      )
    }, 'Expected alpha to be nested under the initial tab before the descendant mid drop.')

    await sessionTree.dragTreeItem(
      SESSION_FIXTURE_TITLES.initial,
      SESSION_FIXTURE_TITLES.alpha,
      DropPosition.Middle,
    )

    await sessionTree.waitForBackgroundTree((tree) => {
      const windowItem = onlyOpenWindow(tree)
      if (!windowItem) return false
      const tabs = tabsInWindow(windowItem)
      const initial = tabs.find(
        (tab) => tab.title === SESSION_FIXTURE_TITLES.initial,
      )
      const alpha = tabs.find(
        (tab) => tab.title === SESSION_FIXTURE_TITLES.alpha,
      )
      if (!initial || !alpha) return false

      return (
        windowItem.children.map((item) => item.uid).join('|') ===
          [alpha.uid, initial.uid].join('|') &&
        alpha.parentUid === undefined &&
        initial.parentUid === alpha.uid &&
        alpha.indentLevel === 1 &&
        initial.indentLevel === 2 &&
        alpha.isParent === true &&
        initial.isParent === false
      )
    }, 'Expected parent tab to become a child of the child tab after a mid drop.')

    await removeFixtureTab(SESSION_FIXTURE_TITLES.alpha)
    await waitForBrowserHandleClosed(alphaHandle, SESSION_FIXTURE_TITLES.alpha)
    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
  })

  it('drags a note onto the middle of its descendant note', async () => {
    await openSeededSessionTree()

    const windowItem = await onlyTrackedOpenWindow()
    await sessionTree.sendTreeCommand({
      action: 'createNote',
      parentUid: windowItem.uid,
      text: 'Parent note',
    })
    const parentNoteUid = await noteUidByText('Parent note')
    await sessionTree.sendTreeCommand({
      action: 'createNote',
      parentUid: parentNoteUid,
      text: 'Child note',
    })
    await browser.switchToWindow(popup.popupHandle)
    await sessionTree.expectNoteVisible('Parent note')
    await sessionTree.expectNoteVisible('Child note')

    await sessionTree.dragTreeItem(
      'Parent note',
      'Child note',
      DropPosition.Middle,
    )

    await sessionTree.waitForBackgroundTree((tree) => {
      const windowItem = onlyOpenWindow(tree)
      if (!windowItem) return false
      const notes = notesInWindow(windowItem)
      const parent = notes.find((note) => note.text === 'Parent note')
      const child = notes.find((note) => note.text === 'Child note')
      if (!parent || !child) return false

      const order = windowItem.children.map((item) => item.uid)
      return (
        order.indexOf(child.uid) < order.indexOf(parent.uid) &&
        child.parentUid === undefined &&
        parent.parentUid === child.uid &&
        child.indentLevel === 1 &&
        parent.indentLevel === 2
      )
    }, 'Expected note to be dropped onto the middle of its descendant note.')
  })

  it('adds a browser window and shows two open windows with one tab each', async () => {
    await openSeededSessionTree()

    await switchToPrimaryBrowserWindow()
    await openFixtureWindow(seed, SESSION_FIXTURE_TITLES.secondWindow)
    await browser.switchToWindow(popup.popupHandle)

    await sessionTree.waitForBackgroundTree((tree) => {
      const openWindows = openWindowsInTree(tree)
      if (openWindows.length !== 2) return false

      return openWindows.every((windowItem) => {
        const tabs = tabsInWindow(windowItem)
        return (
          windowItem.indentLevel === 0 &&
          tabs.length === 1 &&
          tabs[0].state === TreeItemState.Open &&
          tabs[0].indentLevel === 1
        )
      })
    }, 'Expected two open windows with one open tab each.')
  })

  it('removes a browser-closed tab from the session tree', async () => {
    await openSeededSessionTree()

    await switchToPrimaryBrowserWindow()
    await openFixtureTab(seed, SESSION_FIXTURE_TITLES.alpha)
    await browser.switchToWindow(popup.popupHandle)
    await expectSingleOpenWindowWithRootTabs([
      SESSION_FIXTURE_TITLES.initial,
      SESSION_FIXTURE_TITLES.alpha,
    ])
    await closeSeededTab(seed, SESSION_FIXTURE_TITLES.alpha)
    await browser.switchToWindow(popup.popupHandle)

    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
  })

  it('saves a browser-closed tab after enabling Save Tab When Closed in options', async () => {
    await openSeededSessionTree()

    const options = await openOptionsPage()
    await options.page.setToggle('Save Tab When Closed', 'On')
    await options.page.expectStoredSetting('saveTabOnClose', true)
    await closeOptionsPage(options.optionsHandle, popup.popupHandle)
    await sessionTree.expectLoaded()
    await removeOnlySavedWindow()
    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])

    await switchToPrimaryBrowserWindow()
    await openFixtureTab(seed, SESSION_FIXTURE_TITLES.alpha)
    await browser.switchToWindow(popup.popupHandle)

    await expectSingleOpenWindowWithRootTabs([
      SESSION_FIXTURE_TITLES.initial,
      SESSION_FIXTURE_TITLES.alpha,
    ])

    await closeSeededTab(seed, SESSION_FIXTURE_TITLES.alpha)
    await browser.switchToWindow(popup.popupHandle)

    await expectSingleOpenWindowWithRootTabsByState([
      { title: SESSION_FIXTURE_TITLES.initial, state: TreeItemState.Open },
      { title: SESSION_FIXTURE_TITLES.alpha, state: TreeItemState.Saved },
    ])
    await removeSavedFixtureTab(SESSION_FIXTURE_TITLES.alpha)
    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
  })

  it('closes a tab from the session tree context menu and removes it from the tree', async () => {
    await openSeededSessionTree()

    await switchToPrimaryBrowserWindow()
    const alphaHandle = await openFixtureTab(seed, SESSION_FIXTURE_TITLES.alpha)
    await browser.switchToWindow(popup.popupHandle)

    await expectSingleOpenWindowWithRootTabs([
      SESSION_FIXTURE_TITLES.initial,
      SESSION_FIXTURE_TITLES.alpha,
    ])
    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(SESSION_FIXTURE_TITLES.alpha)
    await sessionTree.clickCapturedContextMenuItem('Close')

    await waitForBrowserHandleClosed(alphaHandle, SESSION_FIXTURE_TITLES.alpha)
    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
  })

  it('saves a tab from the session tree context menu and keeps it in the tree', async () => {
    await openSeededSessionTree()

    await switchToPrimaryBrowserWindow()
    const alphaHandle = await openFixtureTab(seed, SESSION_FIXTURE_TITLES.alpha)
    await browser.switchToWindow(popup.popupHandle)

    await expectSingleOpenWindowWithRootTabs([
      SESSION_FIXTURE_TITLES.initial,
      SESSION_FIXTURE_TITLES.alpha,
    ])
    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(SESSION_FIXTURE_TITLES.alpha)
    await sessionTree.clickCapturedContextMenuItem('Save')

    await waitForBrowserHandleClosed(alphaHandle, SESSION_FIXTURE_TITLES.alpha)
    await expectSingleOpenWindowWithRootTabsByState([
      { title: SESSION_FIXTURE_TITLES.initial, state: TreeItemState.Open },
      { title: SESSION_FIXTURE_TITLES.alpha, state: TreeItemState.Saved },
    ])
    await removeSavedFixtureTab(SESSION_FIXTURE_TITLES.alpha)
    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
  })

  it('opens a saved tab from the session tree context menu', async () => {
    await openSeededSessionTree()
    const alphaTitle = extensionFixtureTitle(SESSION_FIXTURE_TITLES.alpha)

    const windowItem = await onlyTrackedOpenWindow()
    const alphaTab = await openExtensionFixtureTab(
      seed,
      SESSION_FIXTURE_TITLES.alpha,
      windowItem.id,
    )
    await browser.switchToWindow(popup.popupHandle)

    await expectSingleOpenWindowWithRootTabs([
      SESSION_FIXTURE_TITLES.initial,
      alphaTitle,
    ])
    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(alphaTitle)
    await sessionTree.clickCapturedContextMenuItem('Save')

    await waitForExtensionTabClosed(alphaTab.browserTabId, alphaTitle)
    await expectSingleOpenWindowWithRootTabsByState([
      { title: SESSION_FIXTURE_TITLES.initial, state: TreeItemState.Open },
      { title: alphaTitle, state: TreeItemState.Saved },
    ])

    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(alphaTitle)
    await sessionTree.clickCapturedContextMenuItem('Open')
    const reopenedTabId = await trackExtensionFixtureTabByTitle(
      seed,
      alphaTitle,
    )
    await browser.switchToWindow(popup.popupHandle)

    await expectSingleOpenWindowWithRootTabs([
      SESSION_FIXTURE_TITLES.initial,
      alphaTitle,
    ])
    await removeFixtureTab(alphaTitle)
    await waitForExtensionTabClosed(reopenedTabId, alphaTitle)
    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
  })

  it('pins and unpins a tab from the session tree context menu', async () => {
    await openSeededSessionTree()

    await switchToPrimaryBrowserWindow()
    const alphaHandle = await openFixtureTab(seed, SESSION_FIXTURE_TITLES.alpha)
    await browser.switchToWindow(popup.popupHandle)

    await expectSingleOpenWindowWithRootTabs([
      SESSION_FIXTURE_TITLES.initial,
      SESSION_FIXTURE_TITLES.alpha,
    ])
    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(SESSION_FIXTURE_TITLES.alpha)
    await sessionTree.clickCapturedContextMenuItem('Pin')

    await expectSingleOpenWindowWithRootTabsByPinned([
      { title: SESSION_FIXTURE_TITLES.initial, pinned: false },
      { title: SESSION_FIXTURE_TITLES.alpha, pinned: true },
    ])
    await expectBrowserTabPinned(SESSION_FIXTURE_TITLES.alpha, true)

    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(SESSION_FIXTURE_TITLES.alpha)
    await sessionTree.clickCapturedContextMenuItem('Unpin')

    await expectSingleOpenWindowWithRootTabsByPinned([
      { title: SESSION_FIXTURE_TITLES.initial, pinned: false },
      { title: SESSION_FIXTURE_TITLES.alpha, pinned: false },
    ])
    await expectBrowserTabPinned(SESSION_FIXTURE_TITLES.alpha, false)

    await removeFixtureTab(SESSION_FIXTURE_TITLES.alpha)
    await waitForBrowserHandleClosed(alphaHandle, SESSION_FIXTURE_TITLES.alpha)
    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
  })

  it('reloads a tab from the session tree context menu', async () => {
    await openSeededSessionTree()

    await switchToPrimaryBrowserWindow()
    const reloadTab = await openReloadableFixtureTab(
      seed,
      SESSION_FIXTURE_TITLES.reload,
    )
    const firstReloadTitle = reloadTab.title
    await browser.switchToWindow(popup.popupHandle)

    await expectSingleOpenWindowWithRootTabs([
      SESSION_FIXTURE_TITLES.initial,
      firstReloadTitle,
    ])
    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(firstReloadTitle)
    await sessionTree.clickCapturedContextMenuItem('Reload')

    await browser.switchToWindow(reloadTab.handle)
    const secondReloadTitle = await waitForBrowserTitleChanged(
      firstReloadTitle,
      `${SESSION_FIXTURE_TITLES.reload} `,
    )
    await browser.switchToWindow(popup.popupHandle)
    await expectSingleOpenWindowWithRootTabs([
      SESSION_FIXTURE_TITLES.initial,
      secondReloadTitle,
    ])

    await removeFixtureTab(secondReloadTitle)
    await waitForBrowserHandleClosed(reloadTab.handle, secondReloadTitle)
    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
  })

  it('duplicates a tab from the session tree context menu', async () => {
    await openSeededSessionTree()

    await switchToPrimaryBrowserWindow()
    const alphaHandle = await openFixtureTab(seed, SESSION_FIXTURE_TITLES.alpha)
    await browser.switchToWindow(popup.popupHandle)

    await expectSingleOpenWindowWithRootTabs([
      SESSION_FIXTURE_TITLES.initial,
      SESSION_FIXTURE_TITLES.alpha,
    ])
    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(SESSION_FIXTURE_TITLES.alpha)
    await sessionTree.clickCapturedContextMenuItem('Duplicate')

    await expectSingleOpenWindowWithRootTabsByState([
      { title: SESSION_FIXTURE_TITLES.initial, state: TreeItemState.Open },
      { title: SESSION_FIXTURE_TITLES.alpha, state: TreeItemState.Open },
      { title: SESSION_FIXTURE_TITLES.alpha, state: TreeItemState.Saved },
    ])
    await expectBrowserTabCountByTitle(SESSION_FIXTURE_TITLES.alpha, 1)

    await removeSavedFixtureTab(SESSION_FIXTURE_TITLES.alpha)
    await removeFixtureTab(SESSION_FIXTURE_TITLES.alpha)
    await waitForBrowserTitleCount(SESSION_FIXTURE_TITLES.alpha, 0)
    await waitForBrowserHandleClosed(alphaHandle, SESSION_FIXTURE_TITLES.alpha)
    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
  })

  it('increases and decreases tab indent from the session tree context menu', async () => {
    await openSeededSessionTree()

    await switchToPrimaryBrowserWindow()
    const alphaHandle = await openFixtureTab(seed, SESSION_FIXTURE_TITLES.alpha)
    await browser.switchToWindow(popup.popupHandle)

    await expectSingleOpenWindowWithRootTabs([
      SESSION_FIXTURE_TITLES.initial,
      SESSION_FIXTURE_TITLES.alpha,
    ])
    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(SESSION_FIXTURE_TITLES.alpha)
    await sessionTree.clickCapturedContextMenuItem('Increase Indent')

    await expectTabNestedUnder(
      SESSION_FIXTURE_TITLES.initial,
      SESSION_FIXTURE_TITLES.alpha,
    )

    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(SESSION_FIXTURE_TITLES.alpha)
    await sessionTree.clickCapturedContextMenuItem('Decrease Indent')

    await expectSingleOpenWindowWithRootTabs([
      SESSION_FIXTURE_TITLES.initial,
      SESSION_FIXTURE_TITLES.alpha,
    ])
    await expectTabNotParent(SESSION_FIXTURE_TITLES.initial)

    await removeFixtureTab(SESSION_FIXTURE_TITLES.alpha)
    await waitForBrowserHandleClosed(alphaHandle, SESSION_FIXTURE_TITLES.alpha)
    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
  })

  it('edits a tab custom label from the session tree context menu', async () => {
    await openSeededSessionTree()

    await switchToPrimaryBrowserWindow()
    const alphaHandle = await openFixtureTab(seed, SESSION_FIXTURE_TITLES.alpha)
    await browser.switchToWindow(popup.popupHandle)

    await expectSingleOpenWindowWithRootTabs([
      SESSION_FIXTURE_TITLES.initial,
      SESSION_FIXTURE_TITLES.alpha,
    ])
    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(SESSION_FIXTURE_TITLES.alpha)
    await sessionTree.clickCapturedContextMenuItem('Edit Label')
    await sessionTree.setEditTextModalValue(CUSTOM_LABEL_TEXT)
    await sessionTree.confirmEditTextModal()
    await browser.switchToWindow(popup.popupHandle)

    await expectTabCustomLabel(SESSION_FIXTURE_TITLES.alpha, CUSTOM_LABEL_TEXT)
    await sessionTree.waitForItemTextVisible(CUSTOM_LABEL_TEXT)

    await removeFixtureTab(SESSION_FIXTURE_TITLES.alpha)
    await waitForBrowserHandleClosed(alphaHandle, SESSION_FIXTURE_TITLES.alpha)
    await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
  })

  it('removes or saves a browser-closed window based on the close-window setting', async () => {
    await openSeededSessionTree()

    await sessionTree.updateSettings({ saveWindowOnClose: false })
    await switchToPrimaryBrowserWindow()
    await openFixtureWindow(seed, SESSION_FIXTURE_TITLES.secondWindow)
    await closeSeededTab(seed, SESSION_FIXTURE_TITLES.secondWindow)
    await browser.switchToWindow(popup.popupHandle)

    await sessionTree.waitForBackgroundTree((tree) => {
      return (
        windowsInTree(tree).length === 1 &&
        openWindowsInTree(tree).length === 1 &&
        savedWindowsInTree(tree).length === 0 &&
        rootTabsInWindow(openWindowsInTree(tree)[0]).length === 1
      )
    }, 'Expected the browser-closed window to be removed when save-on-close is disabled.')

    await sessionTree.updateSettings({ saveWindowOnClose: true })
    await switchToPrimaryBrowserWindow()
    await openFixtureWindow(seed, SESSION_FIXTURE_TITLES.gamma)
    await closeSeededTab(seed, SESSION_FIXTURE_TITLES.gamma)
    await browser.switchToWindow(popup.popupHandle)

    await sessionTree.waitForBackgroundTree((tree) => {
      const openWindows = openWindowsInTree(tree)
      const savedWindows = savedWindowsInTree(tree)
      if (openWindows.length !== 1 || savedWindows.length !== 1) return false

      const openTabs = rootTabsInWindow(openWindows[0])
      const savedTabs = tabsInWindow(savedWindows[0])
      return (
        openTabs.length === 1 &&
        openTabs[0].title === SESSION_FIXTURE_TITLES.initial &&
        openTabs[0].state === TreeItemState.Open &&
        savedTabs.length === 1 &&
        savedTabs[0].title === SESSION_FIXTURE_TITLES.gamma &&
        savedTabs[0].state === TreeItemState.Saved
      )
    }, 'Expected one open window/tab and one saved window/tab after enabling save-on-close.')
  })
})

async function openSeededSessionTree() {
  seed = await seedSingleSessionTab()
  popup = await openSessionTreePopup()
  sessionTree = new SessionTreePage()
  await sessionTree.expectLoaded()
  await sessionTree.updateSettings({
    saveWindowOnClose: false,
    saveTabOnClose: false,
  })
  await navigateSeededHandle(seed, SESSION_FIXTURE_TITLES.initial)
  await browser.switchToWindow(popup.popupHandle)
  await ensureSeededWindowTracked()
  await expectSingleOpenWindowWithRootTabs([SESSION_FIXTURE_TITLES.initial])
}

async function addNoteFromTabContextMenu(tabTitle) {
  await sessionTree.captureContextMenuItems()
  await sessionTree.openTabContextMenu(tabTitle)
  await sessionTree.clickCapturedContextMenuItem('Add Note')
}

async function switchToPrimaryBrowserWindow() {
  if (!seed) {
    throw new Error('Session fixture has not been initialized.')
  }

  await switchToSeededHandle(seed, SESSION_FIXTURE_TITLES.initial)
}

async function ensureSeededWindowTracked() {
  const tree = await sessionTree.backgroundTreeSnapshot()
  if (treeHasOpenRootTabs(tree, [SESSION_FIXTURE_TITLES.initial])) return

  await closeSeededTab(seed, SESSION_FIXTURE_TITLES.initial)
  await openFixtureWindow(seed, SESSION_FIXTURE_TITLES.initial)
  await browser.switchToWindow(popup.popupHandle)
}

async function expectSingleOpenWindowWithRootTabs(tabTitles) {
  await sessionTree.waitForBackgroundTree(
    (tree) => treeHasOpenRootTabs(tree, tabTitles),
    `Expected one open window with root tabs: ${tabTitles.join(', ')}.`,
  )
}

async function expectSingleOpenWindowWithRootTabsByState(expectedTabs) {
  await sessionTree.waitForBackgroundTree(
    (tree) => treeHasRootTabsWithState(tree, expectedTabs),
    `Expected one open window with root tab states: ${expectedTabs
      .map((tab) => `${tab.title}:${tab.state}`)
      .join(', ')}.`,
  )
}

async function expectSingleOpenWindowWithRootTabsByPinned(expectedTabs) {
  await sessionTree.waitForBackgroundTree(
    (tree) => treeHasRootTabsWithPinned(tree, expectedTabs),
    `Expected one open window with root tab pinned states: ${expectedTabs
      .map((tab) => `${tab.title}:${tab.pinned}`)
      .join(', ')}.`,
  )
}

async function expectSingleOpenWindowWithRootTabCounts(expectedTabs) {
  await sessionTree.waitForBackgroundTree(
    (tree) => treeHasRootTabCounts(tree, expectedTabs),
    `Expected one open window with root tab counts: ${expectedTabs
      .map((tab) => `${tab.title}:${tab.count}`)
      .join(', ')}.`,
  )
}

async function expectBrowserTabPinned(title, pinned) {
  await browser.waitUntil(
    async () => {
      const tab = await browserTabByTreeTitle(title)
      return tab?.pinned === pinned
    },
    {
      timeout: 10_000,
      timeoutMsg: `Expected browser tab "${title}" pinned state to be ${pinned}.`,
    },
  )
}

async function expectBrowserTabCountByTitle(title, count) {
  await browser.waitUntil(
    async () => (await browserTitleCount(title)) === count,
    {
      timeout: 10_000,
      timeoutMsg: `Expected ${count} browser tab(s) titled "${title}".`,
    },
  )
}

async function expectOnlyOpenWindowTitle(title) {
  await sessionTree.waitForBackgroundTree((tree) => {
    const windowItem = onlyOpenWindow(tree)
    return (
      windowItem !== undefined &&
      windowsInTree(tree).length === 1 &&
      windowItem.title === title
    )
  }, `Expected one open window title to be "${title}".`)
}

async function expectSingleSavedWindowWithRootTabs(tabTitles) {
  await sessionTree.waitForBackgroundTree(
    (tree) => {
      const savedWindows = savedWindowsInTree(tree)
      if (savedWindows.length !== 1 || openWindowsInTree(tree).length !== 0) {
        return false
      }

      const rootTabs = rootTabsInWindow(savedWindows[0])
      if (rootTabs.length !== tabTitles.length) return false

      return tabTitles.every((title) =>
        rootTabs.some(
          (tab) =>
            tab.title === title &&
            tab.state === TreeItemState.Saved &&
            tab.parentUid === undefined &&
            tab.indentLevel === 1,
        ),
      )
    },
    `Expected one saved window with root tabs: ${tabTitles.join(', ')}.`,
  )
}

async function expectOneOpenWindowAndOneSavedWindowWithRootTabs(
  openTabTitles,
  savedTabTitles,
) {
  await sessionTree.waitForBackgroundTree((tree) => {
    const openWindows = openWindowsInTree(tree)
    const savedWindows = savedWindowsInTree(tree)
    if (openWindows.length !== 1 || savedWindows.length !== 1) {
      return false
    }

    return (
      rootTabsMatchState(openWindows[0], openTabTitles, TreeItemState.Open) &&
      rootTabsMatchState(savedWindows[0], savedTabTitles, TreeItemState.Saved)
    )
  }, `Expected one open window and one saved window with root tabs.`)
}

async function expectSingleNoteText(text) {
  await sessionTree.waitForBackgroundTree((tree) => {
    const notes = windowsInTree(tree).flatMap((windowItem) =>
      notesInWindow(windowItem),
    )
    return notes.length === 1 && notes[0].text === text
  }, `Expected one note with text "${text}".`)
}

async function noteUidByText(text) {
  const tree = await sessionTree.backgroundTreeSnapshot()
  const note = windowsInTree(tree)
    .flatMap((windowItem) => notesInWindow(windowItem))
    .find((candidate) => candidate.text === text)

  if (!note) {
    throw new Error(`Expected note "${text}" to exist.`)
  }

  return note.uid
}

async function expectNoNotes() {
  await sessionTree.waitForBackgroundTree((tree) => {
    return windowsInTree(tree).every(
      (windowItem) => notesInWindow(windowItem).length === 0,
    )
  }, 'Expected no notes in the session tree.')
}

async function expectTabNestedUnder(parentTitle, childTitle) {
  await sessionTree.waitForBackgroundTree((tree) => {
    const windowItem = onlyOpenWindow(tree)
    if (!windowItem || windowsInTree(tree).length !== 1) return false

    const tabs = tabsInWindow(windowItem)
    const parentTab = tabs.find((tab) => tab.title === parentTitle)
    const childTab = tabs.find((tab) => tab.title === childTitle)
    if (!parentTab || !childTab) return false

    return (
      parentTab.parentUid === undefined &&
      parentTab.isParent === true &&
      parentTab.indentLevel === 1 &&
      childTab.parentUid === parentTab.uid &&
      childTab.indentLevel === 2
    )
  }, `Expected tab "${childTitle}" to be nested under "${parentTitle}".`)
}

async function expectTabNotParent(title) {
  await sessionTree.waitForBackgroundTree((tree) => {
    const windowItem = onlyOpenWindow(tree)
    if (!windowItem || windowsInTree(tree).length !== 1) return false

    const tab = tabsInWindow(windowItem).find(
      (candidate) => candidate.title === title,
    )
    return tab?.isParent === false
  }, `Expected tab "${title}" not to be a parent.`)
}

async function expectTabCustomLabel(title, customLabel) {
  await sessionTree.waitForBackgroundTree((tree) => {
    const matchingTabs = windowsInTree(tree)
      .flatMap((windowItem) => tabsInWindow(windowItem))
      .filter((tab) => tab.title === title)

    return (
      matchingTabs.length === 1 && matchingTabs[0].customLabel === customLabel
    )
  }, `Expected tab "${title}" custom label to be "${customLabel}".`)
}

async function removeSavedFixtureTab(title) {
  await removeFixtureTab(title, TreeItemState.Saved)
}

async function updateOnlyOpenWindowTitle(title) {
  const tree = await sessionTree.backgroundTreeSnapshot()
  const windowItem = onlyOpenWindow(tree)
  if (!windowItem) {
    throw new Error('Expected exactly one open window to update title.')
  }

  await sessionTree.sendTreeCommand({
    action: 'updateWindowTitle',
    windowUid: windowItem.uid,
    newTitle: title,
  })
}

async function updateWindowTitleContainingTab(tabTitle, windowTitle) {
  const tree = await sessionTree.backgroundTreeSnapshot()
  const windowItem = windowsInTree(tree).find((candidate) =>
    tabsInWindow(candidate).some((tab) => tab.title === tabTitle),
  )
  if (!windowItem) {
    throw new Error(`Expected a window containing tab "${tabTitle}".`)
  }

  await sessionTree.sendTreeCommand({
    action: 'updateWindowTitle',
    windowUid: windowItem.uid,
    newTitle: windowTitle,
  })
  await expectWindowTitleContainingTab(tabTitle, windowTitle)
}

async function expectWindowTitleContainingTab(tabTitle, windowTitle) {
  await sessionTree.waitForBackgroundTree((tree) => {
    const windowItem = windowsInTree(tree).find((candidate) =>
      tabsInWindow(candidate).some((tab) => tab.title === tabTitle),
    )
    return windowItem?.title === windowTitle
  }, `Expected window containing tab "${tabTitle}" to be titled "${windowTitle}".`)
}

async function removeOnlySavedWindow() {
  const savedWindow = await onlySavedWindow()

  await sessionTree.sendTreeCommand({
    action: 'closeWindow',
    windowId: savedWindow.id,
    windowUid: savedWindow.uid,
  })
}

async function onlySavedWindow() {
  const tree = await sessionTree.backgroundTreeSnapshot()
  const savedWindows = savedWindowsInTree(tree)
  if (savedWindows.length !== 1) {
    throw new Error('Expected exactly one saved window.')
  }
  return savedWindows[0]
}

async function expectNoSessionWindows() {
  await sessionTree.waitForBackgroundTree(
    (tree) => windowsInTree(tree).length === 0,
    'Expected no session windows in the tree.',
  )
}

async function removeFixtureTabs(title, count) {
  for (let index = 0; index < count; index += 1) {
    await removeFixtureTab(title)
  }
}

async function removeFixtureTab(title, state) {
  const tree = await sessionTree.backgroundTreeSnapshot()
  const matchingTab = windowsInTree(tree)
    .flatMap((windowItem) => tabsInWindow(windowItem))
    .find(
      (tab) =>
        tab.title === title && (state === undefined || tab.state === state),
    )

  if (!matchingTab) {
    throw new Error(`Expected fixture tab "${title}" to exist.`)
  }

  await sessionTree.sendTreeCommand({
    action: 'closeTab',
    tabId: matchingTab.id,
    tabUid: matchingTab.uid,
  })
}

async function onlyTrackedOpenWindow() {
  const tree = await sessionTree.backgroundTreeSnapshot()
  const windowItem = onlyOpenWindow(tree)
  if (!windowItem) {
    throw new Error('Expected exactly one open window in the session tree.')
  }
  return windowItem
}

function treeHasOpenRootTabs(tree, tabTitles) {
  return treeHasRootTabsWithState(
    tree,
    tabTitles.map((title) => ({ title, state: TreeItemState.Open })),
  )
}

function treeHasRootTabsWithState(tree, expectedTabs) {
  const windowItem = onlyOpenWindow(tree)
  if (!windowItem || windowsInTree(tree).length !== 1) return false

  const rootTabs = rootTabsInWindow(windowItem)
  if (rootTabs.length !== expectedTabs.length) return false

  const unmatchedTabs = [...rootTabs]
  return expectedTabs.every((expected) => {
    const matchingIndex = unmatchedTabs.findIndex(
      (tab) =>
        tab.title === expected.title &&
        tab.state === expected.state &&
        tab.parentUid === undefined &&
        tab.indentLevel === 1,
    )
    if (matchingIndex === -1) return false
    unmatchedTabs.splice(matchingIndex, 1)
    return true
  })
}

function treeHasRootTabsWithPinned(tree, expectedTabs) {
  const windowItem = onlyOpenWindow(tree)
  if (!windowItem || windowsInTree(tree).length !== 1) return false

  const rootTabs = rootTabsInWindow(windowItem)
  if (rootTabs.length !== expectedTabs.length) return false

  return expectedTabs.every((expected) =>
    rootTabs.some(
      (tab) =>
        tab.title === expected.title &&
        tab.pinned === expected.pinned &&
        tab.state === TreeItemState.Open &&
        tab.parentUid === undefined &&
        tab.indentLevel === 1,
    ),
  )
}

function treeHasRootTabCounts(tree, expectedTabs) {
  const windowItem = onlyOpenWindow(tree)
  if (!windowItem || windowsInTree(tree).length !== 1) return false

  const rootTabs = rootTabsInWindow(windowItem)
  const expectedCount = expectedTabs.reduce(
    (total, expected) => total + expected.count,
    0,
  )
  if (rootTabs.length !== expectedCount) return false

  return expectedTabs.every((expected) => {
    const matchingTabs = rootTabs.filter(
      (tab) =>
        tab.title === expected.title &&
        tab.state === TreeItemState.Open &&
        tab.parentUid === undefined &&
        tab.indentLevel === 1,
    )
    return matchingTabs.length === expected.count
  })
}

function rootTabsMatchState(windowItem, tabTitles, state) {
  const rootTabs = rootTabsInWindow(windowItem)
  if (rootTabs.length !== tabTitles.length) return false

  return tabTitles.every((title) =>
    rootTabs.some(
      (tab) =>
        tab.title === title &&
        tab.state === state &&
        tab.parentUid === undefined &&
        tab.indentLevel === 1,
    ),
  )
}

async function browserTabByTreeTitle(title) {
  const tree = await sessionTree.backgroundTreeSnapshot()
  const matchingTab = windowsInTree(tree)
    .flatMap((windowItem) => tabsInWindow(windowItem))
    .find((tab) => tab.title === title)

  if (!matchingTab) return undefined

  const response = await browser.executeAsync((tabId, done) => {
    window.browser.tabs
      .get(tabId)
      .then((tab) => done({ ok: true, tab }))
      .catch(() => done({ ok: false }))
  }, matchingTab.id)

  return response.ok ? response.tab : undefined
}

async function browserTitleCount(title) {
  const originalHandle = await browser.getWindowHandle()
  const handles = await browser.getWindowHandles()
  let count = 0

  for (const handle of handles) {
    await browser.switchToWindow(handle)
    if ((await browser.getTitle()) === title) {
      count += 1
    }
  }

  if (handles.includes(originalHandle)) {
    await browser.switchToWindow(originalHandle)
  }

  return count
}

async function waitForBrowserHandleClosed(handle, title) {
  await browser.waitUntil(
    async () => !(await browser.getWindowHandles()).includes(handle),
    {
      timeout: 10_000,
      timeoutMsg: `Expected browser tab "${title}" to close.`,
    },
  )
}

async function waitForBrowserTitleCount(title, count) {
  await browser.waitUntil(
    async () => (await browserTitleCount(title)) === count,
    {
      timeout: 10_000,
      timeoutMsg: `Expected ${count} browser tab(s) titled "${title}".`,
    },
  )
}

async function waitForBrowserTitleChanged(previousTitle, titlePrefix) {
  let currentTitle

  await browser.waitUntil(
    async () => {
      currentTitle = await browser.getTitle()
      return (
        currentTitle !== previousTitle && currentTitle.startsWith(titlePrefix)
      )
    },
    {
      timeout: 10_000,
      timeoutMsg: `Expected browser tab title to change from "${previousTitle}".`,
    },
  )

  return currentTitle
}

function onlyOpenWindow(tree) {
  const openWindows = openWindowsInTree(tree)
  if (openWindows.length !== 1) return undefined
  return openWindows[0]
}

function rootTabsInWindow(windowItem) {
  return tabsInWindow(windowItem).filter((tab) => tab.parentUid === undefined)
}
