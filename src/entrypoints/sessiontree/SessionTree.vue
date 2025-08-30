<script lang="ts" setup>
import IconChevronRight from '@/assets/chevron-right.svg'
import { TAB_LOADING } from '@/defaults/favicons'
import { FaviconService } from '@/services/favicons'
import * as Messages from '@/services/foreground-messages'
import { SessionTree } from '@/services/foreground-tree'
import '@/styles/variables.css'
import { FaviconCacheEntry } from '@/types/favicons'
import { State, Tab, Window } from '@/types/session-tree'
import { onBeforeUnmount, onMounted, ref } from 'vue'

// Save Session Tree Window location and size before closing.
window.onbeforeunload = () => {
  const bounds = {
    width: window.outerWidth,
    height: window.outerHeight,
    left: window.screenLeft,
    top: window.screenTop,
  }
  localStorage.setItem('sessionTreeWindowConfig', JSON.stringify(bounds))

  // Reset selected status of all items
  if (selectedItem.value) {
    selectedItem.value.selected = false
    selectedItem.value = null
  }
  SessionTree.reactiveWindowsList.value.forEach((window) => {
    window.tabs.forEach((tab) => {
      tab.selected = false
    })
    window.selected = false
  })

  console.log('Unloading')
  if (backgroundPage && typeof backgroundPage.resetSessionTree === 'function') {
    backgroundPage.resetSessionTree()
  } else {
    console.error('Background page or associated functions are not available')
  }
  faviconService.saveCacheToStorage()
}

const selectedItem = ref<Window | Tab | null>(null) // Track the selected item
const faviconCache = ref<Map<string, FaviconCacheEntry>>(
  new Map<string, FaviconCacheEntry>()
)
const faviconService = new FaviconService(undefined, faviconCache.value)
const backgroundPage =
  window.browser.extension.getBackgroundPage() as unknown as globalThis.Window

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
    ' windows'
  )
  console.log(SessionTree.reactiveWindowsList.value)
  console.log(SessionTree.reactiveWindowsList)
}

function itemClick(item: Window | Tab) {
  console.log('Item clicked', item)
  if (item.selected) {
    return
  }
  if (selectedItem.value) {
    selectedItem.value.selected = false
  }
  selectedItem.value = item
  selectedItem.value.selected = true
}

function toggleCollapsedWindow(windowSerialId: number) {
  const window = SessionTree.reactiveWindowsList.value.find(
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
    <div class="hiddenAssets" style="display: none">
      <svg>
        <use :xlink:href="`#${IconChevronRight}`" />
      </svg>
    </div>

    <ul v-cloak>
      <li
        v-for="window in SessionTree.reactiveWindowsList.value"
        :key="window.serialId"
        class="subNodeContainer"
      >
        <div
          :class="{
            active: window.active === true,
          }"
          class="windowNodeContainer treeItem"
          @click="itemClick(window)"
          @dblclick="
            Messages.windowDoubleClick(window.serialId, window.id, window.state)
          "
        >
          <span
            class="hoverMenu"
            :class="{
              selectedHovered: window.selected === true,
            }"
          >
            <span class="hoverMenuToolbar">
              <span
                v-if="window.state === State.OPEN"
                class="hoverMenuSave"
                @click="Messages.saveWindow(window.id, window.serialId)"
              ></span>
              <span
                class="hoverMenuClose"
                @click="Messages.closeWindow(window.id, window.serialId)"
              ></span>
            </span>
          </span>
          <div v-if="window.selected" class="selected"></div>
          <div class="windowContainer">
            <svg
              class="collapseArrow"
              :class="{ collapsed: window.collapsed }"
              @click="toggleCollapsedWindow(window.serialId)"
              @dblclick.stop
            >
              <use :xlink:href="'#chevron-right'" />
            </svg>
            <div
              v-if="window.collapsed"
              class="childCount"
              @click="toggleCollapsedWindow(window.serialId)"
              @dblclick.stop
            >
              [{{ window.tabs.length }}]
            </div>
            <img class="nodeFavicon" src="/icon/16.png" alt="Window icon" />
            <span
              :class="{
                nodeTextOpen: window.state === State.OPEN,
                nodeTextSaved: window.state === State.SAVED,
              }"
              class="nodeText"
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
          >
            <div
              :class="{
                active: tab.active === true,
                windowActive: window.active === true,
              }"
              class="tabNodeContainer treeItem"
              @click="itemClick(tab)"
              @dblclick="
                Messages.tabDoubleClick(
                  tab.id,
                  window.id,
                  tab.serialId,
                  window.serialId,
                  tab.state,
                  tab.url
                )
              "
            >
              <span
                :class="{
                  selectedHovered: tab.selected === true,
                }"
                class="hoverMenu"
                >&nbsp;
                <span class="hoverMenuToolbar">
                  <span
                    v-if="
                      tab.state === State.OPEN || tab.state === State.DISCARDED
                    "
                    class="hoverMenuSave"
                    @click="
                      Messages.saveTab(tab.id, tab.serialId, window.serialId)
                    "
                  ></span>
                  <span
                    class="hoverMenuClose"
                    @click="
                      Messages.closeTab(tab.id, tab.serialId, window.serialId)
                    "
                  ></span>
                </span>
              </span>
              <div v-if="tab.selected" class="selected"></div>
              <a
                :href="tab.url"
                class="nodeContainer"
                target="_blank"
                @click.prevent
              >
                <img
                  class="nodeFavicon"
                  :src="
                    tab.loadingStatus === 'loading' && tab.state === State.OPEN
                      ? TAB_LOADING
                      : faviconService.getFavicon(tab.url)
                  "
                />
                <span
                  :class="{
                    nodeTextOpen: tab.state === State.OPEN,
                    nodeTextSaved: tab.state === State.SAVED,
                    nodeTextDiscarded: tab.state === State.DISCARDED,
                  }"
                  class="nodeText"
                  >{{ tab.title }}</span
                >
              </a>
            </div>
          </li>
        </ul>
      </li>
    </ul>
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

