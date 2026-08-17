<script lang="ts" setup>
import { STRINGS } from '@/types/strings'
import DescendantScopeMatrix from './DescendantScopeMatrix.vue'
</script>

<template>
  <section
    id="settings_context_menu"
    class="content-panel-section section"
  >
    <h2 class="section-title">{{ STRINGS.settings_context_menu }}</h2>
    <p class="section-intro">
      Right-click actions apply to the items you selected. These settings decide
      when an action also reaches children you did not select.
    </p>
    <div class="section-body">
      <DescendantScopeMatrix />
    </div>
  </section>
</template>
