<script lang="ts" setup>
import { Settings } from '@/services/settings'
import ToggleButton from '@/components/ToggleButton.vue'
import { OPTIONS } from '@/types/settings'
import { STRINGS } from '@/types/strings'
</script>

<template>
  <section id="settings_general" class="content-panel-section">
    <h2>{{ STRINGS.settings_general }}</h2>
    <ToggleButton
      label="Open Session Tree In Same Location"
      v-model="Settings.values.openSessionTreeInSameLocation"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      label="Open Session Tree On Startup"
      v-model="Settings.values.openSessionTreeOnStartup"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
  </section>
</template>
