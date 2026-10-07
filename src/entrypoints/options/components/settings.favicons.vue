<script lang="ts" setup>
import { i18n } from '@/services/i18n'
import NumberInput from '@/components/NumberInput.vue'
import ToggleButton from '@/components/ToggleButton.vue'
import { Favicons } from '@/services/favicons'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'

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
    <h2 class="section-title">{{ i18n.t('favicons') }}</h2>
    <div class="section-body rows">
      <ToggleButton
        :label="i18n.t('showAndCacheFaviconsForPrivateTabs')"
        v-model="Settings.values.cachePrivateTabFavicons"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        :label="i18n.t('dimFaviconsOfUnloadedAndSavedTabs')"
        :description="i18n.t('whenOffTheyLookTheSameAsFaviconsOfOpen')"
        v-model="Settings.values.dimUnloadedAndSavedFavicons"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        :label="i18n.t('fetchMissingFaviconsAtStartup')"
        :description="i18n.t('requiresWebsiteAccessPermission')"
        v-model="Settings.values.fetchMissingFaviconsOnStartup"
        :options="OPTIONS.boolean"
        @update="onFetchFaviconsOnStartupUpdate"
      />
      <ToggleButton
        :label="i18n.t('keepFaviconsUpToDate')"
        :description="i18n.t('requiresWebsiteAccessPermission')"
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
        :label="i18n.t('refreshEvery')"
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
        :label="i18n.t('refreshTiming')"
        v-model="Settings.values.faviconRefreshTiming"
        :disabled="Settings.values.refreshFaviconsAfterPeriodOfTime === false"
        :options="OPTIONS.faviconRefreshTiming"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
  </section>
</template>
