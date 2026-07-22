import { $, browser, expect } from '@wdio/globals'

export const TreeItemType = {
  Window: 0,
  Tab: 1,
  Note: 2,
}

export const TreeItemState = {
  Saved: 0,
  Open: 1,
  Discarded: 2,
}

export const DropPosition = {
  Above: 'above',
  Middle: 'middle',
  Below: 'below',
}

export class SessionTreePage {
  treeRoot() {
    return $('#sessiontree')
  }

  treeItems() {
    return $$('.tree-item')
  }

  treeItemByText(text) {
    return $(`.tree-item*=${text}`)
  }

  treeItemByUid(uid) {
    return $(`.tree-item[drag-and-drop-id="${uid}"]`)
  }

  treeItemByTypeAndText(type, text) {
    return $(`.tree-item[drag-and-drop-type="${type}"]*=${text}`)
  }

  windowItems() {
    return $$('.tree-item[drag-and-drop-type="window"]')
  }

  windowItemByText(text) {
    return this.treeItemByTypeAndText('window', text)
  }

  noteItemByText(text) {
    return $(`.tree-item[drag-and-drop-type="note"]*=${text}`)
  }

  tabItemByText(text) {
    return this.treeItemByTypeAndText('tab', text)
  }

  async expectLoaded() {
    await expect(await this.treeRoot()).toBeExisting()
    await browser.waitUntil(
      async () => {
        const root = await this.treeRoot()
        return (await root.isExisting()) && (await root.isDisplayed())
      },
      {
        timeout: 10_000,
        timeoutMsg: 'Expected the session tree root to be visible.',
      },
    )
  }

  async waitForItemTextVisible(text) {
    await browser.waitUntil(
      async () => {
        const item = await this.treeItemByText(text)
        return (await item.isExisting()) && (await item.isDisplayed())
      },
      {
        timeout: 10_000,
        timeoutMsg: `Expected tree item "${text}" to be visible.`,
      },
    )
  }

  async expectTreeItemVisible(text) {
    await this.waitForItemTextVisible(text)
  }

  async expectNoteVisible(text) {
    await browser.waitUntil(
      async () => {
        const note = await this.noteItemByText(text)
        return (await note.isExisting()) && (await note.isDisplayed())
      },
      {
        timeout: 10_000,
        timeoutMsg: `Expected note "${text}" to be visible.`,
      },
    )
  }

  async expectNoteNotVisible(text) {
    await browser.waitUntil(
      async () => {
        const note = await this.noteItemByText(text)
        return !(await note.isExisting()) || !(await note.isDisplayed())
      },
      {
        timeout: 10_000,
        timeoutMsg: `Expected note "${text}" not to be visible.`,
      },
    )
  }

  async waitForItemTextNotVisible(text) {
    await browser.waitUntil(
      async () => {
        const item = await this.treeItemByText(text)
        return !(await item.isExisting()) || !(await item.isDisplayed())
      },
      {
        timeout: 10_000,
        timeoutMsg: `Expected tree item "${text}" to disappear.`,
      },
    )
  }

  async waitForVisibleItemCountAtLeast(expectedCount) {
    await browser.waitUntil(
      async () => (await this.visibleItemTexts()).length >= expectedCount,
      {
        timeout: 10_000,
        timeoutMsg: `Expected at least ${expectedCount} visible session tree items.`,
      },
    )
  }

  async expectVisibleItemOrder(expectedTexts) {
    await browser.waitUntil(
      async () => {
        const itemTexts = await this.visibleItemTexts()
        let searchFromIndex = 0

        for (const expectedText of expectedTexts) {
          const foundIndex = itemTexts.findIndex(
            (text, index) =>
              index >= searchFromIndex && text.includes(expectedText),
          )

          if (foundIndex === -1) return false
          searchFromIndex = foundIndex + 1
        }

        return true
      },
      {
        timeout: 10_000,
        timeoutMsg: `Expected visible tree item order to include: ${expectedTexts.join(', ')}.`,
      },
    )
  }

