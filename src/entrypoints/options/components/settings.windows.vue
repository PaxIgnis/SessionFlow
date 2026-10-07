<script lang="ts" setup>
import { i18n } from '@/services/i18n'
import NumberInput from '@/components/NumberInput.vue'
import ToggleButton from '@/components/ToggleButton.vue'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'

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
    <h2 class="section-title">{{ i18n.t('windows') }}</h2>
    <div class="section-body rows">
      <ToggleButton
        :label="i18n.t('focusAWindowWhenItOpens')"
        v-model="Settings.values.focusWindowOnOpen"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        :label="i18n.t('openSavedWindowsLazily')"
        :description="i18n.t('tabsLoadTheFirstTimeYouClickThemNotWhen')"
        v-model="Settings.values.openWindowWithTabsDiscarded"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        :label="i18n.t('reopenWindowsInTheirLastPosition')"
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
        :label="i18n.t('trackWindowPositionsEvery')"
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
    <p class="eyebrow">{{ i18n.t('whenAWindowCloses') }}</p>
    <div class="rows">
      <ToggleButton
        :label="i18n.t('alwaysSaveIt')"
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
        :label="i18n.t('saveItIfItContainsSavedTabs')"
        v-model="Settings.values.saveWindowOnCloseIfContainsSavedTabs"
        :options="OPTIONS.boolean"
        :disabled="Settings.values.saveWindowOnClose"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        :label="i18n.t('saveItIfItWasPreviouslySaved')"
        v-model="Settings.values.saveWindowOnCloseIfPreviouslySaved"
        :options="OPTIONS.boolean"
        :disabled="Settings.values.saveWindowOnClose"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        :label="i18n.t('saveItIfItContainsNotes')"
        v-model="Settings.values.saveWindowOnCloseIfContainsNotes"
        :options="OPTIONS.boolean"
        :disabled="Settings.values.saveWindowOnClose"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
  </section>
</template>
