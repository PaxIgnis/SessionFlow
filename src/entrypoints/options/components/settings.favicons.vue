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
    class="content-panel-section section"
  >
    <h2 class="section-title">{{ STRINGS.settings_favicons }}</h2>
    <div class="section-body rows">
      <ToggleButton
        label="Show and cache favicons for private tabs"
        v-model="Settings.values.cachePrivateTabFavicons"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        label="Dim favicons of unloaded and saved tabs"
        description="When off, they look the same as favicons of open tabs."
        v-model="Settings.values.dimUnloadedAndSavedFavicons"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        label="Fetch missing favicons at startup"
        description="Requires website access permission."
        v-model="Settings.values.fetchMissingFaviconsOnStartup"
        :options="OPTIONS.boolean"
        @update="onFetchFaviconsOnStartupUpdate"
      />
      <ToggleButton
        label="Keep favicons up to date"
        description="Requires website access permission."
        v-model="Settings.values.refreshFaviconsAfterPeriodOfTime"
        :options="OPTIONS.boolean"
        @update="onAutomaticFaviconRefreshUpdate"
      />
    </div>
    <div
      class="dependents"
      :data-disabled="!Settings.values.refreshFaviconsAfterPeriodOfTime"
      :inert="!Settings.values.refreshFaviconsAfterPeriodOfTime"
    >
      <NumberInput
        label="Refresh every"
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
        label="Refresh timing"
        v-model="Settings.values.faviconRefreshTiming"
        :disabled="Settings.values.refreshFaviconsAfterPeriodOfTime === false"
        :options="OPTIONS.faviconRefreshTiming"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
  </section>
</template>