  async visibleItemTexts() {
    const items = await this.treeItems()
    const texts = []

    for (const item of items) {
      if (await item.isDisplayed()) {
        texts.push(await item.getText())
      }
    }

    return texts
  }

  async captureContextMenuItems() {
    await browser.execute(() => {
      const win = window
      win.__sessionFlowE2eContextMenuItems = []

      if (win.__sessionFlowE2eContextMenuCaptureInstalled) {
        return
      }

      const originalCreate = win.browser.menus.create.bind(win.browser.menus)
      win.browser.menus.create = (properties, callback) => {
        win.__sessionFlowE2eContextMenuItems.push(properties)
        return originalCreate(properties, callback)
      }
      win.__sessionFlowE2eContextMenuCaptureInstalled = true
    })
  }

  async clickCapturedContextMenuItem(title) {
    await browser.waitUntil(
      async () =>
        browser.execute(
          (menuTitle) =>
            Boolean(
              window.__sessionFlowE2eContextMenuItems?.some(
                (item) => item.title === menuTitle,
              ),
            ),
          title,
        ),
      {
        timeout: 10_000,
        timeoutMsg: `Expected context menu item "${title}" to be created.`,
      },
    )

    await browser.execute((menuTitle) => {
      const item = window.__sessionFlowE2eContextMenuItems.find(
        (menuItem) => menuItem.title === menuTitle,
      )

      if (!item?.onclick) {
        throw new Error(
          `Captured context menu item "${menuTitle}" has no onclick.`,
        )
      }

      if (item.enabled === false) {
        throw new Error(
          `Captured context menu item "${menuTitle}" is disabled.`,
        )
      }

      item.onclick()
    }, title)
  }

  async firstWindowItem() {
    await browser.waitUntil(async () => (await this.windowItems()).length > 0, {
      timeout: 10_000,
      timeoutMsg: 'Expected at least one window item in the session tree.',
    })

    const windows = await this.windowItems()
    return windows[0]
  }

  async openWindowContextMenu() {
    const windowItem = await this.firstWindowItem()
    await expect(windowItem).toBeDisplayed()
    await windowItem.click({ button: 'right' })
  }

  async openWindowContextMenuByText(text) {
    const windowItem = await this.windowItemByText(text)
    await expect(windowItem).toBeDisplayed()
    await windowItem.click({ button: 'right' })
  }

  async openTabContextMenu(tabTitle) {
    const tabItem = await this.tabItemByText(tabTitle)
    await expect(tabItem).toBeDisplayed()
    await tabItem.click({ button: 'right' })
  }

