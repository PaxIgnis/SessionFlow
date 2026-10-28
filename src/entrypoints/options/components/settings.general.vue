<script lang="ts" setup>
import { i18n } from '@/services/i18n'
import ToggleButton from '@/components/ToggleButton.vue'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'
import {
  openIntroduction,
  openSessionTreeInTab,
} from '@/services/onboarding-client'
import { ref } from 'vue'

const introductionError = ref('')
const openingIntroduction = ref(false)
async function showIntroduction(startAt: 'welcome' | 'tips' = 'welcome') {
  if (openingIntroduction.value) return
  openingIntroduction.value = true
  introductionError.value = ''
  try {
    await openIntroduction(true, startAt)
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
      <div class="introduction-actions">
        <button
          type="button"
          class="introduction-button"
          :disabled="openingIntroduction"
          :title="i18n.t('onboardingGuideLabel')"
          @click="showIntroduction()"
        >
          {{ i18n.t('onboardingReplay') }}
        </button>
        <button
          type="button"
          class="introduction-button"
          :disabled="openingIntroduction"
          @click="showIntroduction('tips')"
        >
          {{ i18n.t('onboardingShowTips') }}
        </button>
      </div>
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
        :label="i18n.t('hideTheSessionTreeWindowFromTheTree')"
        :description="i18n.t('hideTheSessionTreeWindowFromTheTreeDescription')"
        v-model="Settings.values.sessionTreeWindowDetection"
        :options="OPTIONS.sessionTreeWindowDetection"
        @update="Settings.saveSettingsToStorage()"
      />
      <div class="row">
        <div class="row-text">
          <span class="row-label">{{
            i18n.t('openTheSessionTreeInATab')
          }}</span>
          <p class="row-desc">
            {{ i18n.t('openTheSessionTreeInATabDescription') }}
          </p>
        </div>
        <button
          type="button"
          class="introduction-button"
          @click="openSessionTreeInTab()"
        >
          {{ i18n.t('openInTab') }}
        </button>
      </div>
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
.introduction-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-inline-start: auto;
}
.introduction-button {
  flex: 0 0 auto;
  max-width: 100%;
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
