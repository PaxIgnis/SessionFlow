<script lang="ts" setup>
import IconChevronRight from '@/assets/chevron-right.svg'
import TreeItem from '@/components/TreeItem.vue'
import { DragAndDrop } from '@/services/drag-and-drop'
import { FaviconService } from '@/services/favicons'
import * as Messages from '@/services/foreground-messages'
import { SessionTree } from '@/services/foreground-tree'
import { Selection } from '@/services/selection'
import { Settings } from '@/services/settings'
import '@/styles/variables.css'
import { FaviconCacheEntry } from '@/types/favicons'
import { VisibleWindow, Window } from '@/types/session-tree'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

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
  if (backgroundPage && typeof backgroundPage.resetSessionTree === 'function') {
    backgroundPage.resetSessionTree()
  } else {
    console.error('Background page or associated functions are not available')
  }
  faviconService.saveCacheToStorage()
}

const faviconCache = ref<Map<string, FaviconCacheEntry>>(
  new Map<string, FaviconCacheEntry>(),
)
const faviconService = new FaviconService(undefined, faviconCache.value)
const backgroundPage =
  window.browser.extension.getBackgroundPage() as unknown as globalThis.Window

const visibleTreeItems = computed<VisibleWindow[]>(() => {
  SessionTree.reactiveWindowsList.value.forEach((w) =>
    w.tabs.forEach((t) => void t.isVisible),
  )
  return SessionTree.reactiveWindowsList.value.map((w) => ({
    window: w,
    visibleTabs: w.tabs.filter((t) => t.isVisible === true),
  }))
})

// Function to update sessionTree
function updateSessionTree(newWindows: Array<Window>) {
  SessionTree.reactiveWindowsList.value = newWindows
}

// On component mount
onMounted(() => {
  console.log('Mounted')
  // Get initial data from the background script
  if (
    backgroundPage &&
    typeof backgroundPage.getSessionTree === 'function' &&
    typeof backgroundPage.setSessionTree === 'function'
  ) {
    updateSessionTree(backgroundPage.getSessionTree())
    backgroundPage.setSessionTree(SessionTree.reactiveWindowsList.value)
  } else {
    console.error('Background page or associated functions are not available')
  }

  // Listen for messages from the background script
  window.browser.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case 'FAVICON_UPDATED':
        console.log('FaviconUpdated message received')
        faviconService.updateFavicon(message.favIconUrl, message.tab)
        break
      default:
      // console.warn('Unknown message type:', message.type)
    }
  })
})

onMounted(async () => {
  await Settings.loadSettingsFromStorage()
  Settings.setupSettingsUpdatedListener()
})

// reset sessionTree to non-ref object to avoid zombie dead object
onBeforeUnmount(() => {
  console.log('Unmounted')
  if (backgroundPage && typeof backgroundPage.resetSessionTree === 'function') {
    backgroundPage.resetSessionTree()
  } else {
    console.error('Background page or associated functions are not available')
  }
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
