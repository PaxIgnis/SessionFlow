<script lang="ts" setup>
import { Settings } from '@/services/settings'
import ToggleButton from '@/components/ToggleButton.vue'
import { OPTIONS } from '@/types/settings'
import { STRINGS } from '@/types/strings'
import NumberInput from '@/components/NumberInput.vue'
declare const browser: any
function updateLocation() {
  Settings.saveSettingsToStorage()
  setTimeout(() => {
    browser.runtime.sendMessage({
      action: 'openWindowsInSameLocationUpdated',
    })
  }, 5000)
}
</script>

<template>
  <section id="settings_windows" class="content-panel-section">
    <h2>{{ STRINGS.settings_windows }}</h2>
    <ToggleButton
      label="Focus Window When Opened"
      v-model="Settings.values.focusWindowOnOpen"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="Open Saved Window with Tabs Discarded (lazy loading)"
      v-model="Settings.values.openWindowWithTabsDiscarded"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="Reopen Windows In The Same Location"
      v-model="Settings.values.openWindowsInSameLocation"
      :options="OPTIONS.boolean"
      @update="updateLocation()"
    />
    <NumberInput
      class="child-setting"
      label="Interval to Update Open Windows Location"
      v-model:value="Settings.values.openWindowsInSameLocationUpdateInterval"
      v-model:selected-unit="
        Settings.values.openWindowsInSameLocationUpdateIntervalUnit
      "
      :units="OPTIONS.openWindowsInSameLocationUpdateIntervalUnit"
      :min="1"
      :max="3600"
      :disabled="!Settings.values.openWindowsInSameLocation"
      @update="updateLocation()"
    />
    <ToggleButton
      label="Save Window When Closed"
      v-model="Settings.values.saveWindowOnClose"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="Save Window When Closed If It Contains Saved Tabs"
      v-model="Settings.values.saveWindowOnCloseIfContainsSavedTabs"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="Save Window When Closed If It Was Previously Saved"
      v-model="Settings.values.saveWindowOnCloseIfPreviouslySaved"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
  </section>
</template>

<style scoped>
.child-setting {
  margin-left: 20px;
  opacity: var(--child-opacity, 1);
  pointer-events: var(--child-events, auto);
}

.child-setting:has(input:disabled) {
  --child-opacity: 0.5;
  --child-events: none;
}
</style>
