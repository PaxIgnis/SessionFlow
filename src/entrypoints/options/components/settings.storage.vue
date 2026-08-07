<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import NumberInput from '@/components/NumberInput.vue'
import ToggleButton from '@/components/ToggleButton.vue'
import { Favicons } from '@/services/favicons'
import { SessionSnapshotClient } from '@/services/session-snapshot-client'
import { Settings } from '@/services/settings'
import type {
  SessionSnapshotCounts,
  SessionSnapshotMetadata,
  SessionSnapshotRecord,
  SessionSnapshotRestoreMode,
} from '@/types/session-snapshots'
import { OPTIONS } from '@/types/settings'
import SnapshotTree from './SnapshotTree.vue'
import SnapshotConfirmationModal from './SnapshotConfirmationModal.vue'

interface ConfirmationState {
  kind: 'confirm' | 'error'
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  resolve?: (confirmed: boolean) => void
}

const snapshots = ref<SessionSnapshotMetadata[]>([])
const selectedRecord = ref<SessionSnapshotRecord>()
const selectedUids = ref<string[]>([])
const totalBytes = ref(0)
const activeTreeEmpty = ref(true)
const loading = ref(false)
const successMessage = ref('')
const confirmation = ref<ConfirmationState>()
const groupedSnapshots = computed(() => groupSnapshotsByPeriod(snapshots.value))
let successTimer: ReturnType<typeof setTimeout> | undefined

const intervalMin = computed(() =>
  Settings.values.sessionSnapshotIntervalUnit === 'hours' ? 1 : 5,
)
const intervalMax = computed(() =>
  Settings.values.sessionSnapshotIntervalUnit === 'hours' ? 24 : 1440,
)

onMounted(async () => {
  await Favicons.init()
  await refresh()
})

onBeforeUnmount(() => {
  if (successTimer) clearTimeout(successTimer)
})

async function refresh(preferredId?: string) {
  await run(async () => {
    const result = await SessionSnapshotClient.list()
    snapshots.value = result.snapshots
    totalBytes.value = result.totalBytes
    activeTreeEmpty.value = result.activeTreeEmpty
    const nextId =
      preferredId && snapshots.value.some((item) => item.id === preferredId)
        ? preferredId
        : snapshots.value.find((item) => item.available)?.id
    if (nextId) await selectSnapshot(nextId)
    else selectedRecord.value = undefined
  })
}

async function selectSnapshot(id: string) {
  selectedRecord.value = undefined
  selectedUids.value = []
  const metadata = snapshots.value.find((snapshot) => snapshot.id === id)
  if (!metadata?.available) {
    showError(
      'Snapshot Unavailable',
      'This snapshot payload is unavailable and cannot be opened.',
    )
    return
  }
  await run(async () => {
    try {
      selectedRecord.value = await SessionSnapshotClient.get(id)
    } catch (error) {
      const current = snapshots.value.find((snapshot) => snapshot.id === id)
      if (current) current.available = false
      throw error
    }
  })
}

async function saveSettings() {
  await run(() => Settings.saveSettingsToStorage())
}

async function createSnapshot() {
  await run(async () => {
    const created = await SessionSnapshotClient.create()
    if (!created) {
      showError('Snapshot Not Created', 'The active session tree is empty.')
      return
    }
    await refresh(created?.id)
    showSuccess('Snapshot created.')
  })
}

async function toggleProtected(snapshot: SessionSnapshotMetadata) {
  await run(async () => {
    await SessionSnapshotClient.setProtected(snapshot.id, !snapshot.protected)
    await refresh(snapshot.id)
    showSuccess(
      snapshot.protected ? 'Snapshot unprotected.' : 'Snapshot protected.',
    )
  })
}

async function deleteSnapshot(snapshot: SessionSnapshotMetadata) {
  if (
    !(await confirmAction({
      title: 'Delete Snapshot',
      message: `Delete snapshot from ${formatDate(snapshot.createdAt)}?`,
      confirmLabel: 'Delete',
      danger: true,
    }))
  )
    return
  await run(async () => {
    await SessionSnapshotClient.delete(snapshot.id)
    await refresh()
    showSuccess('Snapshot deleted.')
  })
}

async function clearSnapshots() {
  if (
    !(await confirmAction({
      title: 'Delete All Snapshots',
      message: 'Delete all snapshots, including protected snapshots?',
      confirmLabel: 'Delete All',
      danger: true,
    }))
  )
    return
  await run(async () => {
    await SessionSnapshotClient.clear()
    await refresh()
    showSuccess('All snapshots deleted.')
  })
}

