<script setup lang="ts">
import {
  formatList,
  formatNumber,
  getDisplayLocale,
  i18n,
} from '@/services/i18n'
import type { BackupPreview, BackupSection } from '@/types/backup'
import type { SessionSnapshotCounts } from '@/types/session-snapshots'
import { computed, reactive } from 'vue'

const props = defineProps<{
  preview: BackupPreview
}>()

const emit = defineEmits<{
  confirm: [sections: BackupSection[]]
  cancel: []
}>()

const SECTION_LABELS = {
  sessionTree: 'backupSectionSessionTree',
  snapshots: 'backupSectionSnapshots',
  settings: 'backupSectionSettings',
  favicons: 'backupSectionFavicons',
} as const satisfies Record<BackupSection, string>

interface SectionOption {
  section: BackupSection
  label: string
  detail: string
}

const options = computed<SectionOption[]>(() => {
  const preview = props.preview
  const result: SectionOption[] = []
  if (preview.sessionTree) {
    result.push({
      section: 'sessionTree',
      label: i18n.t(SECTION_LABELS.sessionTree),
      detail: i18n.t('backupSessionTreeDetail', [
        formatCountsSentence(preview.sessionTree.counts),
      ]),
    })
  }
  if (preview.snapshots) {
    result.push({
      section: 'snapshots',
      label: i18n.t(SECTION_LABELS.snapshots),
      detail: i18n.t('backupSnapshotsDetail', preview.snapshots.total, [
        formatNumber(preview.snapshots.total),
        formatNumber(preview.snapshots.new),
      ]),
    })
  }
  if (preview.settings) {
    result.push({
      section: 'settings',
      label: i18n.t(SECTION_LABELS.settings),
      detail:
        preview.settings.invalidKeys > 0
          ? i18n.t(
              'backupSettingsInvalidDetail',
              preview.settings.invalidKeys,
              [formatNumber(preview.settings.invalidKeys)],
            )
          : i18n.t('backupSettingsDetail'),
    })
  }
  if (preview.favicons) {
    result.push({
      section: 'favicons',
      label: i18n.t(SECTION_LABELS.favicons),
      detail: i18n.t('backupFaviconsDetail', preview.favicons.count, [
        formatNumber(preview.favicons.count),
      ]),
    })
  }
  return result
})

// Everything starts selected except an empty snapshot history, which would
// do nothing.
const selected = reactive<Record<BackupSection, boolean>>({
  sessionTree: Boolean(props.preview.sessionTree),
  snapshots: (props.preview.snapshots?.new ?? 0) > 0,
  settings: Boolean(props.preview.settings),
  favicons: (props.preview.favicons?.count ?? 0) > 0,
})

const chosen = computed(() =>
  options.value
    .map((option) => option.section)
    .filter((section) => selected[section]),
)

const unreadable = computed(() =>
  props.preview.invalidSections.length === 0
    ? ''
    : i18n.t('backupSectionsUnreadable', [
        formatList(
          props.preview.invalidSections.map((section) =>
            i18n.t(SECTION_LABELS[section]),
          ),
        ),
      ]),
)

const madeAt = computed(() => {
  const date = new Date(props.preview.exportedAt).toLocaleString(
    getDisplayLocale(),
  )
  return props.preview.extensionVersion
    ? i18n.t('backupMadeAtWithVersion', [date, props.preview.extensionVersion])
    : i18n.t('backupMadeAt', [date])
})

type CountKey = 'countWindow' | 'countTab' | 'countNote' | 'countSeparator'

function pluralize(count: number, key: CountKey) {
  return i18n.t(key, count, [formatNumber(count)])
}

function formatCountsSentence(counts: SessionSnapshotCounts) {
  const parts = (
    [
      [counts.windows, 'countWindow'],
      [counts.tabs, 'countTab'],
      [counts.notes, 'countNote'],
      [counts.separators, 'countSeparator'],
    ] as const
  )
    .filter(([count]) => count > 0)
    .map(([count, key]) => pluralize(count, key))
  if (parts.length === 0) return i18n.t('nothing')
  return parts.length === 1 ? parts[0] : formatList(parts)
}
</script>

<template>
  <div
    class="modal-backdrop"
    role="presentation"
    @click.self="emit('cancel')"
  >
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      :aria-label="i18n.t('restoreBackupTitle')"
      data-testid="backup-restore-dialog"
    >
      <h3>{{ i18n.t('restoreBackupTitle') }}</h3>
      <p class="backup-made-at">{{ madeAt }}</p>
      <p v-if="options.length === 0">
        {{ i18n.t('backupNothingToRestore') }}
      </p>
      <template v-else>
        <p>{{ i18n.t('chooseWhatToRestore') }}</p>
        <ul class="backup-sections">
          <li
            v-for="option in options"
            :key="option.section"
          >
            <label class="backup-section">
              <input
                v-model="selected[option.section]"
                type="checkbox"
                :data-testid="`backup-section-${option.section}`"
              />
              <span>
                <strong>{{ option.label }}</strong>
                <small>{{ option.detail }}</small>
              </span>
            </label>
          </li>
        </ul>
      </template>
      <p
        v-if="unreadable"
        class="backup-warning"
      >
        {{ unreadable }}
      </p>
      <p
        v-if="preview.skippedSnapshots > 0"
        class="backup-warning"
      >
        {{
          i18n.t('backupSnapshotsUnreadable', preview.skippedSnapshots, [
            formatNumber(preview.skippedSnapshots),
          ])
        }}
      </p>
      <div class="modal-actions">
        <button
          type="button"
          @click="emit('cancel')"
        >
          {{ i18n.t('cancel') }}
        </button>
        <button
          v-if="options.length > 0"
          type="button"
          data-testid="confirm-backup-restore"
          :disabled="chosen.length === 0"
          @click="emit('confirm', chosen)"
        >
          {{ i18n.t('restoreSelectedParts') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}
.modal {
  width: min(520px, calc(100vw - 40px));
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 20px;
  border: 1px solid var(--options-list-divider-color);
  border-radius: 8px;
  background: var(--background-color-secondary);
  color: var(--text-color-primary);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
.backup-made-at {
  margin-top: -4px;
  color: var(--options-text-muted);
  font-size: 0.8125rem;
}
.backup-sections {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}
.backup-section {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--options-hairline);
  cursor: pointer;
}
.backup-section input {
  margin-top: 3px;
}
.backup-section span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.backup-section small {
  color: var(--options-text-muted);
  font-size: 0.8125rem;
  line-height: 1.5;
}
.backup-warning {
  color: #d98a8a;
  font-size: 0.8125rem;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
</style>
