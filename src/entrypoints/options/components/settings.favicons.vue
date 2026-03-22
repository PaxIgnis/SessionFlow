<script lang="ts" setup>
import ToggleButton from '@/components/ToggleButton.vue'
import { Favicons } from '@/services/favicons'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'
import { STRINGS } from '@/types/strings'

async function onFetchFaviconsOnStartupUpdate(
  value: string | number | boolean,
) {
  if (value !== true) {
    await Settings.saveSettingsToStorage()
    return
  }
  // Firefox requires permissions.request() to be called from a user input handler.
  // Call it immediately on toggle-on, before any other awaited operation.
  const granted = await Favicons.requestFetchPermissions()
  if (!granted) {
    Settings.values.fetchMissingFaviconsOnStartup = false
  }

  await Settings.saveSettingsToStorage()
}
</script>

<template>
  <section
    id="settings_favicons"
    class="content-panel-section"
  >
    <h2>{{ STRINGS.settings_favicons }}</h2>
    <ToggleButton
      label="Fetch Missing Favicons On Startup (Requires Additional Permissions)"
      v-model="Settings.values.fetchMissingFaviconsOnStartup"
      :options="OPTIONS.boolean"
      @update="onFetchFaviconsOnStartupUpdate"
    />
    <ToggleButton
      label="Refresh Favicons After Period Of Time (Requires Additional Permissions)"
      v-model="Settings.values.refreshFaviconsAfterPeriodOfTime"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="Period Of Time Units"
      class="child-setting"
      v-model="Settings.values.refreshFaviconsAfterPeriodOfTimeUnit"
      :disabled="Settings.values.refreshFaviconsAfterPeriodOfTime === false"
      :options="OPTIONS.refreshFaviconsAfterPeriodOfTimeUnit"
      @update="Settings.saveSettingsToStorage()"
    />
  </section>
</template>
