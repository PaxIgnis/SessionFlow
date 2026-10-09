<script setup lang="ts">
import { i18n } from '@/services/i18n'
import { computed } from 'vue'
import type { OnboardingExampleItem } from '@/types/onboarding-demo'
import OnboardingTreePreview from './OnboardingTreePreview.vue'

const states = ['active', 'live', 'unloaded', 'saved'] as const
const labels = {
  active: 'onboardingStateActive',
  live: 'onboardingStateLive',
  unloaded: 'onboardingStateUnloaded',
  saved: 'onboardingStateSaved',
} as const
const descriptions = {
  active: 'onboardingStateActiveDescription',
  live: 'onboardingStateLiveDescription',
  unloaded: 'onboardingStateUnloadedDescription',
  saved: 'onboardingStateSavedDescription',
} as const
const items = computed<OnboardingExampleItem[]>(() => [
  {
    id: 'window',
    kind: 'window',
    title: i18n.t('onboardingExampleWindow'),
    state: 'live',
    indentLevel: 0,
  },
  ...states.map((state) => ({
    id: state,
    kind: 'tab' as const,
    title: i18n.t(labels[state]),
    state,
    indentLevel: 1,
  })),
  {
    id: 'related',
    kind: 'tab',
    title: i18n.t('onboardingExampleBranch'),
    state: 'live',
    indentLevel: 1,
    collapsed: true,
  },
  {
    id: 'related-live',
    kind: 'tab',
    title: i18n.t('onboardingExampleOtherTab'),
    state: 'live',
    indentLevel: 2,
  },
  {
    id: 'related-saved',
    kind: 'tab',
    title: i18n.t('onboardingDemoReference'),
    state: 'saved',
    indentLevel: 2,
  },
])
</script>

<template>
  <OnboardingTreePreview
    class="state-example"
    :items="items"
  />
  <dl class="tab-state-legend">
    <div
      v-for="state in states"
      :key="state"
      class="legend-entry"
    >
      <dt class="legend-tab">
        {{ i18n.t(labels[state]) }}
      </dt>
      <dd>{{ i18n.t(descriptions[state]) }}</dd>
    </div>
  </dl>
  <p class="legend-note">{{ i18n.t('onboardingStateFocusNote') }}</p>
</template>

<style scoped>
.tab-state-legend {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 10px;
  margin: 16px 0;
}
.legend-tab {
  font-size: 13px;
  font-weight: 600;
}
dd {
  margin: 5px 0 0;
  font-size: 13px;
  line-height: 1.45;
}
.legend-note {
  font-size: 13px;
  line-height: 1.45;
}
.state-example {
  border: 1px solid var(--tree-edge);
  border-radius: 8px;
  margin-top: 20px;
}
</style>
