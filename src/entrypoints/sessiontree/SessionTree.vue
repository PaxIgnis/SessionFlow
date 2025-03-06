<script lang="ts" setup>
import { ref, onMounted, triggerRef, onBeforeUnmount } from 'vue'
import { Window, State } from './sessiontree.interfaces.ts'

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
}

// Initialize a local reactive sessionTree
const sessionTree = ref<{ windows: Array<Window> }>({ windows: [] })
const hoveredTab = ref<string | null>(null) // Track the hovered tab
const hoveredWindow = ref<number | null>(null) // Track the hovered window

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
      case 'TREE_UPDATED':
        handleTreeUpdate()
        break
      default:
        console.warn('Unknown message type:', message.type)
    }
  })
  handleTreeUpdate()
})

// reset sessionTree to non-ref object to avoid zombie dead object
onBeforeUnmount(() => {
  console.log('Unmounted')
  window.browser.extension.getBackgroundPage().resetSessionTree()
})

// Handler functions
function handleTreeUpdate() {
  // triggerRef(sessionTree)
  console.log('Tree updated inside SessionTree', sessionTree.value)
}

const getTabTree = () => {
  handleTreeUpdate()
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
</script>

<template>
  <div class="sessiontree">
    <a href="https://wxt.dev" target="_blank">
      <img src="/wxt.svg" class="logo" alt="WXT logo" />
    </a>
    <a href="https://vuejs.org/" target="_blank">
      <img src="@/assets/vue.svg" class="logo vue" alt="Vue logo" />
    </a>
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
        <ul class="tabsList">
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
              <img class="nodeFavicon" src="/icon/16.png" alt="Tab icon" />
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

.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}
.logo:hover {
  filter: drop-shadow(0 0 2em #54bc4ae0);
}
.logo.vue:hover {
  filter: drop-shadow(0 0 2em #42b883aa);
}

.nodeContainer {
  cursor: pointer;
  padding-left: 15px;
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
  padding-left: 15px;
  white-space: nowrap;
}

.tabsList {
  padding-bottom: 10px;
}

[v-cloak] {
  display: none;
}

.windowContainer {
  padding-left: 15px;
  display: block;
}
</style>
