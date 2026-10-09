<script lang="ts" setup>
import { i18n } from '@/services/i18n'
import ToggleButton from '@/components/ToggleButton.vue'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'
import { openIntroduction } from '@/services/onboarding-client'
import { ref } from 'vue'

const introductionError = ref('')
const openingIntroduction = ref(false)
async function showIntroduction() {
  if (openingIntroduction.value) return
  openingIntroduction.value = true
  introductionError.value = ''
  try {
    await openIntroduction(true)
  } catch {
    introductionError.value = i18n.t('onboardingError')
  } finally {
    openingIntroduction.value = false
  }
}
</script>

<template>
  <section
    id="settings_general"
    class="content-panel-section section"
  >
    <div class="section-head">
      <h2 class="section-title">{{ i18n.t('general') }}</h2>
      <button
        type="button"
        class="introduction-button"
        :disabled="openingIntroduction"
        :title="i18n.t('onboardingGuideLabel')"
        @click="showIntroduction"
      >
        {{ i18n.t('onboardingReplay') }}
      </button>
    </div>
    <p
      v-if="introductionError"
      role="alert"
    >
      {{ introductionError }}
    </p>
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

<style scoped>
.section-head {
  flex-wrap: wrap;
  gap: 8px;
}
.introduction-button {
  flex: 0 0 auto;
  max-width: 100%;
  margin-inline-start: auto;
  font: inherit;
  font-size: 12px;
  line-height: 1.4;
  padding: 6px 10px;
  border: 1px solid var(--options-hairline-strong);
  border-radius: 6px;
  background: transparent;
  color: var(--text-color-primary);
  cursor: pointer;
}
.introduction-button:hover {
  background: var(--options-surface);
}
.introduction-button:focus-visible {
  outline: 2px solid var(--options-focus);
  outline-offset: 2px;
}
.introduction-button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
