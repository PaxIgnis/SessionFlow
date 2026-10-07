<script lang="ts" setup>
import { i18n } from '@/services/i18n'
import ToggleButton from '@/components/ToggleButton.vue'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'
</script>

<template>
  <section
    id="settings_containers"
    class="content-panel-section section"
  >
    <h2 class="section-title">{{ i18n.t('containers') }}</h2>
    <div class="section-body rows">
      <ToggleButton
        :label="i18n.t('colorIndicator')"
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
        :label="i18n.t('fadeSide')"
        v-model="Settings.values.containerFadeSide"
        :options="OPTIONS.containerFadeSide"
        :disabled="Settings.values.containerColorIndicator === 'off'"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
    <div class="rows">
      <ToggleButton
        :label="i18n.t('containerIcon')"
        v-model="Settings.values.containerIconPosition"
        :options="OPTIONS.containerIconPosition"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
  </section>
</template>
