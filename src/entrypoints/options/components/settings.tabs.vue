<script lang="ts" setup>
import { Settings } from '@/services/settings'
import ToggleButton from '@/components/ToggleButton.vue'
import { OPTIONS } from '@/types/settings'
import { STRINGS } from '@/types/strings'
</script>

<template>
  <section id="settings_tabs" class="content-panel-section">
    <h2>{{ STRINGS.settings_tabs }}</h2>
    <ToggleButton
      label="Focus Tab When Opened"
      v-model="Settings.values.focusTabOnOpen"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="Save Tab When Closed"
      v-model="Settings.values.saveTabOnClose"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      class="child-setting"
      label="Save Tab When Closed If It Previously Was Saved"
      v-model="Settings.values.saveTabOnCloseIfPreviouslySaved"
      :options="OPTIONS.boolean"
      :disabled="Settings.values.saveTabOnClose"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="Double Click On Open Tab"
      v-model="Settings.values.doubleClickOnOpenTab"
      :options="OPTIONS.doubleClickOnOpenTab"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="Double Click On Saved Tab"
      v-model="Settings.values.doubleClickOnSavedTab"
      :options="OPTIONS.doubleClickOnSavedTab"
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

.child-setting:has(input:disabled),
.child-setting:has(button:disabled) {
  --child-opacity: 0.5;
  --child-events: none;
}
</style>
