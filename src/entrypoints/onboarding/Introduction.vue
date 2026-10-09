<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { i18n } from '@/services/i18n'
import {
  completeIntroduction,
  saveOnboardingRetention,
  saveOnboardingStartup,
} from '@/services/onboarding-client'
import { Settings } from '@/services/settings'
import { isPrivateWindowAccessAllowed } from '@/services/utils'
import TabStateLegend from '@/components/TabStateLegend.vue'
import OnboardingTreeDemo from '@/components/OnboardingTreeDemo.vue'
import OnboardingTreePreview from '@/components/OnboardingTreePreview.vue'
import { ONBOARDING_FEATURES } from '@/defaults/onboarding'
import type { OnboardingExampleItem } from '@/types/onboarding-demo'
import {
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_VERSION,
  PRIVATE_ACCESS_RESUME_TTL_MS,
  type OnboardingCompletionCommand,
  type OnboardingRecord,
} from '@/types/onboarding'

const step = ref(0)
const tip = ref(0)
const openOnStartup = ref(false)
const destination = ref<'continue' | 'import'>('continue')
const access = ref<boolean>()
const retention = ref(false)
const ready = ref(false)
const pending = ref(false)
const error = ref('')
const completed = ref(false)
const heading = ref<HTMLElement>()
const tipHeading = ref<HTMLElement>()
const headings = [
  'onboardingWelcome',
  'onboardingStart',
  'includePrivateWindowsLabel',
  'onboardingReadTree',
  'onboardingFinish',
] as const
const tips = ONBOARDING_FEATURES.map((feature) => feature.title)
const tipDescriptions = ONBOARDING_FEATURES.map(
  (feature) => feature.description,
)
const demoActions = ONBOARDING_FEATURES.filter(
  (feature) => feature.id !== 'states',
).map((feature) => feature.id)
const currentFeature = computed(() => ONBOARDING_FEATURES[tip.value])
const indicatorSettings = computed(() => {
  if (currentFeature.value.id === 'tab-groups') {
    return {
      section: 'settings_tab_groups',
      label: 'onboardingTabGroupsSettings',
      hidden: Settings.values.tabGroupColorIndicator === 'hidden',
      notice: 'onboardingTabGroupsHidden',
    } as const
  }
  if (currentFeature.value.id === 'containers') {
    return {
      section: 'settings_containers',
      label: 'onboardingContainersSettings',
      hidden:
        Settings.values.containerColorIndicator === 'off' ||
        Settings.values.containerIconPosition === 'off',
      notice: 'onboardingContainersHidden',
    } as const
  }
  return undefined
})
const indicatorSettingsUrl = computed(() =>
  indicatorSettings.value
    ? browser.runtime.getURL(`/options.html#${indicatorSettings.value.section}`)
    : undefined,
)
const welcomeItems = computed<OnboardingExampleItem[]>(() => [
  {
    id: 'projects',
    kind: 'note',
    title: i18n.t('onboardingExampleGroup'),
    indentLevel: 0,
  },
  {
    id: 'window',
    kind: 'window',
    title: i18n.t('onboardingExampleWindow'),
    state: 'live',
    indentLevel: 1,
  },
  {
    id: 'research',
    kind: 'tab',
    title: i18n.t('onboardingDemoResearch'),
    state: 'active',
    indentLevel: 2,
  },
  {
    id: 'reference',
    kind: 'tab',
    title: i18n.t('onboardingDemoReference'),
    state: 'saved',
    indentLevel: 3,
  },
  {
    id: 'related',
    kind: 'tab',
    title: i18n.t('onboardingExampleBranch'),
    state: 'live',
    indentLevel: 2,
    collapsed: true,
  },
  {
    id: 'docs',
    kind: 'tab',
    title: i18n.t('onboardingExampleOtherTab'),
    state: 'unloaded',
    indentLevel: 3,
  },
  {
    id: 'bookmarks',
    kind: 'tab',
    title: i18n.t('onboardingExampleBookmarks'),
    state: 'saved',
    indentLevel: 3,
  },
  {
    id: 'ideas',
    kind: 'note',
    title: i18n.t('onboardingExampleNote'),
    indentLevel: 2,
  },
  { id: 'separator', kind: 'separator', title: '', indentLevel: 2 },
  {
    id: 'second-window',
    kind: 'window',
    title: i18n.t('onboardingExampleSecondWindow'),
    state: 'live',
    indentLevel: 1,
    collapsed: true,
  },
  {
    id: 'planning',
    kind: 'tab',
    title: i18n.t('onboardingExampleSchedule'),
    state: 'live',
    indentLevel: 2,
  },
])
const accessLabel = computed(() =>
  access.value === undefined
    ? i18n.t('checking')
    : access.value
      ? i18n.t('allowed')
      : i18n.t('notAllowed'),
)

