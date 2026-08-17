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
const selectedSnapshotId = ref<string>()
const selectedUids = ref<string[]>([])
const totalBytes = ref(0)
const activeTreeEmpty = ref(true)
const loading = ref(false)
const successMessage = ref('')
const confirmation = ref<ConfirmationState>()
const groupedSnapshots = computed(() => groupSnapshotsByPeriod(snapshots.value))
const selectedMetadata = computed(() =>
  snapshots.value.find((snapshot) => snapshot.id === selectedSnapshotId.value),
)
const maxSnapshotTabs = computed(() =>
  Math.max(1, ...snapshots.value.map((snapshot) => snapshot.counts.tabs)),
)
// Built once per snapshot list rather than re-sorting inside the row loop.
const snapshotDeltas = computed(() => {
  const chronological = [...snapshots.value].sort(
    (left, right) => left.createdAt - right.createdAt,
  )
  const deltas = new Map<string, string>()
  chronological.forEach((snapshot, index) => {
    // The oldest snapshot has no predecessor. That is not "no change", so it
    // gets no delta at all rather than a misleading ±0.
    if (index === 0) {
      deltas.set(snapshot.id, '')
      return
    }
    const delta = snapshot.counts.tabs - chronological[index - 1].counts.tabs
    deltas.set(
      snapshot.id,
      delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '±0',
    )
  })
  return deltas
})
// Stating a schedule the user has not configured is worse than stating none,
// so this follows the live setting instead of the default interval.
const emptyHistoryMessage = computed(() => {
  if (!Settings.values.automaticSessionSnapshots) {
    return 'No snapshots yet. Automatic snapshots are off, so take one now.'
  }
  const unit =
    Settings.values.sessionSnapshotIntervalUnit === 'hours' ? 'hour' : 'minute'
  return `No snapshots yet. One is taken every ${pluralize(
    Settings.values.sessionSnapshotInterval,
    unit,
  )}, or take one now.`
})
// One source of truth for the restore vocabulary, so the button and the
// dialog it opens can never drift apart.
const restoreLabel = computed(() =>
  selectedUids.value.length === 0
    ? 'Restore everything'
    : `Restore ${pluralize(selectedUids.value.length, 'item')}`,
)
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
    const currentId = preferredId ?? selectedSnapshotId.value
    const nextId = snapshots.value.some((item) => item.id === currentId)
      ? currentId
      : snapshots.value[0]?.id
    if (nextId) await selectSnapshot(nextId)
    else {
      selectedSnapshotId.value = undefined
      selectedRecord.value = undefined
    }
  })
}

