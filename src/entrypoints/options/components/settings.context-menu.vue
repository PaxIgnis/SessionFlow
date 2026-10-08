<script lang="ts" setup>
import { i18n } from '@/services/i18n'
import DescendantScopeMatrix from './DescendantScopeMatrix.vue'
import ToggleButton from '@/components/ToggleButton.vue'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'
</script>

<template>
  <section
    id="settings_context_menu"
    class="content-panel-section section"
  >
    <h2 class="section-title">{{ i18n.t('contextMenu') }}</h2>
    <p class="section-intro">
      {{ i18n.t('rightclickActionsApplyToTheItemsYouSelectedTheseSettings') }}
    </p>
    <div class="section-body">
      <DescendantScopeMatrix />
      <ToggleButton
        :label="i18n.t('stateOfDuplicatedItems')"
        :description="
          i18n.t('aDuplicateCanStartSavedOrInheritWhetherTheOriginal')
        "
        v-model="Settings.values.duplicatedItemState"
        :options="OPTIONS.duplicatedItemState"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
  </section>
</template>
