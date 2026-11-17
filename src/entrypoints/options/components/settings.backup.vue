<script setup lang="ts">
import NumberInput from '@/components/NumberInput.vue'
import ToggleButton from '@/components/ToggleButton.vue'
import {
  normalizeAutomaticBackupState,
  sanitizeBackupFolder,
} from '@/services/automatic-backup-schedule'
import { describeAutomaticBackups } from '@/services/automatic-backup-status'
import { parseSessionFlowBackup } from '@/services/backup-codec'
import { BackupClient } from '@/services/backup-client'
import { prepareRestoredSettings } from '@/services/backup-settings'
import { Favicons } from '@/services/favicons'
import { i18n } from '@/services/i18n'
import { Settings } from '@/services/settings'
import { NUMERIC_SETTING_BOUNDS } from '@/services/settings-actions'
import {
  AUTOMATIC_BACKUP_STATE_KEY,
  type AutomaticBackupState,
  type BackgroundRestoreSection,
  type BackupPreview,
  type BackupSection,
} from '@/types/backup'
import { OPTIONS } from '@/types/settings'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BackupRestoreModal from './BackupRestoreModal.vue'
import SnapshotConfirmationModal from './SnapshotConfirmationModal.vue'
import {
  BACKUP_RESTORED_EVENT,
  SNAPSHOTS_CHANGED_EVENT,
} from './storage-events'

interface MessageState {
  kind: 'confirm' | 'error'
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  resolve?: (confirmed: boolean) => void
}

const loading = ref(false)
const restoreFileInput = ref<HTMLInputElement>()
const pendingRestore = ref<{ json: string; preview: BackupPreview }>()
const message = ref<MessageState>()
const successMessage = ref('')
const automaticState = ref<AutomaticBackupState>()
const folderDraft = ref(Settings.values.automaticBackupFolder)
let successTimer: ReturnType<typeof setTimeout> | undefined

watch(
  () => Settings.values.automaticBackupFolder,
  (folder) => {
    folderDraft.value = folder
  },
)

type StorageChanges = Record<string, { newValue?: unknown }>

// The background records each run; follow it while the page is open.
const onStorageChanged = (changes: StorageChanges, area: string) => {
  if (area !== 'local' || !(AUTOMATIC_BACKUP_STATE_KEY in changes)) return
  automaticState.value = normalizeAutomaticBackupState(
    changes[AUTOMATIC_BACKUP_STATE_KEY].newValue,
  )
}

onMounted(async () => {
  browser.storage.onChanged?.addListener(onStorageChanged)
  try {
    const stored = await browser.storage.local.get(AUTOMATIC_BACKUP_STATE_KEY)
    automaticState.value = normalizeAutomaticBackupState(
      stored[AUTOMATIC_BACKUP_STATE_KEY],
    )
  } catch (error) {
    console.error('Failed to read automatic backup state:', error)
  }
})

onBeforeUnmount(() => {
  if (successTimer) clearTimeout(successTimer)
  browser.storage.onChanged?.removeListener(onStorageChanged)
})

const automaticStatus = computed(() =>
  automaticState.value
    ? describeAutomaticBackups(automaticState.value, Settings.values)
    : [],
)

async function onAutomaticBackupsUpdate(value: string | number | boolean) {
  if (value === true) {
    // Firefox only allows permissions.request() from the click itself, so it
    // must come before any other awaited call.
    const granted = await requestDownloadsPermission()
    if (!granted) Settings.values.automaticBackups = false
  }
  await Settings.saveSettingsToStorage()
}

async function saveFolder() {
  const folder = sanitizeBackupFolder(folderDraft.value)
  folderDraft.value = folder
  if (folder === Settings.values.automaticBackupFolder) return
  Settings.values.automaticBackupFolder = folder
  await Settings.saveSettingsToStorage()
}

async function backUpToFolderNow() {
  await run(i18n.t('backupFailed'), async () => {
    const state = await BackupClient.runAutomatic()
    automaticState.value = state
    showSuccess(i18n.t('automaticBackupSaved', [state.lastFile ?? '']))
  })
}

