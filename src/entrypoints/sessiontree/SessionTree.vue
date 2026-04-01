<script lang="ts" setup>
import IconChevronRight from '@/assets/chevron-right.svg'
import IconPinned from '@/assets/pinned.svg'
import TreeItem from '@/components/TreeItem.vue'
import { DragAndDrop } from '@/services/drag-and-drop'
import { Favicons } from '@/services/favicons'
import * as Messages from '@/services/foreground-messages'
import { SessionTree } from '@/services/foreground-tree'
import {
  disconnectTreePort,
  onTreeDeltaPort,
  subscribeTreePort,
} from '@/services/runtime-port-service'
import { Selection } from '@/services/selection'
import { Settings } from '@/services/settings'
import '@/styles/variables.css'
import { VisibleWindow } from '@/types/session-tree'
import { computed, onBeforeUnmount, onMounted } from 'vue'

let unsubscribeFromTreeDelta: (() => void) | undefined
let removeRuntimeListener: (() => void) | undefined

// Save Session Tree Window location and size before closing.
window.onbeforeunload = () => {
  const bounds = {
    width: window.outerWidth,
    height: window.outerHeight,
    left: window.screenLeft,
    top: window.screenTop,
  }
  localStorage.setItem('sessionTreeWindowConfig', JSON.stringify(bounds))

  Selection.clearSelection()
  Messages.deselectAllItems()

  console.log('Unloading')
  disconnectTreePort()
  faviconService.saveCacheToStorage()
}

const faviconService = Favicons

const visibleTreeItems = computed<VisibleWindow[]>(() => {
  SessionTree.reactiveWindowsList.value.forEach((w) =>
    w.tabs.forEach((t) => void t.isVisible),
  )
  return SessionTree.reactiveWindowsList.value.map((w) => ({
    window: w,
    visibleTabs: w.tabs.filter((t) => t.isVisible === true),
  }))
})

// On component mount
onMounted(async () => {
  console.log('Mounted')
  await faviconService.init()
  const openTabs = await window.browser.tabs.query({})
  faviconService.warmCacheFromTabs(openTabs)

  const initialSnapshot = await subscribeTreePort()
  SessionTree.replaceSessionTree(initialSnapshot)
  unsubscribeFromTreeDelta = onTreeDeltaPort((delta) => {
    SessionTree.applyDelta(delta)
  })

  // Listen for messages from the background script
  const faviconListener = (message: {
    type?: string
    favIconUrl?: string
    tab?: unknown
  }) => {
    switch (message.type) {
      case 'FAVICON_UPDATED':
        console.log('FaviconUpdated message received')
        if (message.favIconUrl) {
          const tabLike = message.tab as { url?: string } | undefined
          void faviconService.updateFavicon(
            message.favIconUrl,
            undefined,
            tabLike?.url,
          )
        }
        break
      default:
      // console.warn('Unknown message type:', message.type)
    }
  }
  window.browser.runtime.onMessage.addListener(faviconListener)
  removeRuntimeListener = () => {
    window.browser.runtime.onMessage.removeListener(faviconListener)
  }
})

onMounted(async () => {
  await Settings.loadSettingsFromStorage()
  Settings.setupSettingsUpdatedListener()
})

// reset sessionTree to non-ref object to avoid zombie dead object
onBeforeUnmount(() => {
  console.log('Unmounted')
  unsubscribeFromTreeDelta?.()
  removeRuntimeListener?.()
  disconnectTreePort()
})

// Handler functions

const getTabTree = () => {
  console.log(
    'Session Tree has ',
    SessionTree.reactiveWindowsList.value.length,
    ' windows',
  )
  console.log(SessionTree.reactiveWindowsList.value)
  console.log(SessionTree.reactiveWindowsList)
  console.log('Visible Tree Items:', visibleTreeItems.value)
  Messages.printSessionTree()
}

function onClick() {
  Selection.clearSelection()
}
</script>

<template>
  <div
    class="sessiontree"
    @contextmenu.prevent
    @click="onClick"
    @dragend="DragAndDrop.onDragEnd"
    @dragenter.stop.prevent="DragAndDrop.onDragEnter"
    @dragleave="DragAndDrop.onDragLeave"
    @dragover.stop.prevent="DragAndDrop.onDragMove"
    @drop.stop.prevent="DragAndDrop.onDrop"
  >
    <button @click="getTabTree">Get Tab Tree</button>
    <div
      class="hiddenAssets"
      style="display: none"
    >
      <svg>
        <use :xlink:href="`#${IconChevronRight}`" />
        <use :xlink:href="`#${IconPinned}`" />
      </svg>
    </div>

    <template
      v-for="item in visibleTreeItems"
      :key="item.window.uid"
    >
      <TreeItem
        :item="item.window"
        :favicon-service="faviconService"
      />

      <template
        v-for="tab in item.visibleTabs"
        :key="`${item.window.uid}-${tab.uid}`"
      >
        <TreeItem
          :item="tab"
          :favicon-service="faviconService"
        />
      </template>
    </template>

    <div style="margin-bottom: 95vh"></div>
  </div>
</template>

<style scoped>
.sessiontree {
  min-width: 200px;
  width: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  height: 100vh;
  position: relative;
  margin: 0;
  background-color: var(--background-color-secondary);
}
</style>

<style>
body {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  padding: 0;
  margin: 0;
}
</style>
