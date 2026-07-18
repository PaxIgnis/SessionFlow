<script lang="ts" setup>
import ToggleButton from '@/components/ToggleButton.vue'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'
import { STRINGS } from '@/types/strings'
</script>

<template>
  <section
    id="settings_containers"
    class="content-panel-section"
  >
    <h2>{{ STRINGS.settings_containers }}</h2>
    <ToggleButton
      label="Container Color Indicator"
      v-model="Settings.values.containerColorIndicator"
      :options="OPTIONS.containerColorIndicator"
      @update="Settings.saveSettingsToStorage()"
    />
    <div class="child-setting">
      <ToggleButton
        label="Fade Side"
        v-model="Settings.values.containerFadeSide"
        :options="OPTIONS.containerFadeSide"
        :disabled="Settings.values.containerColorIndicator === 'off'"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
    <ToggleButton
      label="Container Icon"
      v-model="Settings.values.containerIconPosition"
      :options="OPTIONS.containerIconPosition"
      @update="Settings.saveSettingsToStorage()"
    />
  </section>
</template>
