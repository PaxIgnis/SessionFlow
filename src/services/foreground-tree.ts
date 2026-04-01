// import * as Actions from '@/services/foreground-tree-actions'
import { SessionTreeDelta } from '@/types/runtime-port-service'
import { Tab, Window } from '@/types/session-tree'
import { ref } from 'vue'

function updateObjectProperties<T extends object>(
  target: T,
  source: Partial<T>,
): void {
  Object.entries(source).forEach(([key, value]) => {
    if (value !== undefined) {
      ;(target as Record<string, unknown>)[key] = value
    }
  })
}

function indexWindow(window: Window): void {
  SessionTree.windowsByUid.set(window.uid, window)
  window.tabs.forEach((tab) => {
    SessionTree.tabsByUid.set(tab.uid, tab)
  })
}

function unindexWindow(window: Window): void {
  SessionTree.windowsByUid.delete(window.uid)
  window.tabs.forEach((tab) => {
    SessionTree.tabsByUid.delete(tab.uid)
  })
}

function reindexTree(): void {
  SessionTree.windowsByUid.clear()
  SessionTree.tabsByUid.clear()

  SessionTree.reactiveWindowsList.value.forEach((window) => {
    indexWindow(window)
  })
}

function replaceSessionTree(newWindows: Array<Window>): void {
  SessionTree.reactiveWindowsList.value = structuredClone(newWindows)
  reindexTree()
}

