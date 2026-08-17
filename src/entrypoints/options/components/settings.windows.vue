<script lang="ts" setup>
import NumberInput from '@/components/NumberInput.vue'
import ToggleButton from '@/components/ToggleButton.vue'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'
import { STRINGS } from '@/types/strings'

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
  <section
    id="settings_windows"
    class="content-panel-section section"
  >
    <h2 class="section-title">{{ STRINGS.settings_windows }}</h2>
    <div class="section-body rows">
      <ToggleButton
        label="Focus a window when it opens"
        v-model="Settings.values.focusWindowOnOpen"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        label="Open saved windows lazily"
        description="Tabs load the first time you click them, not when the window opens."
        v-model="Settings.values.openWindowWithTabsDiscarded"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        label="Reopen windows in their last position"
        v-model="Settings.values.openWindowsInSameLocation"
        :options="OPTIONS.boolean"
        @update="updateLocation()"
      />
    </div>
    <div
      class="dependents"
      :data-disabled="!Settings.values.openWindowsInSameLocation"
      :inert="!Settings.values.openWindowsInSameLocation"
    >
      <NumberInput
        label="Track window positions every"
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
    </div>
    <p class="eyebrow">When a window closes</p>
    <div class="rows">
      <ToggleButton
        label="Always save it"
        v-model="Settings.values.saveWindowOnClose"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
    <div
      class="dependents"
      :data-disabled="Settings.values.saveWindowOnClose"
      :inert="Settings.values.saveWindowOnClose"
    >
      <ToggleButton
        label="Save it if it contains saved tabs"
        v-model="Settings.values.saveWindowOnCloseIfContainsSavedTabs"
        :options="OPTIONS.boolean"
        :disabled="Settings.values.saveWindowOnClose"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        label="Save it if it was previously saved"
        v-model="Settings.values.saveWindowOnCloseIfPreviouslySaved"
        :options="OPTIONS.boolean"
        :disabled="Settings.values.saveWindowOnClose"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        label="Save it if it contains notes"
        v-model="Settings.values.saveWindowOnCloseIfContainsNotes"
        :options="OPTIONS.boolean"
        :disabled="Settings.values.saveWindowOnClose"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
  </section>
</template>
