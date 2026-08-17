<script lang="ts" setup>
import ToggleButton from '@/components/ToggleButton.vue'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'
import { STRINGS } from '@/types/strings'
</script>

<template>
  <section
    id="settings_containers"
    class="content-panel-section section"
  >
    <h2 class="section-title">{{ STRINGS.settings_containers }}</h2>
    <div class="section-body rows">
      <ToggleButton
        label="Color indicator"
        v-model="Settings.values.containerColorIndicator"
        :options="OPTIONS.containerColorIndicator"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
    <div
      class="dependents"
      :data-disabled="Settings.values.containerColorIndicator === 'off'"
      :inert="Settings.values.containerColorIndicator === 'off'"
    >
      <ToggleButton
        label="Fade side"
        v-model="Settings.values.containerFadeSide"
        :options="OPTIONS.containerFadeSide"
        :disabled="Settings.values.containerColorIndicator === 'off'"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
    <div class="rows">
      <ToggleButton
        label="Container icon"
        v-model="Settings.values.containerIconPosition"
        :options="OPTIONS.containerIconPosition"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
  </section>
</template>