.hoverMenu {
  pointer-events: none;
  position: absolute;
  /* height: 16px; */
  left: -100vw;
  right: 0;
  top: 0px;
  bottom: 0px;
  background: var(--list-item-hover-background);
  visibility: hidden;
}

.windowNodeContainer:hover .hoverMenu,
.tabNodeContainer:hover .hoverMenu {
  visibility: visible;
}

.hoverMenu.selectedHovered {
  background: None;
  z-index: 1;
}

.selected {
  pointer-events: none;
  position: absolute;
  top: 0px;
  bottom: 0px;
  background: var(--list-item-selected-background);
  left: -100vw;
  right: -100vw;
  visibility: visible;
}

.hoverMenuClose {
  pointer-events: auto;
  cursor: pointer;
  display: inline-block;
  align-items: center;
  width: 16px;
  height: 100%;
  /* padding-right: -15px; */
  background: transparent url('/icon/16.png') no-repeat;
}

.hoverMenuSave {
  pointer-events: auto;
  cursor: pointer;
  display: inline-block;
  align-items: center;
  width: 16px;
  height: 100%;
  padding-right: 4px;
  background: transparent url('/icon/16.png') no-repeat;
}

.hoverMenuToolbar {
  pointer-events: none;
  position: absolute;
  display: inline-block;
  height: 18px;
  right: 0px;
  padding-right: 7px;
  fill: darkgrey;
  background-clip: border-box, border-box, content-box;
  z-index: 1;
}

.nodeContainer {
  padding-left: 10px;
  display: block;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
  cursor: default;
}

.windowNodeContainer {
  position: relative;
  padding-top: 1px;
  padding-bottom: 1px;
  height: 16px;
}

.childCount {
  color: var(--text-color-primary);
  font-size: var(--font-size-xs);
  min-height: 15px;
  font-family: var(--font-family-session-tree);
  position: relative;
  z-index: 0;
  padding-right: 2px;
  margin-left: -4px;
  cursor: pointer;
  user-select: none;
}

.nodeFavicon {
  width: 14px;
  height: 14px;
  float: left;
  margin: 0px;
  margin-right: 4px;
  position: relative;
  z-index: 0;
}

.nodeText {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--font-size-xs);
  min-height: 15px;
  padding-top: 1px;
  font-family: var(--font-family-session-tree);
  position: relative;
  z-index: 0;
}

.nodeTextOpen {
  color: var(--list-item-open-foreground);
}

.nodeTextSaved {
  color: var(--list-item-saved-foreground);
}

.nodeTextDiscarded {
  color: var(--list-item-discarded-foreground);
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
  padding-top: 0px;
}

.treeItem.active .nodeText {
  color: var(--list-item-active-foreground);
}

.treeItem {
  padding-top: 1px;
  padding-bottom: 1px;
}

.treeItem.windowActive.active {
  box-sizing: border-box;
  width: 100%;
  position: relative;
  padding: 1px;
}
.treeItem.windowActive.active > .nodeContainer {
  padding-left: 9px;
}
.treeItem.windowActive.active::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border: 1px solid transparent;
  border-image: linear-gradient(
      to right,
      var(--list-item-focused-border-color-gradient-1),
      var(--list-item-focused-border-color-gradient-2),
      var(--list-item-focused-border-color-gradient-3),
      var(--list-item-focused-border-color-gradient-4)
    )
    5;
  pointer-events: none;
  z-index: 1;
}

[v-cloak] {
  display: none;
}

.sessiontree > ul {
  margin-bottom: 95vh;
}

.windowContainer {
  padding-left: 0px;
  display: flex;
  align-items: center;
  user-select: none;
  cursor: default;
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
  border-left-width: 1px;
  border-left-style: solid;
  border-left-color: var(--list-indent-guide-stroke);
  z-index: 1;
}

/* Last item shouldn't extend the vertical line fully */
.subNodeContainer:last-child::before {
  height: calc(100% - 4px);
}

.collapseArrow {
  display: inline-block;
  width: 12px;
  height: 12px;
  cursor: pointer;
  user-select: none;
  transition: transform 0.2s linear;
  margin-right: 5px;
  margin-left: 1px;
  position: relative;
  stroke: var(--list-icon-foreground);
  transform: rotate(90deg);
}

.collapseArrow.collapsed {
  transform: rotate(0deg);
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
