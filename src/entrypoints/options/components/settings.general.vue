<script lang="ts" setup>
import ToggleButton from '@/components/ToggleButton.vue'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'
import { STRINGS } from '@/types/strings'
</script>

<template>
  <section
    id="settings_general"
    class="content-panel-section"
  >
    <h2>{{ STRINGS.settings_general }}</h2>
    <ToggleButton
      label="Open Session Tree In Same Location"
      v-model="Settings.values.openSessionTreeInSameLocation"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="Open Session Tree On Startup"
      v-model="Settings.values.openSessionTreeOnStartup"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="On browser startup, try to match opened windows with saved windows."
      v-model="Settings.values.matchOpenedWindowsWithSavedWindowsOnStartup"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="Restore previous session on startup"
      v-model="Settings.values.restorePreviousSessionOnStartup"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="Show Indent Lines Without Children"
      v-model="Settings.values.showIndentLinesWithoutChildren"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="When Indent Is Adjusted, Include Children of Selected Items"
      v-model="Settings.values.includeChildrenOfSelectedItemsWhenIndenting"
      :options="OPTIONS.includeChildrenOfSelectedItemsWhenIndenting"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="When Duplicating Tabs or Notes"
      v-model="Settings.values.duplicateTreeItemDescendants"
      :options="OPTIONS.duplicateTreeItemDescendants"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="Duplicated Item State"
      v-model="Settings.values.duplicatedItemState"
      :options="OPTIONS.duplicatedItemState"
      @update="Settings.saveSettingsToStorage()"
    />
  </section>
</template>
