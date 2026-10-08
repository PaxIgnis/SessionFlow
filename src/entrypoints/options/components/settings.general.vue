<script lang="ts" setup>
import { i18n } from '@/services/i18n'
import ToggleButton from '@/components/ToggleButton.vue'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'
</script>

<template>
  <section
    id="settings_general"
    class="content-panel-section section"
  >
    <h2 class="section-title">{{ i18n.t('general') }}</h2>
    <div class="section-body rows">
      <ToggleButton
        :label="i18n.t('openTheSessionTreeOnStartup')"
        v-model="Settings.values.openSessionTreeOnStartup"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        :label="i18n.t('reopenTheTreeAtItsLastSizeAndPosition')"
        v-model="Settings.values.openSessionTreeInSameLocation"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        :label="i18n.t('restoreThePreviousSessionOnStartup')"
        v-model="Settings.values.restorePreviousSessionOnStartup"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        :label="i18n.t('matchOpenWindowsToSavedWindowsAtStartup')"
        :description="
          i18n.t('reconnectsTheWindowsFirefoxReopenedToTheOnesAlreadyIn')
        "
        v-model="Settings.values.matchOpenedWindowsWithSavedWindowsOnStartup"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        :label="i18n.t('reconnectItemsFirefoxRestores')"
        :description="i18n.t('appliesWhenYouUndoAClosedTabOrWindow')"
        v-model="Settings.values.reconnectFirefoxRestoredItems"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        :label="i18n.t('showIndentLinesOnItemsWithoutChildren')"
        v-model="Settings.values.showIndentLinesWithoutChildren"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
  </section>
</template>
