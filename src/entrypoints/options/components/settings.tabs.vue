<script lang="ts" setup>
import { i18n } from '@/services/i18n'
import { Settings } from '@/services/settings'
import ToggleButton from '@/components/ToggleButton.vue'
import { OPTIONS } from '@/types/settings'
</script>

<template>
  <section
    id="settings_tabs"
    class="content-panel-section section"
  >
    <h2 class="section-title">{{ i18n.t('tabsLabel') }}</h2>
    <div class="section-body rows">
      <ToggleButton
        :label="i18n.t('focusATabWhenItOpens')"
        v-model="Settings.values.focusTabOnOpen"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        :label="i18n.t('saveTabsWhenTheyClose')"
        v-model="Settings.values.saveTabOnClose"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
    <div
      class="dependents"
      :data-disabled="Settings.values.saveTabOnClose"
      :inert="Settings.values.saveTabOnClose"
    >
      <ToggleButton
        :label="i18n.t('saveItIfItWasPreviouslySaved')"
        v-model="Settings.values.saveTabOnCloseIfPreviouslySaved"
        :options="OPTIONS.boolean"
        :disabled="Settings.values.saveTabOnClose"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
    <p class="eyebrow">{{ i18n.t('doubleclick') }}</p>
    <div class="rows">
      <ToggleButton
        :label="i18n.t('anOpenTab')"
        v-model="Settings.values.doubleClickOnOpenTab"
        :options="OPTIONS.doubleClickOnOpenTab"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        :label="i18n.t('aSavedTab')"
        v-model="Settings.values.doubleClickOnSavedTab"
        :options="OPTIONS.doubleClickOnSavedTab"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
    <p class="eyebrow">{{ i18n.t('showOnHover') }}</p>
    <div class="rows">
      <ToggleButton
        :label="i18n.t('tabTitle')"
        v-model="Settings.values.showTabTitleOnHover"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        :label="i18n.t('tabURL')"
        v-model="Settings.values.showTabUrlOnHover"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        :label="i18n.t('tabGroupLabel')"
        v-model="Settings.values.tabGroupInfoOnHover"
        :options="OPTIONS.tabGroupInfoOnHover"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
  </section>
</template>
