<script lang="ts" setup>
import { ref, onMounted, triggerRef, onBeforeUnmount } from 'vue'
import { Window, State } from './sessiontree.interfaces.ts'
import { FaviconService } from '../../services/favicon/favicon.index.ts'
import { FaviconCacheEntry } from '../../services/favicon/favicon.interfaces.ts'

// Save Session Tree Window location and size before closing.
window.onbeforeunload = () => {
  const bounds = {
    width: window.outerWidth,
    height: window.outerHeight,
    left: window.screenLeft,
    top: window.screenTop,
  }
  localStorage.setItem('sessionTreeWindowConfig', JSON.stringify(bounds))

  console.log('Unloading')
  window.browser.extension.getBackgroundPage().resetSessionTree()
  faviconService.saveCacheToStorage()
}

// Initialize a local reactive sessionTree
const sessionTree = ref<{ windows: Array<Window> }>({ windows: [] })
const hoveredTab = ref<string | null>(null) // Track the hovered tab
const hoveredWindow = ref<number | null>(null) // Track the hovered window
const faviconCache = ref<Map<string, FaviconCacheEntry>>(
  new Map<string, FaviconCacheEntry>()
)
const faviconService = new FaviconService(undefined, faviconCache.value)

// Function to update sessionTree
function updateSessionTree(newWindows: Array<Window>) {
  sessionTree.value.windows = newWindows
}

// On component mount
onMounted(() => {
  console.log('Mounted')
  // Get initial data from the background script
  const backgroundPage = window.browser.extension.getBackgroundPage()
  updateSessionTree(backgroundPage.getSessionTree())

  backgroundPage.setSessionTree(sessionTree.value.windows)

  // Listen for messages from the background script
  window.browser.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case 'FAVICON_UPDATED':
        console.log('FaviconUpdated message received')
        faviconService.updateFavicon(message.favIconUrl, message.tab)
        break
      default:
        console.warn('Unknown message type:', message.type)
    }
  })
})

// reset sessionTree to non-ref object to avoid zombie dead object
onBeforeUnmount(() => {
  console.log('Unmounted')
  window.browser.extension.getBackgroundPage().resetSessionTree()
})

// Handler functions

const getTabTree = () => {
  console.log(sessionTree.value)
  console.log(sessionTree.value.windows)
}

function closeTab(tabId: number, tabSerialId: number, windowSerialId: number) {
  window.browser.runtime.sendMessage({
    action: 'closeTab',
    tabId: tabId,
    tabSerialId: tabSerialId,
    windowSerialId: windowSerialId,
  })
}

function closeWindow(windowId: number, windowSerialId: number) {
  window.browser.runtime.sendMessage({
    action: 'closeWindow',
    windowId: windowId,
    windowSerialId: windowSerialId,
  })
}

function saveTab(tabId: number, tabSerialId: number, windowSerialId: number) {
  window.browser.runtime.sendMessage({
    action: 'saveTab',
    tabId: tabId,
    tabSerialId: tabSerialId,
    windowSerialId: windowSerialId,
  })
}

function saveWindow(windowId: number, windowSerialId: number) {
  window.browser.runtime.sendMessage({
    action: 'saveWindow',
    windowId: windowId,
    windowSerialId: windowSerialId,
  })
}

function tabDoubleClick(
  tabId: number,
  windowId: number,
  tabSerialId: number,
  windowSerialId: number,
  state: State,
  url: string
) {
  if (state === State.SAVED) {
    window.browser.runtime.sendMessage({
      action: 'openTab',
      tabSerialId: tabSerialId,
      windowSerialId: windowSerialId,
      url: url,
    })
  } else if (state === State.OPEN) {
    window.browser.runtime.sendMessage({
      action: 'focusTab',
      tabId: tabId,
      windowId: windowId,
    })
  }
}

function windowDoubleClick(
  windowSerialId: number,
  windowId: number,
  state: State
) {
  console.log('Window double clicked', sessionTree.value)
  if (state === State.SAVED) {
    window.browser.runtime.sendMessage({
      action: 'openWindow',
      windowSerialId: windowSerialId,
    })
  } else if (state === State.OPEN) {
    window.browser.runtime.sendMessage({
      action: 'focusWindow',
      windowId: windowId,
    })
  }
}

function tabClick(tabId: number, windowId: number, state: State, url: string) {
  console.log('Tab clicked', tabId, windowId, state, url)
}

function toggleCollapsedWindow(windowSerialId: number) {
  const window = sessionTree.value.windows.find(
    (w) => w.serialId === windowSerialId
  )
  if (window) {
    window.collapsed = !window.collapsed
  }
}
</script>