async function initialize() {
  error.value = ''
  try {
    await Settings.loadSettingsFromStorage()
    openOnStartup.value = Settings.values.openSessionTreeOnStartup
    retention.value =
      Settings.values.retainPrivateWindows ||
      Settings.values.includePrivateWindowsInSessionSnapshots ||
      Settings.values.cachePrivateTabFavicons
    const stored = await browser.storage.local.get(ONBOARDING_STORAGE_KEY)
    const record = stored[ONBOARDING_STORAGE_KEY] as
      | OnboardingRecord
      | undefined
    const url = new URL(window.location.href)
    const replay = url.searchParams.has('replay')
    if (!replay && record?.status === 'pending') {
      if (
        record.welcomeStep !== undefined &&
        Number.isInteger(record.welcomeStep) &&
        record.welcomeStep >= 0 &&
        record.welcomeStep <= 4
      )
        step.value = record.welcomeStep
      if (
        typeof record.tip === 'number' &&
        Number.isInteger(record.tip) &&
        record.tip >= 0 &&
        record.tip < tips.length
      )
        tip.value = record.tip
      const storedFeature = ONBOARDING_FEATURES.findIndex(
        (feature) => feature.id === record.featureId,
      )
      if (storedFeature >= 0) tip.value = storedFeature
      if (record.destination === 'import') destination.value = 'import'
    }
    access.value = await isPrivateWindowAccessAllowed()
    if (step.value === 2 || replay) await saveProgress(step.value, tip.value)
    if (replay) {
      // Replay resets once; a reload of this tab should resume its new progress.
      url.searchParams.delete('replay')
      window.history.replaceState(null, '', url)
    }
    ready.value = true
  } catch {
    error.value = i18n.t('onboardingError')
  }
}
onMounted(() => {
  Settings.setupSettingsUpdatedListener()
  void initialize()
})

async function checkAccess() {
  if (pending.value) return
  pending.value = true
  error.value = ''
  access.value = undefined
  try {
    access.value = await isPrivateWindowAccessAllowed()
    await saveProgress(step.value, tip.value)
  } catch {
    error.value = i18n.t('onboardingError')
  } finally {
    pending.value = false
  }
}

async function saveProgress(next: number, nextTip: number) {
  await browser.storage.local.set({
    [ONBOARDING_STORAGE_KEY]: {
      status: 'pending',
      version: ONBOARDING_VERSION,
      welcomeStep: next,
      tip: nextTip,
      featureId: ONBOARDING_FEATURES[nextTip].id,
      destination: destination.value,
      ...(next === 2 && access.value === false
        ? {
            privateAccessResume: {
              allowed: false as const,
              expiresAt: Date.now() + PRIVATE_ACCESS_RESUME_TTL_MS,
            },
          }
        : {}),
    } satisfies OnboardingRecord,
  })
}

async function updatePreference(save: () => Promise<void>) {
  if (pending.value) return
  pending.value = true
  error.value = ''
  try {
    await save()
  } catch {
    error.value = i18n.t('onboardingError')
  } finally {
    // Reflect persisted preferences even if a later background effect failed.
    try {
      await Settings.loadSettingsFromStorage()
    } catch {
      error.value = i18n.t('onboardingError')
    }
    retention.value =
      Settings.values.retainPrivateWindows ||
      Settings.values.includePrivateWindowsInSessionSnapshots ||
      Settings.values.cachePrivateTabFavicons
    openOnStartup.value = Settings.values.openSessionTreeOnStartup
    pending.value = false
  }
}

async function navigate(next: number, nextTip = tip.value) {
  if (pending.value) return
  pending.value = true
  error.value = ''
  try {
    if (next === 2) access.value = await isPrivateWindowAccessAllowed()
    await saveProgress(next, nextTip)
    step.value = next
    tip.value = nextTip
    await nextTick()
    ;(next === 3 ? tipHeading.value : heading.value)?.focus()
  } catch {
    error.value = i18n.t('onboardingError')
  } finally {
    pending.value = false
  }
}