function applyDelta(delta: SessionTreeDelta): void {
  switch (delta.op) {
    case 'treeReplaced':
      console.debug('Applying treeReplaced delta: ', delta)
      replaceSessionTree(delta.windows)
      return
    case 'windowCreated': {
      console.debug('Applying windowCreated delta: ', delta)
      const window = structuredClone(delta.window)
      SessionTree.reactiveWindowsList.value.splice(delta.index, 0, window)

      const insertedWindow =
        SessionTree.reactiveWindowsList.value[delta.index] ??
        SessionTree.reactiveWindowsList.value.find((w) => w.uid === window.uid)
      if (insertedWindow) {
        indexWindow(insertedWindow)
      }
      return
    }
    case 'windowRemoved': {
      console.debug('Applying windowRemoved delta: ', delta)
      const existingWindow = SessionTree.windowsByUid.get(delta.windowUid)
      if (existingWindow) {
        unindexWindow(existingWindow)
      }

      const index = SessionTree.reactiveWindowsList.value.findIndex(
        (w) => w.uid === delta.windowUid,
      )
      if (index !== -1) {
        SessionTree.reactiveWindowsList.value.splice(index, 1)
      }
      return
    }
    case 'windowUpdated': {
      console.debug('Applying windowUpdated delta: ', delta)
      const updatedWindow = delta.window
      const index = SessionTree.reactiveWindowsList.value.findIndex(
        (w) => w.uid === updatedWindow.uid,
      )
      if (index !== -1) {
        const existingWindow = SessionTree.reactiveWindowsList.value[index]

        const { tabs: updatedTabs, ...windowProps } = updatedWindow
        updateObjectProperties(existingWindow, windowProps)

        const existingTabsMap = new Map(
          existingWindow.tabs.map((t) => [t.uid, t]),
        )
        const nextTabs: Tab[] = []
        updatedTabs.forEach((updatedTab) => {
          const existingTab = existingTabsMap.get(updatedTab.uid)
          if (existingTab) {
            updateObjectProperties(existingTab, updatedTab)
            nextTabs.push(existingTab)
          } else {
            nextTabs.push(structuredClone(updatedTab))
          }
        })

        existingWindow.tabs.splice(0, existingWindow.tabs.length, ...nextTabs)
        indexWindow(existingWindow)
      } else {
        console.warn(
          'Received windowUpdated delta for non-existing window. This may indicate a synchronization issue.',
          delta,
        )
        // Window doesn't exist, insert it
        // SessionTree.reactiveWindowsList.value.push(
        //   structuredClone(updatedWindow),
        // )
        // const insertedWindow =
        //   SessionTree.reactiveWindowsList.value[
        //     SessionTree.reactiveWindowsList.value.length - 1
        //   ]
        // if (insertedWindow) {
        //   indexWindow(insertedWindow)
        // }
      }
      return
    }
    case 'tabCreated': {
      console.debug('Applying tabCreated delta: ', delta)
      console.debug(
        'Tree before applying tabCreated delta: ',
        SessionTree.reactiveWindowsList.value,
      )
      const window = SessionTree.windowsByUid.get(delta.windowUid)
      if (!window) return
      const incomingTab = delta.tab
      const existingIndex = window.tabs.findIndex(
        (t) => t.uid === incomingTab.uid,
      )
      console.debug('Existing index for new tab: ', existingIndex)

      if (existingIndex === -1) {
        const tab = structuredClone(incomingTab)
        window.tabs.splice(delta.index, 0, tab)

        const insertedTab =
          window.tabs[delta.index] ??
          window.tabs.find((t) => t.uid === incomingTab.uid)
        console.debug('insertedTab: ', insertedTab)
        if (insertedTab) {
          SessionTree.tabsByUid.set(insertedTab.uid, insertedTab)
        }
      } else {
        console.warn(
          'Received tabCreated delta for existing tab. This may indicate a synchronization issue.',
          delta,
        )
        // const existingTab = window.tabs[existingIndex]
        // updateObjectProperties(existingTab, incomingTab)

        // if (existingIndex !== delta.index) {
        //   const [movedTab] = window.tabs.splice(existingIndex, 1)
        //   const targetIndex = Math.min(delta.index, window.tabs.length)
        //   window.tabs.splice(targetIndex, 0, movedTab)
        // }

        // tabsByUid.set(existingTab.uid, existingTab)
      }
      return
    }
    case 'tabRemoved': {
      console.debug('Applying tabRemoved delta: ', delta)
      const window = SessionTree.windowsByUid.get(delta.windowUid)
      if (!window) return

      const index = window.tabs.findIndex((t) => t.uid === delta.tabUid)
      if (index !== -1) {
        window.tabs.splice(index, 1)
      }

      SessionTree.tabsByUid.delete(delta.tabUid)
      return
    }
    case 'tabUpdated': {
      console.debug('Applying tabUpdated delta: ', delta)
      const updatedTab = delta.tab
      const existingTab = SessionTree.tabsByUid.get(updatedTab.uid)

      if (!existingTab) {
        console.warn(
          'Received tabUpdated delta for non-existing tab. This may indicate a synchronization issue.',
          delta,
        )
        return
      }

      if (existingTab && existingTab.windowUid !== updatedTab.windowUid) {
        const previousWindow = SessionTree.windowsByUid.get(
          existingTab.windowUid,
        )
        if (previousWindow) {
          const previousIndex = previousWindow.tabs.findIndex(
            (t) => t.uid === updatedTab.uid,
          )
          if (previousIndex !== -1) {
            previousWindow.tabs.splice(previousIndex, 1)
          }
        }
      }

      const window = SessionTree.windowsByUid.get(updatedTab.windowUid)
      if (!window) return

      let targetTab = window.tabs.find((t) => t.uid === updatedTab.uid)
      if (!targetTab) {
        window.tabs.push(existingTab)
        targetTab = existingTab
      }

      updateObjectProperties(targetTab, updatedTab)

      SessionTree.tabsByUid.set(targetTab.uid, targetTab)
      return
    }
    default:
      return
  }
}

export const SessionTree = {
  reactiveWindowsList: ref<Window[]>([]),
  windowsByUid: new Map<UID, Window>(),
  tabsByUid: new Map<UID, Tab>(),

  replaceSessionTree,
  applyDelta,
}