<template>
  <div class="sessiontree">
    <button @click="getTabTree">Get Tab Tree</button>

    <ul v-cloak>
      <li
        v-for="window in sessionTree.windows"
        :key="window.serialId"
        class="subNodeContainer"
      >
        <div
          @mouseover="hoveredWindow = window.serialId"
          @mouseleave="hoveredWindow = null"
        >
          <span v-if="hoveredWindow === window.serialId" class="hoverMenu"
            >&nbsp;
            <span class="hoverMenuToolbar">
              <span
                v-if="window.state === State.OPEN"
                class="hoverMenuSave"
                @click="saveWindow(window.id, window.serialId)"
              ></span>
              <span
                class="hoverMenuClose"
                @click="closeWindow(window.id, window.serialId)"
              ></span>
            </span>
          </span>
          <div class="windowContainer">
            <span
              class="collapseArrow"
              :class="{ collapsed: window.collapsed }"
              @click="toggleCollapsedWindow(window.serialId)"
            ></span>
            <img class="nodeFavicon" src="/icon/16.png" alt="Window icon" />
            <span
              :class="{
                nodeTextOpen: window.state === State.OPEN,
                nodeTextSaved: window.state === State.SAVED,
              }"
              @dblclick="
                windowDoubleClick(window.serialId, window.id, window.state)
              "
              >Window id {{ window.id }} Window serialId
              {{ window.serialId }}</span
            >
          </div>
        </div>
        <ul class="tabsList" v-show="!window.collapsed">
          <li
            v-for="tab in window.tabs"
            :key="`${window.serialId}-${tab.serialId}`"
            class="subNodeContainer"
            @mouseover="hoveredTab = `${window.serialId}-${tab.serialId}`"
            @mouseleave="hoveredTab = null"
          >
            <span
              v-if="hoveredTab === `${window.serialId}-${tab.serialId}`"
              class="hoverMenu"
              >&nbsp;
              <span class="hoverMenuToolbar">
                <span
                  v-if="tab.state === State.OPEN"
                  class="hoverMenuSave"
                  @click="saveTab(tab.id, tab.serialId, window.serialId)"
                ></span>
                <span
                  class="hoverMenuClose"
                  @click="closeTab(tab.id, tab.serialId, window.serialId)"
                ></span>
              </span>
            </span>
            <a
              :href="tab.url"
              class="nodeContainer"
              target="_blank"
              @click.prevent
            >
              <img
                class="nodeFavicon"
                :src="faviconService.getFavicon(tab.url)"
                alt="/icon/16.png"
              />
              <span
                :class="{
                  nodeTextOpen: tab.state === State.OPEN,
                  nodeTextSaved: tab.state === State.SAVED,
                }"
                class="nodeText"
                @click="
                  tabClick(tab.serialId, window.serialId, tab.state, tab.url)
                "
                @dblclick="
                  tabDoubleClick(
                    tab.id,
                    window.id,
                    tab.serialId,
                    window.serialId,
                    tab.state,
                    tab.url
                  )
                "
                >{{ tab.title }}</span
              >
            </a>
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.hoverMenu {
  pointer-events: none;
  position: absolute;
  /* height: 16px; */
  left: 0;
  width: 100%;
  background: rgba(36, 145, 255, 0.08);
  visibility: visible;
}

.hoverMenuClose {
  pointer-events: auto;
  cursor: pointer;
  display: inline-block;
  width: 16px;
  height: 16px;
  /* padding-right: -15px; */
  background: transparent url('/icon/16.png') no-repeat;
}

.hoverMenuSave {
  pointer-events: auto;
  cursor: pointer;
  display: inline-block;
  width: 16px;
  height: 16px;
  padding-right: 4px;
  background: transparent url('/icon/16.png') no-repeat;
}

.hoverMenuToolbar {
  pointer-events: none;
  position: absolute;
  display: inline-block;
  right: 0px;
  padding-right: 7px;
  fill: darkgrey;
  background-clip: border-box, border-box, content-box;
}

.nodeContainer {
  cursor: pointer;
  padding-left: 10px;
  display: block;
  text-decoration: none;
}

.nodeFavicon {
  width: 16px;
  height: 16px;
  float: left;
  margin: 0px;
  margin-right: 3px;
}

.nodeText {
  display: block;
  white-space: nowrap;
}

.nodeTextOpen {
  color: black;
}

.nodeTextSaved {
  color: rgb(150, 150, 150);
}

.sessiontree ul {
  list-style-type: none;
  padding: 0;
  margin: 0;
}

.subNodeContainer {
  position: relative;
  padding-left: 10px;
  white-space: nowrap;
}

.tabsList {
  padding-bottom: 10px;
}

[v-cloak] {
  display: none;
}
.windowContainer {
  padding-left: 0px;
  display: flex;
  align-items: center;
}

/* Vertical guide line */
.subNodeContainer::before {
  content: '';
  display: block;
  position: absolute;
  top: 0px;
  left: 1px;
  width: 0;
  height: 100%;
  border: 1px solid #d2d2d2;
}

/* Last item shouldn't extend the vertical line fully */
.subNodeContainer:last-child::before {
  height: calc(100% - 4px);
}

.collapseArrow {
  display: inline-block;
  width: 5px;
  height: 5px;
  cursor: pointer;
  user-select: none;
  transition: transform 0.1s linear;
  margin-right: 6px;
  border: solid #303030;
  border-width: 0 1px 1px 0;
  padding: 1px;
  transform: rotate(45deg);
  margin-left: 0px;
  position: relative;
}

.collapseArrow::after {
  content: '';
  position: absolute;
  top: -4px;
  left: -4px;
  right: -4px;
  bottom: -4px;
  cursor: pointer;
}

.collapseArrow.collapsed {
  margin-left: -1px;
  margin-right: 7px;
  transform: rotate(-45deg);
}
</style>
