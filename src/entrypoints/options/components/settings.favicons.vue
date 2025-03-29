<script lang="ts" setup>
import { Settings } from '@/services/settings'
import ToggleButton from '@/components/ToggleButton.vue'
import { OPTIONS } from '@/types/settings'
import { STRINGS } from '@/types/strings'
</script>

<template>
  <section id="settings_favicons" class="content-panel-section">
    <h2>{{ STRINGS.settings_favicons }}</h2>
    <ToggleButton
      label="Fetch Missing Favicons On Startup"
      v-model="Settings.values.fetchMissingFaviconsOnStartup"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="Refresh Favicons After Period Of Time"
      v-model="Settings.values.refreshFaviconsAfterPeriodOfTime"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="Period Of Time Units"
      class="child-element"
      v-model="Settings.values.refreshFaviconsAfterPeriodOfTimeUnit"
      :options="OPTIONS.refreshFaviconsAfterPeriodOfTimeUnit"
      @update="Settings.saveSettingsToStorage()"
    />
  </section>
</template>