async function backUpNow() {
  await run(i18n.t('backupFailed'), async () => {
    const backup = await BackupClient.create(
      Settings.values.backupIncludeFavicons,
    )
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup)], { type: 'application/json' }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `session-flow-backup-${fileTimestamp(backup.exportedAt)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    showSuccess(i18n.t('backupSaved'))
  })
}

async function chooseRestoreFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Reset before reading so the same file can be selected again after an error.
  input.value = ''
  if (!file) return
  await run(i18n.t('restoreFailed'), async () => {
    const json = await file.text()
    pendingRestore.value = { json, preview: await BackupClient.preview(json) }
  })
}

async function restore(sections: BackupSection[]) {
  const pending = pendingRestore.value
  pendingRestore.value = undefined
  if (!pending) return
  const backedUpSettings = sections.includes('settings')
    ? readBackedUpSettings(pending.json)
    : undefined
  // Ask while still handling the confirm click; Firefox refuses later.
  const downloadsGranted = backedUpSettings?.automaticBackups
    ? requestDownloadsPermission()
    : Promise.resolve(false)
  let faviconFetchingDisabled = false
  let automaticBackupsDisabled = false
  let sessionTreeSkipped = false
  const restored = await run(i18n.t('restoreFailed'), async () => {
    // Settings first, so the background restores snapshots under the
    // retention policy being restored with them.
    if (backedUpSettings) {
      const prepared = prepareRestoredSettings(backedUpSettings, {
        faviconFetch: await Favicons.hasFetchPermissions(),
        downloads: await downloadsGranted,
      })
      faviconFetchingDisabled = prepared.faviconFetchingDisabled
      automaticBackupsDisabled = prepared.automaticBackupsDisabled
      Object.assign(Settings.values, prepared.settings)
      await Settings.saveSettingsToStorage()
    }
    const backgroundSections = sections.filter(
      (section): section is BackgroundRestoreSection => section !== 'settings',
    )
    if (backgroundSections.length > 0) {
      sessionTreeSkipped = !(await restoreInBackground(
        pending.json,
        backgroundSections,
      ))
    }
    return true
  })
  window.dispatchEvent(new Event(BACKUP_RESTORED_EVENT))
  window.dispatchEvent(new Event(SNAPSHOTS_CHANGED_EVENT))
  // Declining to restore the tree alone leaves nothing to report.
  if (!restored || (sessionTreeSkipped && sections.length === 1)) return
  showSuccess(
    [
      sessionTreeSkipped
        ? i18n.t('backupRestoredWithoutSessionTree')
        : i18n.t('backupRestored'),
      faviconFetchingDisabled ? i18n.t('backupFaviconFetchingTurnedOff') : '',
      automaticBackupsDisabled ? i18n.t('backupAutomaticBackupsTurnedOff') : '',
    ]
      .filter(Boolean)
      .join(' '),
  )
}

/**
 * Restores the background's sections. A failed safety snapshot stops the
 * whole request before anything changes, so declining to restore the tree
 * without one still restores the other sections.
 *
 * @returns false when the user chose not to restore the session tree
 */
async function restoreInBackground(
  json: string,
  sections: BackgroundRestoreSection[],
): Promise<boolean> {
  try {
    await BackupClient.restore({
      json,
      sections,
      allowWithoutSafetySnapshot: false,
    })
    return true
  } catch (error) {
    if ((error as Error & { code?: string }).code !== 'safety-snapshot-failed')
      throw error
    const proceed = await confirmAction({
      title: i18n.t('safetySnapshotFailed'),
      message: i18n.t(
        'sessionFlowCouldNotCreateThePrerestoreSafetySnapshotRestore',
      ),
      confirmLabel: i18n.t('restoreWithoutSafetySnapshot'),
      danger: true,
    })
    if (!proceed) {
      const others = sections.filter((section) => section !== 'sessionTree')
      if (others.length > 0) {
        await BackupClient.restore({
          json,
          sections: others,
          allowWithoutSafetySnapshot: false,
        })
      }
      return false
    }
    await BackupClient.restore({
      json,
      sections,
      allowWithoutSafetySnapshot: true,
    })
    return true
  }
}

function confirmAction(
  options: Omit<MessageState, 'kind' | 'resolve'>,
): Promise<boolean> {
  return new Promise((resolve) => {
    message.value = { kind: 'confirm', ...options, resolve }
  })
}

function finishMessage(confirmed: boolean) {
  const current = message.value
  message.value = undefined
  current?.resolve?.(confirmed)
}

function showSuccess(text: string): void {
  if (successTimer) clearTimeout(successTimer)
  successMessage.value = text
  successTimer = setTimeout(() => {
    successMessage.value = ''
    successTimer = undefined
  }, 5_000)
}

async function run<T>(
  errorTitle: string,
  operation: () => Promise<T>,
): Promise<T | undefined> {
  loading.value = true
  try {
    return await operation()
  } catch (error) {
    message.value = {
      kind: 'error',
      title: errorTitle,
      message: error instanceof Error ? error.message : String(error),
    }
    return undefined
  } finally {
    loading.value = false
  }
}

function readBackedUpSettings(json: string) {
  try {
    return parseSessionFlowBackup(json).backup.sections.settings
  } catch {
    // Unreachable in practice: the preview already read this same file.
    return undefined
  }
}

function requestDownloadsPermission(): Promise<boolean> {
  return browser.permissions
    .request({ permissions: ['downloads'] })
    .catch(() => false)
}

function fileTimestamp(value: number) {
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}
</script>

<template>
  <section
    id="settings_backup"
    class="content-panel-section section"
  >
    <h2 class="section-title">{{ i18n.t('backupAndRestore') }}</h2>
    <p class="section-intro">{{ i18n.t('backupIntro') }}</p>
    <div class="section-body rows">
      <ToggleButton
        :label="i18n.t('includeFaviconCacheInBackups')"
        :description="i18n.t('includeFaviconCacheInBackupsDescription')"
        v-model="Settings.values.backupIncludeFavicons"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
    <div class="backup-actions">
      <button
        type="button"
        class="btn btn-primary"
        data-testid="backup-now"
        :disabled="loading"
        @click="backUpNow"
      >
        {{ i18n.t('backupNow') }}
      </button>
      <button
        type="button"
        class="btn"
        data-testid="restore-backup"
        :disabled="loading"
        @click="restoreFileInput?.click()"
      >
        {{ i18n.t('restoreFromBackup') }}
      </button>
      <input
        ref="restoreFileInput"
        type="file"
        accept=".json,application/json"
        :aria-label="i18n.t('restoreFromBackup')"
        data-testid="restore-backup-file"
        hidden
        @change="chooseRestoreFile"
      />
    </div>
    <div class="rows automatic-backups">
      <ToggleButton
        :label="i18n.t('automaticBackups')"
        :description="i18n.t('automaticBackupsDescription')"
        v-model="Settings.values.automaticBackups"
        :options="OPTIONS.boolean"
        @update="onAutomaticBackupsUpdate"
      />
    </div>
    <div
      class="dependents"
      data-testid="automatic-backup-settings"
      :data-disabled="!Settings.values.automaticBackups"
      :inert="!Settings.values.automaticBackups"
    >
      <NumberInput
        id="automaticBackupInterval"
        :label="i18n.t('automaticBackupEvery')"
        v-model:value="Settings.values.automaticBackupInterval"
        v-model:selected-unit="Settings.values.automaticBackupIntervalUnit"
        :units="OPTIONS.automaticBackupIntervalUnit"
        :min="NUMERIC_SETTING_BOUNDS.automaticBackupInterval?.min"
        :max="NUMERIC_SETTING_BOUNDS.automaticBackupInterval?.max"
        :disabled="!Settings.values.automaticBackups"
        @update="Settings.saveSettingsToStorage()"
      />
      <div class="row">
        <div class="row-text">
          <label
            class="row-label"
            for="automaticBackupFolder"
            >{{ i18n.t('automaticBackupFolder') }}</label
          >
          <p class="row-desc">
            {{ i18n.t('automaticBackupFolderDescription') }}
          </p>
        </div>
        <input
          id="automaticBackupFolder"
          v-model="folderDraft"
          type="text"
          class="folder-input"
          spellcheck="false"
          data-testid="automatic-backup-folder"
          :disabled="!Settings.values.automaticBackups"
          @change="saveFolder"
        />
      </div>
      <NumberInput
        id="automaticBackupKeepCount"
        :label="i18n.t('automaticBackupKeepCount')"
        :description="i18n.t('automaticBackupKeepCountDescription')"
        v-model:value="Settings.values.automaticBackupKeepCount"
        :min="NUMERIC_SETTING_BOUNDS.automaticBackupKeepCount?.min"
        :max="NUMERIC_SETTING_BOUNDS.automaticBackupKeepCount?.max"
        :disabled="!Settings.values.automaticBackups"
        @update="Settings.saveSettingsToStorage()"
      />
      <div
        class="automatic-backup-status"
        data-testid="automatic-backup-status"
      >
        <div class="status-lines">
          <p
            v-for="line in automaticStatus"
            :key="line"
            class="row-desc"
          >
            {{ line }}
          </p>
        </div>
        <button
          type="button"
          class="btn"
          data-testid="automatic-backup-now"
          :disabled="loading || !Settings.values.automaticBackups"
          @click="backUpToFolderNow"
        >
          {{ i18n.t('automaticBackupNow') }}
        </button>
      </div>
    </div>
    <div
      v-if="successMessage"
      class="backup-success-toast"
      role="status"
      aria-live="polite"
    >
      {{ successMessage }}
    </div>
    <BackupRestoreModal
      v-if="pendingRestore"
      :preview="pendingRestore.preview"
      @confirm="restore"
      @cancel="pendingRestore = undefined"
    />
    <SnapshotConfirmationModal
      v-if="message"
      :kind="message.kind"
      :title="message.title"
      :message="message.message"
      :confirm-label="message.confirmLabel"
      :danger="message.danger"
      @confirm="finishMessage(true)"
      @cancel="finishMessage(false)"
    />
  </section>
</template>

<style scoped>
.automatic-backups {
  margin-top: 24px;
}

.folder-input {
  box-sizing: border-box;
  width: min(240px, 100%);
  padding: 5px 9px;
  border: 1px solid var(--options-hairline-strong);
  border-radius: 7px;
  background: transparent;
  color: var(--text-color-primary);
  font-family: inherit;
  font-size: 0.8125rem;
}

.folder-input:focus {
  outline: 2px solid var(--options-focus);
  outline-offset: -1px;
}

.automatic-backup-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
}

.status-lines .row-desc {
  margin: 0;
}

.status-lines .row-desc + .row-desc {
  margin-top: 4px;
}

.backup-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.backup-success-toast {
  position: fixed;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1100;
  max-width: min(420px, calc(100vw - 36px));
  padding: 10px 14px;
  border: 1px solid rgb(87, 155, 102);
  border-radius: 6px;
  background: rgb(36, 75, 45);
  color: rgb(214, 245, 221);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  font-size: 0.8125rem;
}

.btn {
  cursor: pointer;
  padding: 6px 13px;
  border: 1px solid var(--options-hairline-strong);
  border-radius: 7px;
  background: transparent;
  color: var(--text-color-primary);
  font-family: inherit;
  font-size: 0.8125rem;
}

.btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: var(--header-text-color);
}

.btn-primary {
  border-color: transparent;
  background: var(--button-active-background);
  color: var(--button-active-foreground);
  font-weight: 500;
}

.btn-primary:hover:not(:disabled) {
  background: var(--button-active-background-hover);
  color: var(--button-active-foreground);
}
</style>
