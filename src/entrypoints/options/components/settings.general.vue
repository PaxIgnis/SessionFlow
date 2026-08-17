<script lang="ts" setup>
import ToggleButton from '@/components/ToggleButton.vue'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'
import { STRINGS } from '@/types/strings'
</script>

<template>
  <section
    id="settings_general"
    class="content-panel-section section"
  >
    <h2 class="section-title">{{ STRINGS.settings_general }}</h2>
    <div class="section-body rows">
      <ToggleButton
        label="Open the session tree on startup"
        v-model="Settings.values.openSessionTreeOnStartup"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        label="Reopen the tree at its last size and position"
        v-model="Settings.values.openSessionTreeInSameLocation"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        label="Restore the previous session on startup"
        v-model="Settings.values.restorePreviousSessionOnStartup"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        label="Match open windows to saved windows at startup"
        description="Reconnects the windows Firefox reopened to the ones already in your tree, instead of adding duplicates."
        v-model="Settings.values.matchOpenedWindowsWithSavedWindowsOnStartup"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        label="Reconnect items Firefox restores"
        description="Applies when you undo a closed tab or window."
        v-model="Settings.values.reconnectFirefoxRestoredItems"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        label="Show indent lines on items without children"
        v-model="Settings.values.showIndentLinesWithoutChildren"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        label="State of duplicated items"
        description="A duplicate can start saved, or inherit whether the original was open."
        v-model="Settings.values.duplicatedItemState"
        :options="OPTIONS.duplicatedItemState"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
  </section>
</template>
