<script lang="ts" setup>
import NumberInput from '@/components/NumberInput.vue'
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

async function onAutomaticFaviconRefreshUpdate(
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
    Settings.values.refreshFaviconsAfterPeriodOfTime = false
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
      label="Fetch Missing Favicons When Firefox Starts (Requires Website Access)"
      v-model="Settings.values.fetchMissingFaviconsOnStartup"
      :options="OPTIONS.boolean"
      @update="onFetchFaviconsOnStartupUpdate"
    />
    <ToggleButton
      label="Automatically Keep Favicons Up to Date (Requires Website Access)"
      v-model="Settings.values.refreshFaviconsAfterPeriodOfTime"
      :options="OPTIONS.boolean"
      @update="onAutomaticFaviconRefreshUpdate"
    />
    <NumberInput
      class="child-setting"
      label="Refresh Favicons Every"
      v-model:value="Settings.values.refreshFaviconsAfterPeriodOfTimeValue"
      v-model:selected-unit="
        Settings.values.refreshFaviconsAfterPeriodOfTimeUnit
      "
      :units="OPTIONS.refreshFaviconsAfterPeriodOfTimeUnit"
      :min="1"
      :max="999"
      :disabled="Settings.values.refreshFaviconsAfterPeriodOfTime === false"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="Automatic Refresh Timing"
      class="child-setting"
      v-model="Settings.values.faviconRefreshTiming"
      :disabled="Settings.values.refreshFaviconsAfterPeriodOfTime === false"
      :options="OPTIONS.faviconRefreshTiming"
      @update="Settings.saveSettingsToStorage()"
    />
  </section>
</template>