async function exportSnapshot(copy: boolean) {
  const id = selectedRecord.value?.metadata.id
  if (!id) return
  await run(async () => {
    const exported = await SessionSnapshotClient.export(id)
    const json = JSON.stringify(exported, null, 2)
    if (copy) {
      await navigator.clipboard.writeText(json)
      showSuccess('Snapshot JSON copied.')
      return
    }
    const url = URL.createObjectURL(
      new Blob([json], { type: 'application/json' }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `session-flow-snapshot-${fileTimestamp(exported.metadata.createdAt)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    showSuccess('Snapshot JSON exported.')
  })
}

async function restore(
  mode: SessionSnapshotRestoreMode,
  allowWithoutSafetySnapshot = false,
) {
  const record = selectedRecord.value
  if (!record) return
  if (mode === 'selected' && selectedUids.value.length === 0) return
  if (!allowWithoutSafetySnapshot) {
    const counts = await run(() =>
      SessionSnapshotClient.restoreSummary({
        snapshotId: record.metadata.id,
        mode,
        selectedUids: mode === 'selected' ? [...selectedUids.value] : [],
      }),
    )
    if (!counts) return
    if (
      !(await confirmAction({
        title:
          mode === 'all' ? 'Restore Entire Snapshot' : 'Restore Selected Items',
        message: `Append ${counts.windows} windows, ${counts.tabs} tabs, ${counts.notes} notes, and ${counts.separators} separators to the bottom of the active session tree?`,
        confirmLabel:
          mode === 'all' ? 'Restore Entire Snapshot' : 'Restore Selected Items',
      }))
    )
      return
  }
  await run(async () => {
    try {
      const counts = await SessionSnapshotClient.restore({
        snapshotId: record.metadata.id,
        mode,
        selectedUids: mode === 'selected' ? [...selectedUids.value] : [],
        allowWithoutSafetySnapshot,
      })
      await refresh(record.metadata.id)
      showSuccess(
        `Restored ${counts.windows} windows, ${counts.tabs} tabs, ${counts.notes} notes, and ${counts.separators} separators.`,
      )
    } catch (error) {
      if (
        (error as Error & { code?: string }).code === 'safety-snapshot-failed'
      ) {
        const proceed = await confirmAction({
          title: 'Safety Snapshot Failed',
          message:
            'Session Flow could not create the pre-restore safety snapshot. Restore without it?',
          confirmLabel: 'Restore Without Safety Snapshot',
          danger: true,
        })
        if (proceed) await restore(mode, true)
        return
      }
      throw error
    }
  })
}

function confirmAction(
  options: Omit<ConfirmationState, 'kind' | 'resolve'>,
): Promise<boolean> {
  return new Promise((resolve) => {
    confirmation.value = { kind: 'confirm', ...options, resolve }
  })
}

function finishConfirmation(confirmed: boolean) {
  const current = confirmation.value
  confirmation.value = undefined
  current?.resolve?.(confirmed)
}

function showSuccess(message: string): void {
  if (successTimer) clearTimeout(successTimer)
  successMessage.value = message
  successTimer = setTimeout(() => {
    successMessage.value = ''
    successTimer = undefined
  }, 3_000)
}

function showError(title: string, message: string): void {
  confirmation.value = { kind: 'error', title, message }
}

async function run<T>(operation: () => Promise<T>): Promise<T | undefined> {
  loading.value = true
  try {
    return await operation()
  } catch (error) {
    showError(
      'Snapshot Operation Failed',
      error instanceof Error ? error.message : String(error),
    )
    return undefined
  } finally {
    loading.value = false
  }
}

function formatDate(value: number) {
  return new Date(value).toLocaleString()
}
function formatBytes(value: number) {
  return value < 1024 ? `${value} B` : `${(value / 1024 / 1024).toFixed(2)} MB`
}
function formatCounts(counts: SessionSnapshotCounts) {
  return `${counts.windows} windows · ${counts.tabs} tabs · ${counts.notes} notes · ${counts.separators} separators`
}
function groupSnapshotsByPeriod(items: SessionSnapshotMetadata[]) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const groups = new Map<string, SessionSnapshotMetadata[]>()
  for (const snapshot of items) {
    const date = new Date(snapshot.createdAt)
    const day = new Date(date)
    day.setHours(0, 0, 0, 0)
    const daysAgo = Math.round((today.getTime() - day.getTime()) / 86_400_000)
    const label =
      daysAgo === 0
        ? 'Today'
        : daysAgo === 1
          ? 'Yesterday'
          : daysAgo < 7
            ? 'Previous 7 Days'
            : date.toLocaleDateString(undefined, {
                month: 'long',
                year: 'numeric',
              })
    const group = groups.get(label) ?? []
    group.push(snapshot)
    groups.set(label, group)
  }
  return [...groups].map(([label, entries]) => ({ label, entries }))
}
function fileTimestamp(value: number) {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <section
    id="settings_storage"
    class="content-panel-section"
  >
    <h2>Storage</h2>
    <ToggleButton
      label="Automatic Session Snapshots"
      v-model="Settings.values.automaticSessionSnapshots"
      :options="OPTIONS.boolean"
      @update="saveSettings"
    />
    <NumberInput
      class="child-setting"
      label="Create a Snapshot Every"
      v-model:value="Settings.values.sessionSnapshotInterval"
      v-model:selected-unit="Settings.values.sessionSnapshotIntervalUnit"
      :units="OPTIONS.sessionSnapshotIntervalUnit"
      :min="intervalMin"
      :max="intervalMax"
      :disabled="!Settings.values.automaticSessionSnapshots"
      @update="saveSettings"
    />
    <ToggleButton
      label="Protect Manually Created Snapshots"
      v-model="Settings.values.protectManualSessionSnapshots"
      :options="OPTIONS.boolean"
      @update="saveSettings"
    />
    <ToggleButton
      label="Include Private Windows in Snapshots"
      v-model="Settings.values.includePrivateWindowsInSessionSnapshots"
      :options="OPTIONS.boolean"
      @update="saveSettings"
    />

    <div class="snapshot-toolbar">
      <button
        type="button"
        data-testid="create-snapshot"
        :disabled="loading || activeTreeEmpty"
        :aria-describedby="
          activeTreeEmpty ? 'empty-tree-snapshot-help' : undefined
        "
        @click="createSnapshot"
      >
        Create Snapshot Now
      </button>
      <span class="snapshot-toolbar-summary"
        >{{ snapshots.length }} snapshots · {{ formatBytes(totalBytes) }}</span
      >
      <button
        type="button"
        :disabled="loading || snapshots.length === 0"
        @click="clearSnapshots"
      >
        Delete All Snapshots
      </button>
    </div>
    <small
      v-if="activeTreeEmpty"
      id="empty-tree-snapshot-help"
      >The active session tree is empty, so there is nothing to snapshot.</small
    >

    <div class="snapshot-browser">
      <aside class="snapshot-history">
        <p
          v-if="snapshots.length === 0"
          class="snapshot-history-empty"
        >
          Zero saved snapshots
        </p>
        <template
          v-for="group in groupedSnapshots"
          :key="group.label"
        >
          <h3 class="snapshot-group-label">{{ group.label }}</h3>
          <div
            v-for="snapshot in group.entries"
            :key="snapshot.id"
            role="button"
            tabindex="0"
            class="snapshot-entry"
            :class="{
              active: selectedRecord?.metadata.id === snapshot.id,
              unavailable: !snapshot.available,
            }"
            @click="selectSnapshot(snapshot.id)"
            @keydown.enter="selectSnapshot(snapshot.id)"
          >
            <span
              ><strong class="snapshot-entry-title"
                >{{ formatDate(snapshot.createdAt) }}
                <svg
                  v-if="snapshot.protected"
                  class="snapshot-protected-icon"
                  viewBox="0 0 16 16"
                  role="img"
                  aria-label="Protected snapshot"
                >
                  <title>Protected snapshot</title>
                  <rect
                    x="3"
                    y="7"
                    width="10"
                    height="7"
                    rx="1"
                    fill="currentColor"
                  />
                  <path
                    d="M5 7V5a3 3 0 0 1 6 0v2"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                  /></svg></strong
              ><small
                >{{ snapshot.trigger }} ·
                {{ formatBytes(snapshot.sizeBytes) }}</small
              ><small>{{ formatCounts(snapshot.counts) }}</small
              ><small v-if="!snapshot.available">Unavailable</small></span
            >
            <button
              v-if="!snapshot.available"
              type="button"
              class="snapshot-entry-delete danger-action"
              :aria-label="`Delete unavailable snapshot from ${formatDate(snapshot.createdAt)}`"
              @click.stop="deleteSnapshot(snapshot)"
              @keydown.enter.stop
            >
              Delete
            </button>
          </div>
        </template>
      </aside>
      <main class="snapshot-preview">
        <template v-if="selectedRecord">
          <div class="snapshot-preview-toolbar">
            <span class="snapshot-selected-actions">
              <button
                type="button"
                @click="toggleProtected(selectedRecord.metadata)"
              >
                {{
                  selectedRecord.metadata.protected ? 'Unprotect' : 'Protect'
                }}
              </button>
              <button
                type="button"
                class="danger-action"
                @click="deleteSnapshot(selectedRecord.metadata)"
              >
                Delete
              </button>
              <button
                type="button"
                @click="exportSnapshot(false)"
              >
                Export JSON
              </button>
              <button
                type="button"
                @click="exportSnapshot(true)"
              >
                Copy JSON
              </button>
            </span>
            <span class="snapshot-restore-actions">
              <button
                type="button"
                :disabled="selectedUids.length === 0"
                @click="restore('selected')"
              >
                Restore Selected Items
              </button>
              <button
                type="button"
                @click="restore('all')"
              >
                Restore Entire Snapshot
              </button>
            </span>
          </div>
          <SnapshotTree
            :payload="selectedRecord.payload"
            :favicon-service="Favicons"
            @selection-change="selectedUids = $event"
          />
        </template>
      </main>
    </div>
    <div
      v-if="successMessage"
      class="snapshot-success-toast"
      role="status"
      aria-live="polite"
    >
      {{ successMessage }}
    </div>
    <SnapshotConfirmationModal
      v-if="confirmation"
      :kind="confirmation.kind"
      :title="confirmation.title"
      :message="confirmation.message"
      :confirm-label="confirmation.confirmLabel"
      :danger="confirmation.danger"
      @confirm="finishConfirmation(true)"
      @cancel="finishConfirmation(false)"
    />
  </section>
</template>

<style scoped>
.snapshot-toolbar,
.snapshot-preview-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 16px 0;
}
.snapshot-toolbar-summary {
  flex: 1;
  color: var(--text-color-primary);
}
.snapshot-preview-toolbar {
  justify-content: space-between;
  flex-wrap: wrap;
  flex: 0 0 auto;
}
.snapshot-selected-actions,
.snapshot-restore-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.snapshot-browser {
  display: grid;
  grid-template-columns: minmax(220px, 35%) minmax(360px, 1fr);
  height: 540px;
  border: 1px solid var(--options-list-divider-color);
  border-radius: 6px;
  overflow: hidden;
}
.snapshot-history {
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  border-right: 1px solid var(--options-list-divider-color);
  height: 540px;
}
.snapshot-history-empty {
  margin: 0;
  padding: 10px;
  color: var(--text-color-primary);
}
.snapshot-entry {
  box-sizing: border-box;
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 10px;
  border: 0;
  border-bottom: 1px solid var(--options-list-divider-color);
  background: transparent;
  color: var(--text-color-primary);
  text-align: left;
}
.snapshot-entry:hover {
  background: var(--nav-panel-hover-color);
}
.snapshot-entry.active {
  background: var(--nav-panel-focused-active-background);
}
.snapshot-entry.unavailable {
  opacity: 0.65;
}
.snapshot-entry-delete {
  align-self: center;
  flex: 0 0 auto;
}
.snapshot-group-label {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: 6px 10px;
  background: var(--background-color-primary);
  color: var(--header-text-color);
  font-size: 0.8rem;
}
.snapshot-entry-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.snapshot-protected-icon {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  color: var(--button-active-background);
}
.snapshot-entry span:first-child {
  display: flex;
  flex-direction: column;
}
.snapshot-entry small {
  opacity: 0.7;
  color: var(--text-color-primary);
}
.snapshot-preview {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 12px;
}
.snapshot-success-toast {
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
  font-size: var(--font-size-sm);
}
button {
  cursor: pointer;
  border: 1px solid var(--options-input-border-color);
  border-radius: 4px;
  padding: 5px 9px;
  background: var(--background-color-secondary);
  color: var(--text-color-primary);
}
button:hover:not(:disabled) {
  border-color: var(--options-input-border-color-hover);
  background: var(--nav-panel-hover-color);
}
button:disabled {
  cursor: default;
  opacity: 0.5;
}
.danger-action {
  color: rgb(235, 160, 160);
}
</style>