async function selectSnapshot(id: string) {
  selectedSnapshotId.value = id
  selectedRecord.value = undefined
  selectedUids.value = []
  const metadata = snapshots.value.find((snapshot) => snapshot.id === id)
  if (!metadata?.available) return
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
        title: restoreLabel.value,
        message: `Append ${formatCountsSentence(counts)} to the bottom of the active session tree?`,
        confirmLabel: restoreLabel.value,
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
      showSuccess(`Restored ${formatCountsSentence(counts)}.`)
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
function formatTime(value: number) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}
function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(2)} MB`
}
function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
function formatCounts(counts: SessionSnapshotCounts) {
  return [
    pluralize(counts.windows, 'window'),
    pluralize(counts.tabs, 'tab'),
    pluralize(counts.notes, 'note'),
    pluralize(counts.separators, 'separator'),
  ].join(' · ')
}
// The compact "·" form suits a list row. Prose needs commas and an "and", and
// should not name item types the snapshot does not contain.
function formatCountsSentence(counts: SessionSnapshotCounts) {
  const parts = [
    [counts.windows, 'window'],
    [counts.tabs, 'tab'],
    [counts.notes, 'note'],
    [counts.separators, 'separator'],
  ]
    .filter(([count]) => (count as number) > 0)
    .map(([count, noun]) => pluralize(count as number, noun as string))

  if (parts.length === 0) return 'nothing'
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
function triggerLabel(trigger: SessionSnapshotMetadata['trigger']) {
  return {
    periodic: 'Taken on a schedule',
    startup: 'Taken at startup',
    'before-restore': 'Taken before a restore',
    manual: 'Taken by you',
  }[trigger]
}
function snapshotBarWidth(snapshot: SessionSnapshotMetadata) {
  return `${Math.max(2, (snapshot.counts.tabs / maxSnapshotTabs.value) * 100)}%`
}
function snapshotDelta(snapshot: SessionSnapshotMetadata) {
  return snapshotDeltas.value.get(snapshot.id) ?? ''
}
function restoreSelectedSnapshot() {
  return restore(selectedUids.value.length > 0 ? 'selected' : 'all')
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
    class="content-panel-section section section-wide"
  >
    <h2 class="section-title">Storage</h2>
    <p class="section-intro">
      Snapshots capture the whole tree so you can roll back to an earlier state.
    </p>
    <div class="section-body rows">
      <ToggleButton
        label="Take snapshots automatically"
        v-model="Settings.values.automaticSessionSnapshots"
        :options="OPTIONS.boolean"
        @update="saveSettings"
      />
    </div>
    <div
      class="dependents"
      :data-disabled="!Settings.values.automaticSessionSnapshots"
      :inert="!Settings.values.automaticSessionSnapshots"
    >
      <NumberInput
        label="Snapshot every"
        v-model:value="Settings.values.sessionSnapshotInterval"
        v-model:selected-unit="Settings.values.sessionSnapshotIntervalUnit"
        :units="OPTIONS.sessionSnapshotIntervalUnit"
        :min="intervalMin"
        :max="intervalMax"
        :disabled="!Settings.values.automaticSessionSnapshots"
        @update="saveSettings"
      />
    </div>
    <div class="rows">
      <ToggleButton
        label="Protect manual snapshots"
        description="Snapshots you take yourself are never removed to make room."
        v-model="Settings.values.protectManualSessionSnapshots"
        :options="OPTIONS.boolean"
        @update="saveSettings"
      />
      <ToggleButton
        label="Include private windows"
        v-model="Settings.values.includePrivateWindowsInSessionSnapshots"
        :options="OPTIONS.boolean"
        @update="saveSettings"
      />
    </div>

    <p class="eyebrow">Snapshot history</p>
    <div class="snapshot-toolbar workspace-bar">
      <button
        type="button"
        class="btn btn-primary"
        data-testid="create-snapshot"
        :disabled="loading || activeTreeEmpty"
        :aria-describedby="
          activeTreeEmpty ? 'empty-tree-snapshot-help' : undefined
        "
        @click="createSnapshot"
      >
        Take a snapshot now
      </button>
      <span class="snapshot-toolbar-summary workspace-summary"
        >{{ snapshots.length }} snapshots · {{ formatBytes(totalBytes) }}</span
      >
      <button
        type="button"
        class="btn-quiet-danger"
        :disabled="loading || snapshots.length === 0"
        @click="clearSnapshots"
      >
        Delete all snapshots
      </button>
    </div>
    <small
      v-if="activeTreeEmpty"
      id="empty-tree-snapshot-help"
      >The active session tree is empty, so there is nothing to snapshot.</small
    >

    <div class="snapshot-browser workspace">
      <aside class="snapshot-history">
        <p
          v-if="snapshots.length === 0"
          class="snapshot-history-empty"
        >
          {{ emptyHistoryMessage }}
        </p>
        <template
          v-for="group in groupedSnapshots"
          :key="group.label"
        >
          <h3 class="snapshot-group-label">{{ group.label }}</h3>
          <button
            v-for="snapshot in group.entries"
            :key="snapshot.id"
            type="button"
            class="snapshot-entry"
            :class="{
              active: selectedSnapshotId === snapshot.id,
              unavailable: !snapshot.available,
            }"
            :aria-current="selectedSnapshotId === snapshot.id"
            :aria-label="`${formatDate(snapshot.createdAt)}, ${formatCounts(snapshot.counts)}`"
            @click="selectSnapshot(snapshot.id)"
          >
            <span class="snapshot-entry-line">
              <strong class="snapshot-entry-title">
                {{ formatTime(snapshot.createdAt) }}
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
                  />
                </svg>
              </strong>
              <span class="snapshot-tab-count"
                >{{ snapshot.counts.tabs }} <small>tabs</small></span
              >
            </span>
            <span class="snapshot-meter">
              <span class="snapshot-track">
                <span
                  class="snapshot-fill"
                  :style="{ width: snapshotBarWidth(snapshot) }"
                ></span>
              </span>
              <span class="snapshot-delta">{{ snapshotDelta(snapshot) }}</span>
            </span>
            <span
              v-if="!snapshot.available"
              class="snapshot-unavailable-tag"
              >Unavailable</span
            >
          </button>
        </template>
      </aside>
      <main class="snapshot-preview">
        <template v-if="selectedRecord">
          <header class="snapshot-detail-head">
            <h3>{{ formatDate(selectedRecord.metadata.createdAt) }}</h3>
            <p class="snapshot-detail-meta">
              {{ triggerLabel(selectedRecord.metadata.trigger) }} ·
              {{ formatBytes(selectedRecord.metadata.sizeBytes)
              }}<template v-if="selectedRecord.metadata.containsPrivateWindows">
                · includes private windows</template
              ><template v-if="selectedRecord.metadata.protected">
                · protected</template
              >
            </p>
            <div class="snapshot-stats">
              <div
                v-for="stat in [
                  ['Windows', selectedRecord.metadata.counts.windows],
                  ['Tabs', selectedRecord.metadata.counts.tabs],
                  ['Notes', selectedRecord.metadata.counts.notes],
                  ['Separators', selectedRecord.metadata.counts.separators],
                ]"
                :key="stat[0]"
                class="snapshot-stat"
              >
                <strong>{{ stat[1] }}</strong>
                <span>{{ stat[0] }}</span>
              </div>
            </div>
          </header>
          <div class="snapshot-tree-scroll">
            <SnapshotTree
              :payload="selectedRecord.payload"
              :favicon-service="Favicons"
              @selection-change="selectedUids = $event"
            />
          </div>
          <footer class="snapshot-preview-toolbar snapshot-detail-footer">
            <!-- Actions that read the snapshot's contents. -->
            <span class="snapshot-selected-actions">
              <button
                type="button"
                class="btn btn-primary"
                @click="restoreSelectedSnapshot"
              >
                {{ restoreLabel }}
              </button>
              <button
                type="button"
                class="btn"
                @click="exportSnapshot(false)"
              >
                Save as JSON
              </button>
              <button
                type="button"
                class="btn"
                @click="exportSnapshot(true)"
              >
                Copy JSON
              </button>
            </span>
            <!-- Actions that govern whether the snapshot continues to exist. -->
            <span class="snapshot-record-actions">
              <button
                type="button"
                class="btn"
                @click="toggleProtected(selectedRecord.metadata)"
              >
                {{
                  selectedRecord.metadata.protected ? 'Unprotect' : 'Protect'
                }}
              </button>
              <button
                type="button"
                class="btn-quiet-danger"
                @click="deleteSnapshot(selectedRecord.metadata)"
              >
                Delete this snapshot
              </button>
            </span>
          </footer>
        </template>
        <div
          v-else-if="selectedMetadata && !selectedMetadata.available"
          class="snapshot-detail-empty unavailable-detail"
        >
          <div>
            <h3>Snapshot unavailable</h3>
            <p>
              This snapshot's data could not be read, so it cannot be restored
              or exported. Deleting it will free
              {{ formatBytes(selectedMetadata.sizeBytes) }}.
            </p>
            <button
              type="button"
              class="btn-quiet-danger"
              @click="deleteSnapshot(selectedMetadata)"
            >
              Delete this snapshot
            </button>
          </div>
        </div>
        <div
          v-else
          class="snapshot-detail-empty"
        >
          Pick a snapshot to see what it contains.
        </div>
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
.snapshot-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
}

.snapshot-toolbar-summary {
  flex: 1;
  color: var(--options-text-muted);
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}

.snapshot-browser {
  display: grid;
  grid-template-columns: 288px minmax(0, 1fr);
  height: 528px;
  overflow: hidden;
  border: 1px solid var(--options-hairline-strong);
  border-radius: 10px;
}

.snapshot-history {
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  border-right: 1px solid var(--options-hairline-strong);
  background: var(--background-color-secondary);
}

.snapshot-history-empty {
  margin: 0;
  padding: 20px 14px;
  color: var(--options-text-muted);
  font-size: 0.8125rem;
}

.snapshot-entry {
  position: relative;
  display: block;
  box-sizing: border-box;
  width: 100%;
  padding: 9px 14px 11px;
  border: 0;
  border-bottom: 1px solid var(--options-hairline);
  background: transparent;
  color: var(--text-color-primary);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s;
}

.snapshot-entry:hover {
  background: rgba(255, 255, 255, 0.035);
}

.snapshot-entry.active {
  background: var(--options-accent-wash);
}

.snapshot-entry.active::before {
  position: absolute;
  inset-block: 0;
  left: 0;
  width: 2px;
  background: var(--button-active-background);
  content: '';
}

.snapshot-entry.unavailable {
  opacity: 0.55;
}

.snapshot-group-label {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: 9px 14px 7px;
  background: var(--background-color-secondary);
  color: var(--options-text-faint);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.085em;
  text-transform: uppercase;
}

.snapshot-entry-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.snapshot-entry-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-color-primary);
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  font-weight: 400;
}

.snapshot-protected-icon {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  color: var(--button-active-background);
}

.snapshot-tab-count {
  color: var(--header-text-color);
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}

.snapshot-tab-count small {
  color: var(--options-text-faint);
  font-size: 0.6875rem;
}

.snapshot-meter {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 7px;
}

.snapshot-track {
  flex: 1;
  height: 5px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--data-track);
}

.snapshot-fill {
  display: block;
  height: 100%;
  border-radius: 0 3px 3px 0;
  background: var(--data-bar);
}

.snapshot-entry.unavailable .snapshot-fill {
  background: var(--options-text-faint);
}

.snapshot-delta {
  min-width: 34px;
  color: var(--options-text-muted);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.snapshot-unavailable-tag {
  display: inline-block;
  margin-top: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(217, 138, 138, 0.14);
  color: #d98a8a;
  font-size: 0.6875rem;
}

.snapshot-preview {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.snapshot-detail-head {
  padding: 16px 20px 14px;
  border-bottom: 1px solid var(--options-hairline);
}

.snapshot-detail-head h3,
.unavailable-detail h3 {
  margin: 0;
  color: var(--header-text-color);
  font-size: var(--font-size-lg);
  font-weight: 600;
  letter-spacing: -0.01em;
}

.snapshot-detail-meta {
  margin: 5px 0 0;
  color: var(--options-text-muted);
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}

.snapshot-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  margin-top: 14px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--options-hairline);
}

.snapshot-stat {
  padding: 9px 12px;
  background: var(--options-surface);
}

.snapshot-stat strong {
  display: block;
  color: var(--header-text-color);
  font-family: var(--font-mono);
  font-size: 1.125rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.snapshot-stat span {
  display: block;
  margin-top: 2px;
  color: var(--options-text-faint);
  font-size: 0.6875rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.snapshot-tree-scroll {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 0 12px;
}

.snapshot-preview-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--options-hairline-strong);
  background: var(--background-color-secondary);
}

/* The cluster must be allowed to shrink and wrap. Without this it holds the
   row at its full width and pushes Delete past the workspace's
   overflow: hidden edge, where it cannot be reached at all. */
.snapshot-selected-actions {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* Restore leads; the three snapshot-level actions read as one quieter group. */
.snapshot-detail-footer .btn:not(.btn-primary) {
  border-color: var(--options-hairline);
  color: var(--options-text-muted);
}

.snapshot-detail-footer .btn:not(.btn-primary):hover {
  border-color: var(--options-hairline-strong);
  color: var(--text-color-primary);
}

/* Lifecycle actions sit apart from the content actions, right-aligned on a
   wide row without claiming an entire line once the toolbar wraps. */
.snapshot-record-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.snapshot-footer-spacer {
  display: none;
}

.snapshot-detail-empty {
  display: grid;
  flex: 1;
  place-items: center;
  padding: 24px;
  color: var(--options-text-muted);
  font-size: 0.8125rem;
  text-align: center;
}

.unavailable-detail p {
  max-width: 48ch;
  line-height: 1.5;
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

.btn-quiet-danger {
  padding: 6px 4px;
  border: 0;
  background: transparent;
  color: var(--options-text-faint);
  font-family: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}

.btn-quiet-danger:hover:not(:disabled) {
  color: #d98a8a;
}

@media (max-width: 1080px) {
  .snapshot-browser {
    grid-template-columns: 250px minmax(0, 1fr);
  }
}

@media (max-width: 900px) {
  .snapshot-browser {
    grid-template-columns: 220px minmax(0, 1fr);
  }

  .snapshot-selected-actions {
    flex-wrap: wrap;
  }
}
</style>
