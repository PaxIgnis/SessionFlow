<script lang="ts" setup>
import ToggleButton from '@/components/ToggleButton.vue'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'
import { STRINGS } from '@/types/strings'
</script>

<template>
  <section
    id="settings_tab_groups"
    class="content-panel-section"
  >
    <h2>{{ STRINGS.settings_tab_groups }}</h2>
    <ToggleButton
      label="Automatically Group Tabs Dropped Adjacent to Grouped Tabs"
      v-model="Settings.values.tabGroupDropBehavior"
      :options="OPTIONS.tabGroupDropBehavior"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="Tab Group Color Indicator"
      v-model="Settings.values.tabGroupColorIndicator"
      :options="OPTIONS.tabGroupColorIndicator"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="Save Tabs When Their Group Is Removed (Includes Closing Its Last Tab)"
      v-model="Settings.values.saveTabsWhenTabGroupDeleted"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
  </section>
</template>
