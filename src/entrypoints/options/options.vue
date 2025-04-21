<script lang="ts" setup>
import { ref, onMounted, onUnmounted } from 'vue'
import SettingsGeneral from './components/settings.general.vue'
import SettingsWindows from './components/settings.windows.vue'
import SettingsTabs from './components/settings.tabs.vue'
import Favicons from './components/settings.favicons.vue'
import { STRINGS } from '@/types/strings'
import '@/styles/variables.css'

const sections = [
  { id: 'settings_general', level: 0 },
  { id: 'settings_windows', level: 0 },
  { id: 'settings_tabs', level: 0 },
  { id: 'settings_favicons', level: 0 },
  { id: 'settings_storage', level: 0 },
]

const activeSection = ref(sections[0].id)
const contentPanel = ref<HTMLElement | null>(null)
const isScrolling = ref(false)
const scrollTimeout = ref<number | null>(null)

// Scrolls to a section in the content panel
const scrollToSection = async (sectionId: string) => {
  const targetSection = document.getElementById(sectionId)
  if (!targetSection) return

  // Clear previous timeout if it exists
  if (scrollTimeout.value) {
    window.clearTimeout(scrollTimeout.value)
    scrollTimeout.value = null
  }

  isScrolling.value = true
  activeSection.value = sectionId
  targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' })

  // Set new timeout and store its ID
  scrollTimeout.value = window.setTimeout(() => {
    isScrolling.value = false
    scrollTimeout.value = null
  }, 1000)
}

const handleScroll = () => {
  if (isScrolling.value) return

  const sections = document.querySelectorAll('.content-panel > section')
  const scrollTop = contentPanel.value?.scrollTop || 0

  // Find top visible section
  for (const section of sections) {
    const htmlSection = section as HTMLElement
    if (htmlSection.offsetTop >= scrollTop - htmlSection.clientHeight) {
      activeSection.value = section.id
      break
    }
  }
}

onMounted(() => {
  contentPanel.value?.addEventListener('scroll', handleScroll)
})

onUnmounted(() => {
  contentPanel.value?.removeEventListener('scroll', handleScroll)
  if (scrollTimeout.value) {
    window.clearTimeout(scrollTimeout.value)
  }
})
</script>

<template>
  <div class="options-root">
    <!-- Left Navigation Panel -->
    <nav class="nav-panel">
      <div
        v-for="section in sections"
        :class="[
          'nav-item',
          { 'nav-item-active': activeSection === section.id },
        ]"
        :id="'nav-item-' + section.id"
        :key="section.id"
        @click="scrollToSection(section.id)"
      >
        <div class="nav-item-body">
          {{ STRINGS[section.id] }}
        </div>
      </div>
    </nav>

    <!-- Right Content Panel -->
    <div ref="contentPanel" class="content-panel">
      <SettingsGeneral />
      <SettingsWindows />
      <SettingsTabs />
      <Favicons />
      <!-- <Storage /> -->
    </div>
  </div>
</template>

<style>
.options-root {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.nav-panel {
  width: 200px;
  background-color: var(--background-color-secondary);
  padding: 20px 0;
  border-right: 1px solid var(--nav-panel-border-color);
  position: fixed;
  height: 100%;
  overflow-y: auto;
}

.nav-item {
  padding: 12px 12px;
  cursor: default;
  display: flex;
  align-items: center;
  gap: 8px;
  -moz-user-select: none;
  user-select: none;
  font-weight: bold;
  margin: 0 12px 0 12px;
}

.nav-item:hover {
  background: var(--nav-panel-hover-color);
  border-radius: 6px;
}

.nav-item:active {
  background: var(--nav-panel-active-background);
  border-radius: 6px;
}

.nav-item-body {
  content: '';
  width: 100%;
  height: 100%;
  color: var(--text-color-primary);
}

.content-panel {
  flex: 1;
  padding: 20px 40px;
  margin-left: 200px;
  overflow-y: auto;
  background-color: var(--background-color-primary);
}

.section {
  min-height: 100vh;
  padding: 20px 0;
}

h2 {
  padding-top: 24px;
  margin-bottom: 24px;
  padding-bottom: 2px;
  color: var(--header-text-color);
}

.child-element {
  margin-left: 24px;
}

.content-panel > section > h2 {
  -moz-user-select: none;
}

.content-panel > section:last-child {
  margin-bottom: 50vh;
}

.toggle-container,
.number-container {
  -moz-user-select: none;
}

.nav-item-active {
  background: var(--nav-panel-focused-active-background) !important;
  border-radius: 6px;
}
</style>
