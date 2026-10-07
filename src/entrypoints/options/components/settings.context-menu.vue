<script lang="ts" setup>
import { i18n } from '@/services/i18n'
import DescendantScopeMatrix from './DescendantScopeMatrix.vue'
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
    </div>
  </section>
</template>