  async rapidDoubleClickTab(tabTitle) {
    const tabItem = await this.tabItemByText(tabTitle)
    await expect(tabItem).toBeDisplayed()
    await browser.execute((element) => {
      element.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
      )
      element.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
      )
    }, tabItem)
  }

  async rapidDoubleClickWindow(windowTitle) {
    const windowItem = await this.windowItemByText(windowTitle)
    await expect(windowItem).toBeDisplayed()
    await browser.execute((element) => {
      element.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
      )
      element.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
      )
    }, windowItem)
  }

  async openNoteContextMenu(noteText) {
    const noteItem = await this.noteItemByText(noteText)
    await expect(noteItem).toBeDisplayed()
    await noteItem.click({ button: 'right' })
  }

  async setEditTextModalValue(value) {
    const input = await $('.modal-input')
    await expect(input).toBeDisplayed()
    await input.clearValue()
    if (value) {
      await input.setValue(value)
    }
  }

  async confirmEditTextModal() {
    const okButton = await $('.modal-buttons .btn-primary')
    await expect(okButton).toBeDisplayed()
    await okButton.click()
  }

  containerRecoveryModal() {
    return $('.container-recovery-modal')
  }

  async recreateMissingContainersAndOpen() {
    const button = await $(
      '//section[contains(@class,"container-recovery-modal")]//button[contains(normalize-space(),"Recreate")]',
    )
    await expect(button).toBeDisplayed()
    await button.click()
  }

  async openWithoutMissingContainers() {
    const button = await $(
      '//section[contains(@class,"container-recovery-modal")]//button[contains(normalize-space(),"Open Without")]',
    )
    await expect(button).toBeDisplayed()
    await button.click()
  }

  async cancelContainerRecovery() {
    const button = await $(
      '//section[contains(@class,"container-recovery-modal")]//button[normalize-space()="Cancel"]',
    )
    await expect(button).toBeDisplayed()
    await button.click()
  }

  async backgroundTreeSnapshot() {
    const response = await browser.executeAsync((done) => {
      const requestId = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`
      const port = window.browser.runtime.connect({ name: 'sessiontree-rpc' })
      let settled = false

      const finish = (message) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        try {
          port.disconnect()
        } catch {
          // The response is already captured; disconnect failures are irrelevant.
        }
        done(message)
      }

      const timeoutId = setTimeout(() => {
        finish({
          ok: false,
          error: 'Timed out waiting for session tree snapshot.',
        })
      }, 10_000)

      port.onMessage.addListener((message) => {
        if (message.type === 'response' && message.requestId === requestId) {
          finish(message)
        }
      })

      port.onDisconnect.addListener(() => {
        finish({
          ok: false,
          error: 'Session tree runtime port disconnected.',
        })
      })

      port.postMessage({
        type: 'subscribe',
        requestId,
      })
    })

    if (!response.ok) {
      throw new Error(response.error || 'Failed to read session tree snapshot.')
    }

    return response.treeItems || []
  }

  async sendTreeCommand(command) {
    const response = await browser.executeAsync((treeCommand, done) => {
      const requestId = `e2e-command-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`
      const port = window.browser.runtime.connect({ name: 'sessiontree-rpc' })
      let settled = false

      const finish = (message) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        try {
          port.disconnect()
        } catch {
          // The response is already captured; disconnect failures are irrelevant.
        }
        done(message)
      }

      const timeoutId = setTimeout(() => {
        finish({
          ok: false,
          error: 'Timed out waiting for session tree command response.',
        })
      }, 10_000)

      port.onMessage.addListener((message) => {
        if (message.type === 'response' && message.requestId === requestId) {
          finish(message)
        }
      })

      port.onDisconnect.addListener(() => {
        finish({
          ok: false,
          error: 'Session tree runtime port disconnected.',
        })
      })

      port.postMessage({
        type: 'command',
        requestId,
        command: treeCommand,
      })
    }, command)

    if (!response.ok) {
      throw new Error(response.error || 'Session tree command failed.')
    }
  }

  async removeAllNotes() {
    const tree = await this.backgroundTreeSnapshot()
    const notes = allNotesInTree(tree)

    for (const note of notes) {
      await this.sendTreeCommand({
        action: 'removeNote',
        noteUid: note.uid,
      })
    }
  }

  async waitForBackgroundTree(predicate, timeoutMsg) {
    let lastTree = []
    try {
      await browser.waitUntil(
        async () => {
          lastTree = await this.backgroundTreeSnapshot()
          return predicate(lastTree)
        },
        {
          timeout: 10_000,
          timeoutMsg,
        },
      )
    } catch (error) {
      throw new Error(
        `${timeoutMsg} Last tree: ${JSON.stringify(summarizeTree(lastTree))}`,
        { cause: error },
      )
    }
  }

  async updateSettings(settingsPatch) {
    const response = await browser.executeAsync((patch, done) => {
      window.browser.storage.local
        .get('settings')
        .then(({ settings }) =>
          window.browser.storage.local.set({
            settings: {
              ...(settings || {}),
              ...patch,
            },
          }),
        )
        .then(() =>
          window.browser.runtime.sendMessage({ type: 'settingsUpdated' }),
        )
        .then(() => done({ ok: true }))
        .catch((error) =>
          done({
            ok: false,
            error: String(error),
          }),
        )
    }, settingsPatch)

    if (!response.ok) {
      throw new Error(response.error || 'Failed to update extension settings.')
    }
  }

  async selectTreeItemRange(firstText, lastText) {
    const first = await this.treeItemByText(firstText)
    const last = await this.treeItemByText(lastText)

    await expect(first).toBeDisplayed()
    await expect(last).toBeDisplayed()

    await browser.execute(
      (firstElement, lastElement) => {
        firstElement.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
          }),
        )
        lastElement.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            shiftKey: true,
          }),
        )
      },
      first,
      last,
    )
  }

  async dragTreeItem(sourceText, targetText, position, options = {}) {
    const source = await this.treeItemByText(sourceText)
    const target = await this.treeItemByText(targetText)

    await expect(source).toBeDisplayed()
    await expect(target).toBeDisplayed()

    await browser.execute(
      (sourceElement, targetElement, dropPosition, dragOptions) => {
        const dataTransfer = new DataTransfer()
        const targetRect = targetElement.getBoundingClientRect()
        const clientX = Math.floor(targetRect.left + targetRect.width / 2)
        const clientY = Math.floor(getDropClientY(targetRect, dropPosition))

        const dispatchDragEvent = (element, type) => {
          element.dispatchEvent(
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              clientX,
              clientY,
              dataTransfer,
              altKey: dragOptions.altKey === true,
            }),
          )
        }

        dispatchDragEvent(sourceElement, 'dragstart')
        dispatchDragEvent(targetElement, 'dragenter')
        dispatchDragEvent(targetElement, 'dragover')
        dispatchDragEvent(targetElement, 'drop')
        dispatchDragEvent(sourceElement, 'dragend')

        function getDropClientY(rect, position) {
          if (position === 'above') {
            return rect.top + 2
          }

          if (position === 'below') {
            return rect.bottom - 2
          }

          return rect.top + rect.height / 2
        }
      },
      source,
      target,
      position,
      options,
    )
  }
}

export function windowsInTree(tree) {
  return tree.filter((item) => item.type === TreeItemType.Window)
}

export function openWindowsInTree(tree) {
  return windowsInTree(tree).filter(
    (windowItem) => windowItem.state === TreeItemState.Open,
  )
}

export function savedWindowsInTree(tree) {
  return windowsInTree(tree).filter(
    (windowItem) => windowItem.state === TreeItemState.Saved,
  )
}

export function tabsInWindow(windowItem) {
  return windowItem.children.filter((item) => item.type === TreeItemType.Tab)
}

export function notesInWindow(windowItem) {
  return windowItem.children.filter((item) => item.type === TreeItemType.Note)
}

export function childNotesOf(parent, containingWindow) {
  return containingWindow.children.filter(
    (item) => item.type === TreeItemType.Note && item.parentUid === parent.uid,
  )
}

export function allNotesInTree(tree) {
  return tree.flatMap((item) => {
    if (item.type === TreeItemType.Note) return [item]
    if (item.type !== TreeItemType.Window) return []
    return notesInWindow(item)
  })
}

function summarizeTree(tree) {
  return tree.map((item) => {
    if (item.type === TreeItemType.Window) {
      return {
        type: 'window',
        state: item.state,
        title: item.title,
        indentLevel: item.indentLevel,
        children: item.children.map((child) => ({
          type:
            child.type === TreeItemType.Tab
              ? 'tab'
              : child.type === TreeItemType.Note
                ? 'note'
                : 'window',
          title: child.title,
          text: child.text,
          state: child.state,
          parentUid: child.parentUid,
          indentLevel: child.indentLevel,
        })),
      }
    }

    return {
      type: item.type === TreeItemType.Note ? 'note' : 'unknown',
      text: item.text,
      state: item.state,
      indentLevel: item.indentLevel,
    }
  })
}
