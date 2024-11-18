<template>
  <div class="popup">
    <h3 class="title">Session Flow</h3>
    <div class="popup-buttons">
      <button @click="openTabTree">Open Tab Tree</button>
      <button @click="openSettings">Settings</button>
      <p>{{ windowsCount }} windows, {{ tabsCount }} tabs open</p>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, onMounted, ref } from 'vue'

export default defineComponent({
  name: 'Popup',
  setup() {
    const windowsCount = ref(0)
    const tabsCount = ref(0)

    const openTabTree = () => {
      browser.windows.create({
        url: 'tab-tree.html',
        type: 'detached_panel',
        width: 300,
        height: 700,
      })
    }

    const openSettings = () => {
      browser.runtime.openOptionsPage()
    }

    const updateTabCount = async () => {
      const windows = await browser.windows.getAll({ populate: true })
      windowsCount.value = windows.length
      tabsCount.value = windows.reduce(
        (count, win) => count + (win.tabs?.length || 0),
        0
      )
    }

    onMounted(updateTabCount)

    return {
      openTabTree,
      openSettings,
      windowsCount,
      tabsCount,
    }
  },
})
</script>

<style scoped>
.popup {
  width: 200px;
  padding: 10px;
}
.title {
  text-align: left;
  margin: 0;
  padding: 0;
}
.popup-buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
