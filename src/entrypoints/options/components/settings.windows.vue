<script lang="ts" setup>
import { Settings } from '@/services/settings'
import ToggleButton from '@/components/ToggleButton.vue'
import { OPTIONS } from '@/types/settings'
import { STRINGS } from '@/types/strings'
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
      label="Reopen Windows In The Same Location"
      v-model="Settings.values.openWindowsInSameLocation"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
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
