<script lang="ts" setup>
import '@/styles/variables.css'
import { findActiveSettingsSection } from '@/services/settings-actions'
import { STRINGS } from '@/types/strings'
import { onMounted, onUnmounted, ref } from 'vue'
import SettingsDragAndDrop from './components/settings.drag-and-drop.vue'
import Favicons from './components/settings.favicons.vue'
import SettingsGeneral from './components/settings.general.vue'
import SettingsContextMenu from './components/settings.context-menu.vue'
import SettingsContainers from './components/settings.containers.vue'
import SettingsTabs from './components/settings.tabs.vue'
import SettingsTabGroups from './components/settings.tab-groups.vue'
import SettingsWindows from './components/settings.windows.vue'
import SettingsStorage from './components/settings.storage.vue'

const sections = [
  { id: 'settings_general', level: 0 },
  { id: 'settings_context_menu', level: 0 },
  { id: 'settings_windows', level: 0 },
  { id: 'settings_tabs', level: 0 },
  { id: 'settings_containers', level: 0 },
  { id: 'settings_tab_groups', level: 0 },
  { id: 'settings_drag_and_drop', level: 0 },
  { id: 'settings_favicons', level: 0 },
  { id: 'settings_storage', level: 0 },
]

const activeSection = ref(sections[0].id)
const extensionVersion = browser.runtime.getManifest().version
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

  const active = findActiveSettingsSection(
    Array.from(sections).map((section) => ({
      id: section.id,
      offsetTop: (section as HTMLElement).offsetTop,
    })),
    scrollTop,
    contentPanel.value?.scrollHeight,
    contentPanel.value?.clientHeight,
  )
  if (active) activeSection.value = active
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
    <nav class="nav-panel">
      <div class="nav-brand">
        <span class="nav-brand-name">Session Flow</span>
        <span class="nav-brand-version">{{ extensionVersion }}</span>
      </div>
      <div class="nav-list">
        <button
          v-for="section in sections"
          :class="[
            'nav-item',
            { 'nav-item-active': activeSection === section.id },
          ]"
          :id="'nav-item-' + section.id"
          :key="section.id"
          :aria-current="activeSection === section.id ? 'true' : undefined"
          type="button"
          @click="scrollToSection(section.id)"
        >
          <span class="nav-item-body">{{ STRINGS[section.id] }}</span>
        </button>
      </div>
    </nav>

    <div
      ref="contentPanel"
      class="content-panel"
    >
      <header class="page-head">
        <h1 class="page-title">Settings</h1>
        <p class="page-sub">Changes save as you make them.</p>
      </header>
      <SettingsGeneral />
      <SettingsContextMenu />
      <SettingsWindows />
      <SettingsTabs />
      <SettingsContainers />
      <SettingsTabGroups />
      <SettingsDragAndDrop />
      <Favicons />
      <SettingsStorage />
    </div>
  </div>
</template>

<style>
* {
  box-sizing: border-box;
}

html,
body,
#app {
  height: 100%;
  margin: 0;
}

body {
  background: var(--background-color-primary);
  color: var(--text-color-primary);
  font-family: var(--font-family);
  font-size: 0.875rem;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

::selection {
  background: var(--options-accent-wash);
  color: var(--header-text-color);
}

:focus-visible {
  outline: 2px solid var(--options-focus);
  outline-offset: 2px;
  border-radius: 3px;
}

.options-root {
  display: grid;
  grid-template-columns: 204px minmax(0, 1fr);
  height: 100vh;
  overflow: hidden;
}

.nav-panel {
  height: 100vh;
  overflow-y: auto;
  padding: 22px 14px 32px;
  border-right: 1px solid var(--options-hairline);
  background: var(--background-color-secondary);
}

.nav-brand {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
  padding: 0 10px 20px;
  border-bottom: 1px solid var(--options-hairline);
}

.nav-brand-name {
  color: var(--header-text-color);
  font-size: var(--font-size-md);
  font-weight: 600;
  letter-spacing: -0.01em;
}

.nav-brand-version {
  color: var(--options-text-faint);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
}

.nav-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 12px;
}

.nav-item {
  position: relative;
  display: block;
  width: 100%;
  padding: 8px 10px 8px 14px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--options-text-muted);
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 0.15s,
    color 0.15s;
}

