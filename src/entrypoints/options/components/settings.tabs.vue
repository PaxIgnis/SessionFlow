<script lang="ts" setup>
import { Settings } from '@/services/settings'
import ToggleButton from '@/components/ToggleButton.vue'
import { OPTIONS } from '@/types/settings'
import { STRINGS } from '@/types/strings'
</script>

<template>
  <section
    id="settings_tabs"
    class="content-panel-section section"
  >
    <h2 class="section-title">{{ STRINGS.settings_tabs }}</h2>
    <div class="section-body rows">
      <ToggleButton
        label="Focus a tab when it opens"
        v-model="Settings.values.focusTabOnOpen"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        label="Save tabs when they close"
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
        label="Save it if it was previously saved"
        v-model="Settings.values.saveTabOnCloseIfPreviouslySaved"
        :options="OPTIONS.boolean"
        :disabled="Settings.values.saveTabOnClose"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
    <p class="eyebrow">Double-click</p>
    <div class="rows">
      <ToggleButton
        label="An open tab"
        v-model="Settings.values.doubleClickOnOpenTab"
        :options="OPTIONS.doubleClickOnOpenTab"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        label="A saved tab"
        v-model="Settings.values.doubleClickOnSavedTab"
        :options="OPTIONS.doubleClickOnSavedTab"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
    <p class="eyebrow">Show on hover</p>
    <div class="rows">
      <ToggleButton
        label="Tab title"
        v-model="Settings.values.showTabTitleOnHover"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        label="Tab URL"
        v-model="Settings.values.showTabUrlOnHover"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        label="Tab group"
        v-model="Settings.values.tabGroupInfoOnHover"
        :options="OPTIONS.tabGroupInfoOnHover"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
  </section>
</template>