async function finish(command: OnboardingCompletionCommand) {
  if (pending.value) return
  pending.value = true
  error.value = ''
  try {
    await completeIntroduction(command)
    completed.value = true
  } catch {
    error.value = i18n.t('onboardingError')
  } finally {
    pending.value = false
  }
}

async function openSettings() {
  if (pending.value) return
  pending.value = true
  error.value = ''
  try {
    await browser.runtime.openOptionsPage()
  } catch {
    error.value = i18n.t('onboardingError')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <main class="introduction">
    <header class="welcome-brand">
      <img
        :src="'/icon/session-flow.svg'"
        alt=""
        width="40"
        height="40"
      />
      <span>{{ i18n.t('sessionFlow') }}</span>
      <button
        v-if="!completed"
        class="quiet"
        type="button"
        :disabled="!ready || pending"
        @click="finish('continue')"
      >
        {{ i18n.t('onboardingSkip') }}
      </button>
    </header>
    <template v-if="!completed">
      <p class="eyebrow">
        {{ i18n.t('onboardingProgress', [String(step + 1), '5']) }}
      </p>
      <div
        class="progress"
        aria-hidden="true"
      >
        <span
          v-for="n in 5"
          :key="n"
          :class="{ current: n <= step + 1 }"
        ></span>
      </div>
      <h1
        ref="heading"
        tabindex="-1"
      >
        {{ i18n.t(headings[step]) }}
      </h1>
      <section v-if="step === 0">
        <p>{{ i18n.t('onboardingWelcomeDescription') }}</p>
        <OnboardingTreePreview
          class="example-tree"
          :aria-label="i18n.t('onboardingExampleLabel')"
          :items="welcomeItems"
        />
        <p class="fine-print">{{ i18n.t('onboardingSampleTree') }}</p>
        <p>{{ i18n.t('onboardingWelcomeReassurance') }}</p>
        <p>{{ i18n.t('onboardingWelcomePrivacy') }}</p>
      </section>
      <section v-else-if="step === 1">
        <p>{{ i18n.t('onboardingStartDescription') }}</p>
        <fieldset class="start-choices">
          <legend>{{ i18n.t('onboardingStart') }}</legend>
          <label class="choice"
            ><input
              v-model="destination"
              type="radio"
              value="continue"
              name="start"
            /><span
              ><strong>{{ i18n.t('onboardingOpenTabs') }}</strong
              ><small>{{
                i18n.t('onboardingOpenTabsDescription')
              }}</small></span
            ></label
          >
          <label class="choice"
            ><input
              v-model="destination"
              type="radio"
              value="import"
              name="start"
            /><span
              ><strong>{{ i18n.t('onboardingImport') }}</strong
              ><small>{{ i18n.t('onboardingImportDescription') }}</small></span
            ></label
          >
        </fieldset>
      </section>
      <section v-else-if="step === 2">
        <p>{{ i18n.t('onboardingPrivateOptional') }}</p>
        <div class="access-status">
          <span>{{ i18n.t('firefoxPrivatewindowAccess') }}</span
          ><strong aria-live="polite">{{ accessLabel }}</strong>
        </div>
        <template v-if="access !== true">
          <p>{{ i18n.t('onboardingPrivateInstructions') }}</p>
          <p>{{ i18n.t('onboardingPrivateReload') }}</p>
          <ol>
            <li>{{ i18n.t('openFirefoxAddonsAndThemes') }}</li>
            <li>{{ i18n.t('selectExtensionsThenSessionFlow') }}</li>
            <li>{{ i18n.t('setRunInPrivateWindowsToAllow') }}</li>
          </ol>
          <button
            class="secondary"
            type="button"
            :disabled="!ready || pending"
            @click="checkAccess"
          >
            {{ i18n.t('checkAgain') }}
          </button>
        </template>
        <label class="choice retention"
          ><input
            v-model="retention"
            :disabled="!ready || pending"
            type="checkbox"
            @change="updatePreference(() => saveOnboardingRetention(retention))"
          /><span
            ><strong>{{ i18n.t('onboardingRetention') }}</strong
            ><small>{{ i18n.t('onboardingRetentionDescription') }}</small></span
          ></label
        >
        <p class="fine-print">{{ i18n.t('onboardingRetentionNote') }}</p>
      </section>
      <section
        v-else-if="step === 3"
        class="tab-guide"
      >
        <nav
          class="tip-tabs"
          :aria-label="i18n.t('onboardingGuideLabel')"
        >
          <button
            v-for="(title, index) in tips"
            :key="title"
            :data-feature-id="ONBOARDING_FEATURES[index].id"
            class="secondary"
            type="button"
            :aria-current="tip === index ? 'step' : undefined"
            :disabled="pending"
            @click="navigate(3, index)"
          >
            {{ i18n.t(title) }}
          </button>
        </nav>
        <h2
          ref="tipHeading"
          tabindex="-1"
        >
          {{ i18n.t(tips[tip]) }}
        </h2>
        <p>{{ i18n.t(tipDescriptions[tip]) }}</p>
        <p
          v-if="currentFeature.id === 'organize'"
          class="fine-print"
        >
          {{ i18n.t('onboardingCollapsedCount') }}
        </p>
        <p
          v-if="indicatorSettings"
          class="indicator-settings fine-print"
        >
          <span v-if="indicatorSettings.hidden">
            {{ i18n.t(indicatorSettings.notice) }}
          </span>
          <a
            :href="indicatorSettingsUrl"
            target="_blank"
            rel="noopener"
            >{{ i18n.t(indicatorSettings.label) }}</a
          >
        </p>
        <TabStateLegend v-if="tip === 0" />
        <OnboardingTreeDemo
          v-else
          :key="tip"
          :action="demoActions[tip - 1]"
        />
        <p
          v-if="currentFeature.id === 'save'"
          class="guide-warning"
        >
          {{ i18n.t('onboardingCloseDelete') }}
        </p>
        <p class="fine-print">
          {{ i18n.t('onboardingDemoSafe') }}
        </p>
      </section>
      <section v-else>
        <p>{{ i18n.t('onboardingFinishDescription') }}</p>
        <p>{{ i18n.t('onboardingToolbarDescription') }}</p>
        <label class="choice startup-choice"
          ><input
            v-model="openOnStartup"
            type="checkbox"
            :disabled="!ready || pending"
            @change="
              updatePreference(() => saveOnboardingStartup(openOnStartup))
            "
          /><span>{{ i18n.t('openTheSessionTreeOnStartup') }}</span></label
        >
        <div class="settings-access">
          <p>{{ i18n.t('onboardingSettingsDescription') }}</p>
          <button
            class="secondary"
            type="button"
            :disabled="!ready || pending"
            @click="openSettings"
          >
            {{ i18n.t('onboardingOpenSettings') }}
          </button>
        </div>
        <p class="fine-print">{{ i18n.t('onboardingReplayHint') }}</p>
      </section>
      <footer>
        <button
          v-if="step > 0"
          class="secondary"
          type="button"
          :disabled="pending"
          @click="
            step === 3 && tip > 0 ? navigate(3, tip - 1) : navigate(step - 1)
          "
        >
          {{ i18n.t('onboardingBack') }}
        </button>
        <button
          v-if="step === 3"
          class="secondary"
          type="button"
          :disabled="!ready || pending"
          @click="navigate(4)"
        >
          {{ i18n.t('onboardingSkipTips') }}
        </button>
        <button
          v-if="step < 4"
          class="primary"
          type="button"
          :disabled="!ready || pending"
          @click="
            step === 3 && tip < tips.length - 1
              ? navigate(3, tip + 1)
              : navigate(step + 1)
          "
        >
          {{
            i18n.t(
              step === 3 && tip < tips.length - 1
                ? 'onboardingNextTip'
                : 'onboardingNext',
            )
          }}
        </button>
        <button
          v-else
          class="primary"
          type="button"
          :disabled="!ready || pending"
          @click="finish(destination)"
        >
          {{
            destination === 'import'
              ? i18n.t('onboardingImport')
              : i18n.t('onboardingOpenTree')
          }}
        </button>
      </footer>
    </template>
    <section v-else>
      <h1>{{ i18n.t('onboardingReady') }}</h1>
      <p>{{ i18n.t('onboardingReadyDescription') }}</p>
      <p>{{ i18n.t('onboardingToolbarDescription') }}</p>
      <button
        class="primary"
        type="button"
        :disabled="pending"
        @click="finish('continue')"
      >
        {{ i18n.t('onboardingOpenTree') }}
      </button>
    </section>
    <p
      v-if="error"
      role="alert"
      class="error"
    >
      {{ error }}
    </p>
    <button
      v-if="error && !ready"
      class="secondary"
      type="button"
      @click="initialize"
    >
      {{ i18n.t('checkAgain') }}
    </button>
  </main>
</template>