.nav-item::before {
  position: absolute;
  top: 50%;
  left: 4px;
  width: 2px;
  height: 0;
  border-radius: 1px;
  background: var(--button-active-background);
  content: '';
  transform: translateY(-50%);
  transition: height 0.18s ease;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-color-primary);
}

.nav-item-active {
  background: rgba(255, 255, 255, 0.06);
  color: var(--header-text-color);
}

.nav-item-active::before {
  height: 15px;
}

.nav-item-body {
  display: block;
}

.content-panel {
  min-width: 0;
  overflow-y: auto;
  padding: 0 48px 45vh;
  background: var(--background-color-primary);
}

.page-head {
  max-width: var(--options-measure);
  padding: 44px 0 8px;
}

.page-title {
  margin: 0;
  color: var(--header-text-color);
  font-size: 1.375rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.page-sub,
.section-intro {
  max-width: 62ch;
  color: var(--options-text-muted);
  font-size: 0.8125rem;
}

.page-sub {
  margin: 6px 0 0;
}

.section {
  max-width: var(--options-measure);
  padding: 40px 0 8px;
  scroll-margin-top: 24px;
}

.section.section-wide {
  max-width: 1180px;
}

.section-wide .section-intro,
.section-wide .rows,
.section-wide .dependents,
.section-wide .eyebrow {
  max-width: var(--options-measure);
}

.section-title,
.section > h2 {
  margin: 0;
  padding: 0;
  color: var(--header-text-color);
  font-size: 1.0625rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.section-intro {
  margin: 7px 0 0;
}

.section-body {
  margin-top: 20px;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}

.section-head-text {
  min-width: 0;
}

.section-master {
  flex: 0 0 auto;
}

.section-master.toggle-container {
  display: block;
  padding: 1px 0 0;
  border: 0;
}

.section-master .row-text {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.section-body[data-disabled='true'] {
  opacity: 0.45;
  pointer-events: none;
}

.eyebrow {
  margin: 30px 0 10px;
  color: var(--options-text-faint);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.085em;
  text-transform: uppercase;
}

.eyebrow:first-child {
  margin-top: 0;
}

.rows {
  border-top: 1px solid var(--options-hairline);
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px 32px;
  padding: 13px 0;
  border-bottom: 1px solid var(--options-hairline);
}

.row-text {
  min-width: 0;
}

.row-label {
  display: block;
  color: var(--text-color-primary);
  font-size: 0.875rem;
}

.row-desc {
  max-width: 54ch;
  margin: 3px 0 0;
  color: var(--options-text-muted);
  font-size: 0.8125rem;
  line-height: 1.45;
}

.dependents {
  margin: 4px 0 14px;
  padding: 4px 16px;
  border-radius: 8px;
  background: var(--options-surface);
}

.dependents .row:last-child {
  border-bottom: 0;
}

.dependents[data-disabled='true'] {
  opacity: 0.45;
  pointer-events: none;
}

.segmented {
  display: inline-flex;
  padding: 2px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.05);
}

.segmented button {
  padding: 5px 11px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--options-text-muted);
  font-family: inherit;
  font-size: 0.8125rem;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color 0.15s,
    color 0.15s;
}

.segmented button:hover:not(:disabled) {
  color: var(--text-color-primary);
}

.segmented button.active {
  background: var(--button-active-background);
  color: var(--button-active-foreground);
  font-weight: 500;
}

.segmented button.active:hover:not(:disabled) {
  background: var(--button-active-background-hover);
}

.stepper-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.stepper {
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  border: 1px solid var(--options-hairline-strong);
  border-radius: 7px;
}

.stepper button {
  width: 26px;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--options-text-muted);
  font-family: inherit;
  font-size: var(--font-size-md);
  line-height: 1;
  cursor: pointer;
}

.stepper button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: var(--header-text-color);
}

.stepper-value {
  min-width: 40px;
  padding: 4px 2px;
  color: var(--header-text-color);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.toggle-container,
.number-container {
  -moz-user-select: none;
  user-select: none;
}

button:disabled,
input:disabled {
  cursor: default;
  opacity: 0.55;
}

@media (max-width: 760px) {
  .options-root {
    grid-template-columns: 168px minmax(0, 1fr);
  }

  .content-panel {
    padding-right: 24px;
    padding-left: 24px;
  }

  .row {
    grid-template-columns: 1fr;
  }
}
</style>
