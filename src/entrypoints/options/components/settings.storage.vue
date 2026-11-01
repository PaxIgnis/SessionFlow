<script lang="ts" setup>
import ToggleButton from '@/components/ToggleButton.vue'
import { i18n } from '@/services/i18n'
import { SessionSnapshotClient } from '@/services/session-snapshot-client'
import { Settings } from '@/services/settings'
import {
  formatBytes,
  STORAGE_USAGE_CATEGORIES,
  type StorageUsage,
  type StorageUsageCategory,
  storageUsageFromItems,
} from '@/services/storage-usage'
import { OPTIONS } from '@/types/settings'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { SNAPSHOTS_CHANGED_EVENT } from './storage-events'

// The tree is saved on almost every tab change, so re-measure once things
// settle rather than on each write.
const REMEASURE_DELAY_MS = 1_000

const CATEGORY_TEXT = {
  tree: {
    label: 'storageSessionTree',
    description: 'storageSessionTreeDescription',
  },
  snapshots: { label: 'snapshots', description: undefined },
  favicons: { label: 'storageFaviconCache', description: undefined },
  settings: { label: 'settings', description: undefined },
  other: { label: 'storageOther', description: 'storageOtherDescription' },
} as const satisfies Record<
  StorageUsageCategory,
  { label: string; description: string | undefined }
>

const usage = ref<StorageUsage>()
const failed = ref(false)
let remeasureTimer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  browser.storage.onChanged.addListener(handleStorageChanged)
  window.addEventListener(SNAPSHOTS_CHANGED_EVENT, scheduleMeasure)
  void measure()
})

onBeforeUnmount(() => {
  browser.storage.onChanged.removeListener(handleStorageChanged)
  window.removeEventListener(SNAPSHOTS_CHANGED_EVENT, scheduleMeasure)
  if (remeasureTimer) clearTimeout(remeasureTimer)
})

async function measure() {
  try {
    const [items, snapshots] = await Promise.all([
      browser.storage.local.get(null),
      SessionSnapshotClient.list(),
    ])
    usage.value = storageUsageFromItems(items, snapshots.totalBytes)
    failed.value = false
  } catch (error) {
    console.error('Failed to measure storage usage:', error)
    failed.value = true
  }
}

function handleStorageChanged(_changes: unknown, areaName: string) {
  if (areaName === 'local') scheduleMeasure()
}

function scheduleMeasure() {
  if (remeasureTimer) clearTimeout(remeasureTimer)
  remeasureTimer = setTimeout(() => {
    remeasureTimer = undefined
    void measure()
  }, REMEASURE_DELAY_MS)
}

function share(category: StorageUsageCategory) {
  const total = usage.value?.total ?? 0
  if (total === 0) return '0%'
  return `${((usage.value?.categories[category] ?? 0) / total) * 100}%`
}
</script>

<template>
  <section
    id="settings_storage"
    class="content-panel-section section"
  >
    <h2 class="section-title">{{ i18n.t('storage') }}</h2>
    <p class="section-intro">{{ i18n.t('storageIntro') }}</p>
    <div class="section-body rows">
      <ToggleButton
        :label="i18n.t('onboardingRetainTreeLabel')"
        :description="i18n.t('onboardingRetainTreeDescription')"
        v-model="Settings.values.retainPrivateWindows"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>

    <p class="eyebrow">{{ i18n.t('storageUsed') }}</p>
    <p
      v-if="failed"
      class="row-desc"
    >
      {{ i18n.t('storageUsageUnavailable') }}
    </p>
    <ul
      v-else
      class="rows storage-usage"
      data-testid="storage-usage"
    >
      <li
        v-for="category in STORAGE_USAGE_CATEGORIES"
        :key="category"
        class="row"
        :data-category="category"
      >
        <div class="row-text">
          <span class="row-label">{{
            i18n.t(CATEGORY_TEXT[category].label)
          }}</span>
          <p
            v-if="CATEGORY_TEXT[category].description"
            class="row-desc"
          >
            {{ i18n.t(CATEGORY_TEXT[category].description) }}
          </p>
        </div>
        <div class="storage-usage-amount">
          <span
            class="storage-usage-track"
            aria-hidden="true"
          >
            <span
              class="storage-usage-fill"
              :style="{ width: share(category) }"
            ></span>
          </span>
          <span class="storage-usage-bytes">{{
            usage ? formatBytes(usage.categories[category]) : '…'
          }}</span>
        </div>
      </li>
      <li class="row storage-usage-total">
        <span class="row-label">{{ i18n.t('storageTotal') }}</span>
        <span class="storage-usage-bytes">{{
          usage ? formatBytes(usage.total) : '…'
        }}</span>
      </li>
    </ul>
    <p class="storage-usage-note">{{ i18n.t('storageSizesAreEstimates') }}</p>
  </section>
</template>

<style scoped>
.storage-usage {
  margin: 0;
  padding: 0;
  list-style: none;
}

.storage-usage-amount {
  display: flex;
  align-items: center;
  gap: 12px;
}

.storage-usage-track {
  width: 120px;
  height: 5px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--data-track);
}

.storage-usage-fill {
  display: block;
  height: 100%;
  border-radius: 0 3px 3px 0;
  background: var(--data-bar);
}

.storage-usage-bytes {
  min-width: 72px;
  color: var(--header-text-color);
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.storage-usage-total .row-label {
  font-weight: 600;
}

.storage-usage-note {
  margin: 10px 0 0;
  color: var(--options-text-faint);
  font-size: 0.75rem;
}
</style>
