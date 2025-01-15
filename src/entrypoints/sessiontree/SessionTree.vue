<script lang="ts" setup>
import { ref, onMounted, triggerRef, onBeforeUnmount } from 'vue'
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
interface Window {
  id: number
  tabs: Array<{ id: number; url: string; title: string }>
}

const sessionTree = ref<{ windows: Array<Window> }>({ windows: [] })

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

    <ul>
      <li v-for="window in sessionTree.windows" :key="window.id">
        <strong>Window {{ window.id }}</strong>
        <ul>
          <li v-for="tab in window.tabs" :key="tab.id">
            <a :href="tab.url" target="_blank">{{ tab.title }}</a>
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>

<style scoped>
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

.sessiontree ul {
  list-style-type: none;
  padding: 0;
  margin: 0;
}

.sessiontree li {
  margin-bottom: 8px;
}

.sessiontree a {
  color: blue;
  text-decoration: none;
}

.sessiontree a:hover {
  text-decoration: underline;
}
</style>
