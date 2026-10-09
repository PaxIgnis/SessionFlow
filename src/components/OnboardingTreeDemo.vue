<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  type ComponentPublicInstance,
} from 'vue'
import { i18n } from '@/services/i18n'
import { Settings } from '@/services/settings'
import {
  demoDropHighlight,
  demoPause,
  exampleDragPreview,
  moveDemoPointer,
  type DemoPoint,
} from '@/services/onboarding-animation'
import type {
  OnboardingDemoAction,
  OnboardingExampleItem,
} from '@/types/onboarding-demo'
import OnboardingTreePreview from './OnboardingTreePreview.vue'
import SessionTreeToolbar from './SessionTreeToolbar.vue'
import EditTextModal from './EditTextModal.vue'

const props = defineProps<{ action: OnboardingDemoAction }>()
const root = ref<HTMLElement>()
const editor = ref<ComponentPublicInstance>()
const phase = ref<'before' | 'playing' | 'after'>('before')
const motion = ref('idle')
const drop = ref<'above' | 'mid' | 'below'>('mid')
const target = ref<'tab' | 'window'>('tab')
const opened = ref(false)
const removed = ref<string>()
const saved = ref<string>()
const editing = ref(false)
const groupedWindows = ref(0)
const noteText = ref(i18n.t('newNote'))
const revision = ref(0)
const pointer = ref<DemoPoint>()
const pointerDown = ref(false)
const hover = ref<string>()
const highlight = ref<'above' | 'mid' | 'below'>()
const dragged = ref<ReturnType<typeof exampleDragPreview>>()
const selectionMode = ref<'ctrl' | 'shift' | 'drag' | 'menu' | 'branches'>(
  'ctrl',
)
const selected = ref<string[]>([])
const anchor = ref<string>()
const moved = ref<string[]>([])
const bulkSaved = ref<string[]>([])
const collapseState = ref<Record<string, boolean>>({})
const labels = ref({
  tab: { text: '', edited: false },
  window: { text: '', edited: false },
})
const labelText = computed({
  get: () => labels.value[target.value].text,
  set: (text: string) => {
    labels.value[target.value].text = text
  },
})
const labelEdited = computed({
  get: () => labels.value[target.value].edited,
  set: (edited: boolean) => {
    labels.value[target.value].edited = edited
  },
})
const pointerKey = ref('')
const menu = ref<{ id: string; x: number; y: number }>()
const menuElement = ref<HTMLElement>()
const selectionChoices = [
  ['ctrl', 'onboardingSelectCtrl'],
  ['shift', 'onboardingSelectShift'],
  ['drag', 'onboardingSelectDrag'],
  ['menu', 'onboardingSelectMenu'],
  ['branches', 'onboardingSelectBranches'],
] as const
const settingsUrl = (section: string) =>
  browser.runtime.getURL(`/options.html#${section}`)
let playback: AbortController | undefined
const isStatic = computed(() =>
  ['window-bar', 'tab-groups', 'containers'].includes(props.action),
)
const captions = {
  open: ['onboardingOpenBefore', 'onboardingOpenAfter'],
  focus: ['onboardingFocusBefore', 'onboardingFocusAfter'],
  organize: ['onboardingOrganizeBefore', 'onboardingOrganizeAfter'],
  'multi-select': ['onboardingMultiSelectBefore', 'onboardingMultiSelectAfter'],
  labels: ['onboardingLabelsBefore', 'onboardingLabelsAfter'],
  save: ['onboardingSaveBefore', 'onboardingSaveAfter'],
  close: ['onboardingCloseBefore', 'onboardingCloseAfter'],
  'note-add': ['onboardingNoteAddBefore', 'onboardingNoteAddAfter'],
  'note-edit': ['onboardingNoteEditBefore', 'onboardingNoteEditAfter'],
  'note-group': ['onboardingNoteGroupBefore', 'onboardingNoteGroupAfter'],
  'window-bar': ['onboardingWindowBarCaption', 'onboardingWindowBarCaption'],
  'tab-groups': ['onboardingTabGroupsCaption', 'onboardingTabGroupsCaption'],
  containers: ['onboardingContainersCaption', 'onboardingContainersCaption'],
} as const
const caption = computed(() => {
  if (props.action === 'multi-select' && phase.value === 'after')
    return selectionMode.value === 'branches'
      ? 'onboardingSelectBranchesAfter'
      : selectionMode.value === 'drag'
        ? 'onboardingSelectDragAfter'
        : selectionMode.value === 'menu'
          ? 'onboardingSelectMenuAfter'
          : 'onboardingMultiSelectAfter'
  if (removed.value)
    return removed.value === 'window'
      ? 'onboardingCloseWindowAfter'
      : 'onboardingCloseAfter'
  if (saved.value)
    return saved.value === 'window'
      ? 'onboardingSaveWindowAfter'
      : 'onboardingSaveAfter'
  if (target.value === 'window' && props.action === 'save')
    return 'onboardingSaveWindowBefore'
  if (target.value === 'window' && props.action === 'close')
    return 'onboardingCloseWindowBefore'
  if (
    props.action === 'organize' &&
    phase.value === 'after' &&
    drop.value !== 'mid'
  )
    return 'onboardingOrganizeSiblingAfter'
  return captions[props.action][phase.value === 'after' ? 1 : 0]
})
const items = computed<OnboardingExampleItem[]>(() => {
  const finished = phase.value === 'after'
  const actions = props.action === 'save' || props.action === 'close'
  const windowItem: OnboardingExampleItem = {
    id: 'window',
    kind: 'window',
    title: i18n.t('onboardingExampleWindow'),
    indentLevel: 0,
    state: saved.value === 'window' ? 'saved' : 'live',
    actions: actions && target.value === 'window',
    showActions: hover.value === 'window',
  }
  const research: OnboardingExampleItem = {
    id: 'research',
    kind: 'tab',
    title: i18n.t('onboardingDemoResearch'),
    url: 'https://example.org/research',
    indentLevel: 1,
    state:
      saved.value === 'window'
        ? 'saved'
        : props.action === 'focus' && finished
          ? 'active'
          : 'live',
  }
  const reference: OnboardingExampleItem = {
    id: 'reference',
    kind: 'tab',
    title: i18n.t('onboardingDemoReference'),
    url: 'https://example.org/reading-list',
    indentLevel: 1,
    state: saved.value
      ? 'saved'
      : props.action === 'open'
        ? opened.value
          ? 'active'
          : 'saved'
        : 'live',
    actions: actions && target.value === 'tab',
    showActions: hover.value === 'reference',
  }
  const secondWindow: OnboardingExampleItem = {
    ...windowItem,
    id: 'second-window',
    title: i18n.t('onboardingExampleSecondWindow'),
    state: 'live',
    actions: false,
    showActions: false,
  }
  const otherTab: OnboardingExampleItem = {
    id: 'other-tab',
    kind: 'tab',
    title: i18n.t('onboardingExampleOtherTab'),
    indentLevel: 1,
    state: 'live',
  }
  if (props.action === 'labels')
    return [
      {
        ...windowItem,
        contextMenu: true,
        title: labels.value.window.edited
          ? labels.value.window.text || i18n.t('window')
          : windowItem.title,
      },
      {
        ...research,
        contextMenu: true,
        customLabel: labels.value.tab.text,
      },
      reference,
    ]
  if (props.action === 'multi-select') {
    otherTab.drop = highlight.value
    const scene: OnboardingExampleItem[] = [
      windowItem,
      research,
      reference,
      otherTab,
      secondWindow,
      {
        id: 'branch',
        kind: 'tab',
        title: i18n.t('onboardingExampleBranch'),
        state: 'live',
        indentLevel: 1,
        collapsed: true,
      },
      {
        id: 'branch-child-1',
        kind: 'tab',
        title: i18n.t('onboardingExampleChecklist'),
        state: 'live',
        indentLevel: 2,
      },
      {
        id: 'branch-child-2',
        kind: 'tab',
        title: i18n.t('onboardingExampleBudget'),
        state: 'unloaded',
        indentLevel: 2,
      },
      {
        ...otherTab,
        id: 'last-tab',
        title: i18n.t('onboardingExampleSchedule'),
        drop: undefined,
      },
    ]
    const visibleScene = moved.value.length
      ? scene
          .filter((item) => !moved.value.includes(item.id))
          .flatMap((item) =>
            item.id === 'other-tab'
              ? [
                  item,
                  ...scene
                    .filter((child) => moved.value.includes(child.id))
                    .map((child) => ({ ...child, indentLevel: 2 })),
                ]
              : [item],
          )
      : scene
    return visibleScene.map((item) => ({
      ...item,
      collapsed: collapseState.value[item.id] ?? item.collapsed,
      selected: selected.value.includes(item.id),
      showActions: hover.value === item.id,
      state: bulkSaved.value.includes(item.id) ? 'saved' : item.state,
    }))
  }
  if (props.action.startsWith('note-')) {
    const group = props.action === 'note-group'
    const note: OnboardingExampleItem = {
      id: 'note',
      kind: 'note',
      title: group ? i18n.t('onboardingExampleGroup') : noteText.value,
      indentLevel: 0,
      drop: group ? highlight.value : undefined,
    }
    const firstLevel = group && groupedWindows.value >= 1 ? 1 : 0
    const secondLevel = group && groupedWindows.value >= 2 ? 1 : 0
    const windows = [
      { ...windowItem, indentLevel: firstLevel },
      { ...research, indentLevel: firstLevel + 1 },
      { ...secondWindow, indentLevel: secondLevel },
      { ...reference, indentLevel: secondLevel + 1 },
    ]
    return props.action === 'note-add'
      ? [...windows, ...(finished ? [note] : [])]
      : [note, ...windows]
  }
  if (props.action === 'window-bar')
    return [
      windowItem,
      research,
      reference,
      {
        id: 'unloaded-1',
        kind: 'tab',
        title: i18n.t('onboardingExampleChecklist'),
        state: 'unloaded',
        indentLevel: 1,
      },
      {
        id: 'saved-1',
        kind: 'tab',
        title: i18n.t('onboardingExampleBookmarks'),
        state: 'saved',
        indentLevel: 1,
      },
      {
        id: 'branch',
        kind: 'tab',
        title: i18n.t('onboardingExampleBranch'),
        state: 'live',
        indentLevel: 1,
        collapsed: true,
      },
      {
        id: 'unloaded-2',
        kind: 'tab',
        title: i18n.t('onboardingExampleBudget'),
        state: 'unloaded',
        indentLevel: 2,
      },
    ]
  if (props.action === 'tab-groups')
    return [
      windowItem,
      {
        ...research,
        tabGroup: { title: i18n.t('onboardingExampleGroup'), color: 'blue' },
      },
      {
        ...reference,
        tabGroup: { title: i18n.t('onboardingExampleGroup'), color: 'blue' },
      },
      {
        ...otherTab,
        tabGroup: {
          title: i18n.t('onboardingExampleOtherGroup'),
          color: 'yellow',
        },
      },
    ]
  if (props.action === 'containers') {
    const work = {
      cookieStoreId: 'example-work',
      name: i18n.t('onboardingContainerWork'),
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
    }
    const personal = {
      cookieStoreId: 'example-personal',
      name: i18n.t('onboardingContainerPersonal'),
      color: 'purple',
      colorCode: '#af51f5',
      icon: 'fingerprint',
    }
    return [
      windowItem,
      { ...research, container: work },
      { ...reference, container: personal },
      otherTab,
    ]
  }
  if (props.action === 'organize') {
    research.drop = highlight.value
    const extras: OnboardingExampleItem[] = [
      {
        id: 'ideas',
        kind: 'note',
        title: i18n.t('onboardingExampleNote'),
        indentLevel: 1,
        collapsed: true,
      },
      {
        id: 'idea-child',
        kind: 'note',
        title: i18n.t('onboardingExampleGroup'),
        indentLevel: 2,
      },
      { id: 'separator', kind: 'separator', title: '', indentLevel: 1 },
      { ...otherTab, state: 'unloaded', collapsed: true },
      {
        id: 'other-child-1',
        kind: 'tab',
        title: i18n.t('onboardingExampleChecklist'),
        state: 'unloaded',
        indentLevel: 2,
      },
      {
        id: 'other-child-2',
        kind: 'tab',
        title: i18n.t('onboardingExampleBudget'),
        state: 'saved',
        indentLevel: 2,
      },
    ]
    if (finished && drop.value === 'above')
      return [windowItem, reference, research, ...extras]
    if (finished)
      return [
        windowItem,
        research,
        { ...reference, indentLevel: drop.value === 'mid' ? 2 : 1 },
        ...extras,
      ]
    return [windowItem, research, ...extras, reference]
  }
  if (removed.value === 'window') return [secondWindow, otherTab]
  return [
    windowItem,
    research,
    ...(removed.value ? [] : [reference]),
    ...(actions ? [secondWindow, otherTab] : []),
  ]
})

function stopPlayback() {
  playback?.abort()
  playback = undefined
  pointer.value = undefined
  dragged.value = undefined
  highlight.value = undefined
  hover.value = undefined
  pointerDown.value = false
  pointerKey.value = ''
  motion.value = 'idle'
}
function finish() {
  stopPlayback()
  if (props.action === 'open') opened.value = true
  if (props.action === 'save')
    saved.value = target.value === 'window' ? 'window' : 'reference'
  if (props.action === 'close')
    removed.value = target.value === 'window' ? 'window' : 'reference'
  if (props.action === 'note-group') groupedWindows.value = 2
  if (props.action === 'note-edit')
    noteText.value = i18n.t('onboardingExampleGroup')
  if (props.action === 'labels') {
    labelText.value = i18n.t('onboardingExampleGroup')
    labelEdited.value = true
  }
  editing.value = false
  phase.value = 'after'
}
function saveItem(id: string) {
  stopPlayback()
  saved.value = id
  phase.value = 'after'
}
function closeItem(id: string) {
  stopPlayback()
  removed.value = id
  phase.value = 'after'
}
function activate(id: string) {
  if (
    (props.action === 'focus' && id === 'research') ||
    (props.action === 'open' && id === 'reference')
  )
    finish()
  if (props.action === 'note-edit' && id === 'note') {
    stopPlayback()
    editing.value = true
  }
}
function confirmNote(text: string) {
  stopPlayback()
  noteText.value = text.trim()
  editing.value = false
  phase.value = 'after'
}
function cancelEdit() {
  stopPlayback()
  editing.value = false
  phase.value =
    props.action === 'labels' && labelEdited.value ? 'after' : 'before'
}
function interrupt() {
  stopPlayback()
  if (phase.value === 'playing') phase.value = 'before'
}
function reset() {
  stopPlayback()
  removed.value = undefined
  saved.value = undefined
  opened.value = false
  groupedWindows.value = 0
  noteText.value = i18n.t('newNote')
  editing.value = false
  selected.value = []
  anchor.value = undefined
  moved.value = []
  bulkSaved.value = []
  collapseState.value = {}
  labels.value = {
    tab: { text: '', edited: false },
    window: { text: '', edited: false },
  }
  menu.value = undefined
  phase.value = 'before'
  revision.value++
}
function chooseDrop(value: typeof drop.value) {
  reset()
  drop.value = value
}
function chooseTarget(value: typeof target.value) {
  reset()
  target.value = value
}
function chooseSelection(value: typeof selectionMode.value) {
  reset()
  selectionMode.value = value
}
function applySelection(id: string, ctrl = false, shift = false) {
  if (shift && anchor.value) {
    const start = items.value.findIndex((item) => item.id === anchor.value)
    const end = items.value.findIndex((item) => item.id === id)
    if (start >= 0 && end >= 0) {
      const range = items.value
        .slice(Math.min(start, end), Math.max(start, end) + 1)
        .map((item) => item.id)
      selected.value = ctrl
        ? [...new Set([...selected.value, ...range])]
        : range
      return
    }
  }
  anchor.value = id
  selected.value = ctrl
    ? selected.value.includes(id)
      ? selected.value.filter((value) => value !== id)
      : [...selected.value, id]
    : [id]
}
function selectRow(id: string, event: MouseEvent | KeyboardEvent) {
  if (props.action !== 'multi-select') return
  interrupt()
  menu.value = undefined
  applySelection(id, event.ctrlKey || event.metaKey, event.shiftKey)
}
function showMenu(id: string, event: MouseEvent) {
  if (props.action !== 'multi-select' && props.action !== 'labels') return
  interrupt()
  if (props.action === 'multi-select' && !selected.value.includes(id))
    applySelection(id, event.ctrlKey || event.metaKey)
  menu.value = {
    id,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 190)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 70)),
  }
  nextTick(() => menuElement.value?.querySelector('button')?.focus())
}
function menuAction(animated = false) {
  if (!menu.value) return
  const id = menu.value.id
  menu.value = undefined
  if (!animated) interrupt()
  if (props.action === 'labels') {
    target.value = id === 'window' ? 'window' : 'tab'
    editing.value = true
    return
  }
  const scope = Settings.values.contextMenuSaveDescendants
  const onWindow = items.value.find((item) => item.id === id)?.kind === 'window'
  const affected = new Set<string>()
  items.value.forEach((item, index) => {
    if (
      !selected.value.includes(item.id) ||
      (onWindow && item.kind !== 'window')
    )
      return
    affected.add(item.id)
    if (
      item.kind !== 'window' &&
      scope !== 'always' &&
      !(scope === 'collapsed' && item.collapsed)
    )
      return
    for (
      let next = index + 1;
      next < items.value.length &&
      items.value[next].indentLevel > item.indentLevel;
      next++
    )
      affected.add(items.value[next].id)
  })
  bulkSaved.value = [...affected]
  stopPlayback()
  phase.value = 'after'
}
function confirmLabel(text: string) {
  stopPlayback()
  labelText.value = text.trim()
  labelEdited.value = true
  editing.value = false
  phase.value = 'after'
}

function find(selector: string, inEditor = false): HTMLElement | null {
  const scope = inEditor
    ? (editor.value?.$el as HTMLElement | undefined)
    : root.value
  return scope?.querySelector<HTMLElement>(selector) ?? null
}
async function go(
  element: HTMLElement,
  signal: AbortSignal,
  ratio = 0.5,
  targetElement?: HTMLElement,
) {
  if (signal.aborted || !pointer.value) return false
  const rect = element.getBoundingClientRect()
  const destination = {
    x: rect.left + Math.min(rect.width * 0.35, 160),
    y: rect.top + rect.height * ratio,
  }
  const row = element.closest<HTMLElement>('[data-example-id]')
  return moveDemoPointer(
    pointer.value!,
    destination,
    650,
    (point) => {
      pointer.value = point
      const hovered = row?.getBoundingClientRect()
      hover.value =
        hovered &&
        point.x >= hovered.left &&
        point.x <= hovered.right &&
        point.y >= hovered.top &&
        point.y <= hovered.bottom
          ? row?.dataset.exampleId
          : undefined
      highlight.value = targetElement
        ? demoDropHighlight(point, targetElement.getBoundingClientRect())
        : undefined
      if (dragged.value)
        motion.value = highlight.value ? 'over-target' : 'dragging'
    },
    signal,
  )
}
async function click(signal: AbortSignal, twice = false) {
  motion.value = 'click'
  for (let count = 0; count < (twice ? 2 : 1); count++) {
    pointerDown.value = true
    if (!(await demoPause(130, signal))) return false
    pointerDown.value = false
    if (!(await demoPause(160, signal))) return false
  }
  return true
}
async function drag(
  sourceId: string,
  targetId: string,
  signal: AbortSignal,
  position: typeof drop.value,
) {
  const source = find(`[data-example-id="${sourceId}"]`)
  const destination = find(`[data-example-id="${targetId}"]`)
  if (
    !source ||
    !destination ||
    !(await go(source, signal)) ||
    !(await click(signal))
  )
    return false
  const item = items.value.find((item) => item.id === sourceId)!
  dragged.value = exampleDragPreview(
    item,
    items.value,
    props.action === 'multi-select' &&
      Settings.values.includeSelectedItemsWithDraggedItem
      ? selected.value
      : undefined,
  )
  motion.value = 'dragging'
  // Keep the native source row in place; only the pointer and drag image move.
  if (!(await demoPause(300, signal))) return false
  if (
    !(await go(
      destination,
      signal,
      position === 'above' ? 0.15 : position === 'below' ? 0.85 : 0.5,
      destination,
    ))
  )
    return false
  if (!(await demoPause(700, signal))) return false
  dragged.value = undefined
  highlight.value = undefined
  return true
}
async function openExampleMenu(id: string, signal: AbortSignal) {
  const row = find(`[data-example-id="${id}"] .tree-item-content`)
  if (!row || !(await go(row, signal))) return false
  pointerKey.value = i18n.t('onboardingRightClick')
  if (!(await click(signal))) return false
  menu.value = { id, x: pointer.value!.x, y: pointer.value!.y }
  await nextTick()
  if (!(await demoPause(600, signal))) return false
  const action = menuElement.value?.querySelector<HTMLElement>('button')
  if (!action || !(await go(action, signal)) || !(await click(signal)))
    return false
  pointerKey.value = ''
  menuAction(true)
  return true
}
async function editNote(signal: AbortSignal) {
  if (props.action === 'labels') {
    if (
      !(await openExampleMenu(
        target.value === 'window' ? 'window' : 'research',
        signal,
      ))
    )
      return
  } else {
    const note = find('[data-example-id="note"] .tree-item-content')
    if (!note || !(await go(note, signal)) || !(await click(signal, true)))
      return
    editing.value = true
  }
  await nextTick()
  const input = find('.modal-input', true) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null
  if (!input || !(await go(input, signal))) return
  motion.value = 'typing'
  const text = i18n.t('onboardingExampleGroup')
  for (let count = 0; count <= text.length; count++) {
    if (signal.aborted) return
    input.value = text.slice(0, count)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    if (!(await demoPause(90, signal))) return
  }
  if (!(await demoPause(450, signal))) return
  const ok = find('.modal-buttons .btn-primary', true)
  if (!ok || !(await go(ok, signal)) || !(await click(signal))) return
  motion.value = 'confirm'
  if (!(await demoPause(250, signal))) return
  ok.click()
}
async function selectExample(
  id: string,
  signal: AbortSignal,
  key?: 'ctrl' | 'shift',
) {
  const row = find(`[data-example-id="${id}"] .tree-item-content`)
  pointerKey.value = key === 'ctrl' ? 'Ctrl' : key === 'shift' ? 'Shift' : ''
  if (!row || !(await go(row, signal)) || !(await click(signal))) return false
  applySelection(id, key === 'ctrl', key === 'shift')
  await nextTick()
  return demoPause(300, signal)
}
async function playSelection(signal?: AbortSignal) {
  const branches = selectionMode.value === 'branches'
  const first = branches ? 'window' : 'research'
  const last = branches
    ? 'last-tab'
    : selectionMode.value === 'ctrl' || selectionMode.value === 'shift'
      ? 'other-tab'
      : 'reference'
  const modifier =
    branches || selectionMode.value === 'shift' ? 'shift' : 'ctrl'
  if (signal) {
    if (
      !(await selectExample(first, signal)) ||
      !(await selectExample(last, signal, modifier))
    )
      return
  } else {
    applySelection(first)
    applySelection(last, modifier === 'ctrl', modifier === 'shift')
  }
  pointerKey.value = ''
  if (branches) {
    if (signal) {
      const epsilon = find(
        '[data-example-id="branch"] .tree-item-action-button',
      )
      if (!epsilon || !(await go(epsilon, signal)) || !(await click(signal)))
        return
      epsilon.click()
      await nextTick()
      if (!(await demoPause(700, signal))) return
    } else {
      collapseState.value.branch = false
    }
  }
  if (selectionMode.value === 'drag') {
    const payload = Settings.values.includeSelectedItemsWithDraggedItem
      ? [...selected.value]
      : ['research']
    if (signal && !(await drag('research', 'other-tab', signal, 'mid'))) return
    moved.value = payload
  }
  if (selectionMode.value === 'menu') {
    if (signal) await openExampleMenu('reference', signal)
    else {
      menu.value = { id: 'reference', x: 0, y: 0 }
      menuAction()
    }
    return
  }
  finish()
}
async function play() {
  reset()
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (props.action === 'multi-select') {
      await playSelection()
      return
    }
    finish()
    return
  }
  phase.value = 'playing'
  motion.value = 'approach'
  playback = new AbortController()
  const signal = playback.signal
  try {
    root.value?.scrollIntoView({ block: 'nearest' })
    await nextTick()
    if (signal.aborted || !root.value) return
    const bounds = root.value.getBoundingClientRect()
    pointer.value = { x: bounds.right - 50, y: bounds.bottom - 30 }
    if (props.action === 'multi-select') {
      await playSelection(signal)
      return
    }
    if (props.action === 'organize') {
      if (await drag('reference', 'research', signal, drop.value)) finish()
      return
    }
    if (props.action === 'note-group') {
      if (!(await drag('window', 'note', signal, 'mid'))) return
      groupedWindows.value = 1
      await nextTick()
      if (
        !(await demoPause(350, signal)) ||
        !(await drag('second-window', 'note', signal, 'mid'))
      )
        return
      finish()
      return
    }
    if (props.action === 'note-edit' || props.action === 'labels') {
      await editNote(signal)
      return
    }
    let selector: string
    if (props.action === 'note-add')
      selector = '.toolbar-button[aria-label="' + i18n.t('addNote') + '"]'
    else if (props.action === 'save' || props.action === 'close') {
      const id = target.value === 'window' ? 'window' : 'reference'
      const row = find(`[data-example-id="${id}"]`)
      if (!row || !(await go(row, signal))) return
      hover.value = id
      await nextTick()
      selector = `[data-example-id="${id}"] button[aria-label="${i18n.t(props.action === 'save' ? 'save' : 'delete')}"]`
    } else
      selector = `[data-example-id="${props.action === 'open' ? 'reference' : 'research'}"] .tree-item-content`
    const element = find(selector)
    if (
      !element ||
      !(await go(element, signal)) ||
      !(await click(
        signal,
        props.action === 'focus' || props.action === 'open',
      ))
    )
      return
    if (!(await demoPause(350, signal))) return
    finish()
  } finally {
    if (!signal.aborted && phase.value === 'playing') {
      stopPlayback()
      editing.value = false
      phase.value = 'before'
    }
  }
}
onBeforeUnmount(stopPlayback)
</script>

<template>
  <figure
    class="tree-demo"
    :data-action="action"
    :data-phase="phase"
    :data-motion="motion"
    :data-drop="drop"
    :data-target="target"
  >
    <div
      v-if="action === 'multi-select'"
      class="example-choices"
      role="group"
      :aria-label="i18n.t('onboardingSelectionExamples')"
    >
      <button
        v-for="[mode, label] in selectionChoices"
        :key="mode"
        class="secondary"
        type="button"
        :aria-pressed="selectionMode === mode"
        @click="chooseSelection(mode)"
      >
        {{ i18n.t(label) }}
      </button>
    </div>
    <div
      v-if="action === 'organize'"
      class="example-choices"
      role="group"
      :aria-label="i18n.t('onboardingDropPosition')"
    >
      <button
        v-for="position in ['above', 'mid', 'below'] as const"
        :key="position"
        class="secondary"
        type="button"
        :aria-pressed="drop === position"
        @click="chooseDrop(position)"
      >
        {{
          i18n.t(
            position === 'above'
              ? 'onboardingDropAbove'
              : position === 'mid'
                ? 'onboardingDropMiddle'
                : 'onboardingDropBelow',
          )
        }}
      </button>
    </div>
    <div
      v-if="action === 'save' || action === 'close' || action === 'labels'"
      class="example-choices"
      role="group"
      :aria-label="i18n.t('onboardingActionTarget')"
    >
      <button
        v-for="kind in ['tab', 'window'] as const"
        :key="kind"
        class="secondary"
        type="button"
        :aria-pressed="target === kind"
        @click="chooseTarget(kind)"
      >
        {{
          i18n.t(
            kind === 'tab' ? 'onboardingTargetTab' : 'onboardingTargetWindow',
          )
        }}
      </button>
    </div>
    <div class="demo-tree">
      <div
        ref="root"
        class="demo-stage"
      >
        <OnboardingTreePreview
          :key="revision"
          :items="items"
          @activate="activate"
          @save="saveItem"
          @close="closeItem"
          @select="selectRow"
          @context-menu="showMenu"
          @collapse="(id, collapsed) => (collapseState[id] = collapsed)"
        />
        <SessionTreeToolbar
          v-if="action === 'note-add'"
          @add-note="finish"
        />
      </div>
    </div>
    <figcaption aria-live="polite">{{ i18n.t(caption) }}</figcaption>
    <template v-if="action === 'multi-select'">
      <p
        class="selection-count"
        aria-live="polite"
      >
        {{ i18n.t('onboardingSelectedCount', [String(selected.length)]) }}
      </p>
      <p
        v-if="
          selectionMode === 'drag' &&
          !Settings.values.includeSelectedItemsWithDraggedItem
        "
        class="fine-print"
      >
        {{ i18n.t('onboardingSelectionDragDisabled') }}
      </p>
      <p class="selection-settings fine-print">
        <a
          :href="settingsUrl('settings_drag_and_drop')"
          target="_blank"
          rel="noopener"
          >{{ i18n.t('onboardingDragSettings') }}</a
        >
        <a
          :href="settingsUrl('settings_context_menu')"
          target="_blank"
          rel="noopener"
          >{{ i18n.t('onboardingContextMenuSettings') }}</a
        >
      </p>
    </template>
    <button
      v-if="!isStatic"
      type="button"
      class="secondary demo-play"
      :disabled="phase === 'playing'"
      @click="play"
    >
      {{
        i18n.t(
          phase === 'before' ? 'onboardingDemoPlay' : 'onboardingDemoReplay',
        )
      }}
    </button>
    <EditTextModal
      v-if="editing"
      ref="editor"
      :title="
        i18n.t(
          action === 'labels'
            ? target === 'window'
              ? 'editTitle'
              : 'editLabel'
            : 'editNote',
        )
      "
      :initial-value="
        action === 'labels'
          ? target === 'window' && !labelEdited
            ? i18n.t('onboardingExampleWindow')
            : labelText
          : noteText
      "
      :placeholder="
        i18n.t(
          action === 'labels'
            ? target === 'window'
              ? 'enterWindowTitle'
              : 'enterCustomLabel'
            : 'enterNoteText',
        )
      "
      :multiline="action !== 'labels'"
      :max-length="action === 'labels' ? 150 : 500"
      @keydown.capture="interrupt"
      @confirm="
        action === 'labels' ? confirmLabel($event) : confirmNote($event)
      "
      @cancel="cancelEdit"
    />
    <Teleport to="body"
      ><div
        v-if="menu"
        class="demo-menu-backdrop"
        @click.self="menu = undefined"
        @contextmenu.prevent="menu = undefined"
      >
        <div
          ref="menuElement"
          class="demo-context-menu"
          role="menu"
          :aria-label="i18n.t('contextMenu')"
          :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
          @keydown.esc.prevent="menu = undefined"
        >
          <button
            type="button"
            role="menuitem"
            @click="menuAction()"
          >
            {{
              i18n.t(
                action === 'labels'
                  ? menu.id === 'window'
                    ? 'editTitle'
                    : 'editLabel'
                  : 'save',
              )
            }}
          </button>
        </div>
      </div>
      <div
        v-if="pointer"
        class="demo-pointer"
        :class="{ 'pointer-down': pointerDown }"
        :style="{ left: `${pointer.x - 3}px`, top: `${pointer.y - 2}px` }"
        aria-hidden="true"
      >
        <svg
          class="demo-cursor"
          viewBox="0 0 24 28"
        >
          <path d="M3 2v21l5-5 4 8 4-2-4-8h8z" />
        </svg>
        <kbd
          v-if="pointerKey"
          class="demo-modifier"
          >{{ pointerKey }}</kbd
        >
        <svg
          v-if="dragged"
          class="demo-drag-badge"
          viewBox="0 0 16 16"
        >
          <rect
            x="2"
            y="3"
            width="11"
            height="9"
            rx="1"
          />
          <path d="M4 6h7M4 9h5" />
        </svg>
        <div
          v-if="dragged"
          class="demo-drag-preview"
        >
          <strong>{{ dragged.title }}</strong
          ><em v-if="dragged.metadata">{{ dragged.metadata }}</em
          ><span
            v-for="line in dragged.body"
            :key="line"
            >{{ line }}</span
          >
        </div>
      </div></Teleport
    >
  </figure>
</template>

<style scoped>
.tree-demo {
  margin: 24px 0;
}
.selection-count {
  font-size: 13px;
}
.selection-settings {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.selection-settings a {
  color: var(--state-live);
}
.demo-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
}
.demo-context-menu {
  position: fixed;
  min-width: 160px;
  padding: 4px;
  border: 1px solid var(--options-hairline-strong);
  border-radius: 6px;
  background: var(--options-surface);
  box-shadow: 0 2px 8px #0005;
}
.demo-context-menu button {
  width: 100%;
  border: 0;
  padding: 6px 12px;
  text-align: start;
  background: transparent;
  color: var(--text-color-primary);
}
.demo-context-menu button:hover,
.demo-context-menu button:focus-visible {
  background: var(--list-item-selected-background);
}
.demo-modifier {
  position: absolute;
  top: 30px;
  left: 18px;
  white-space: nowrap;
  padding: 2px 5px;
  border-radius: 3px;
  color: #111;
  background: white;
  font: 12px system-ui;
}
.demo-tree {
  border: 1px solid var(--tree-edge);
  border-radius: 8px;
  background: var(--tree-background);
  overflow: hidden;
}
.demo-stage {
  position: relative;
  min-height: 184px;
  display: flex;
  flex-direction: column;
}
.session-tree-toolbar {
  margin-top: auto;
}
.demo-pointer {
  position: fixed;
  z-index: 10000;
  pointer-events: none;
  width: 24px;
  height: 28px;
}
.demo-cursor {
  width: 24px;
  height: 28px;
  fill: white;
  stroke: #15181e;
  stroke-width: 1.5;
  transition: transform 100ms;
}
.pointer-down .demo-cursor {
  transform: scale(0.8);
}
.demo-drag-badge {
  position: absolute;
  left: 5px;
  top: 20px;
  z-index: 1;
  width: 16px;
  height: 16px;
  fill: white;
  stroke: #15181e;
  stroke-width: 1;
}
.demo-drag-preview {
  position: absolute;
  left: 14px;
  top: 14px;
  min-width: 80px;
  max-width: min(370px, 45vw);
  padding: 8px;
  background: #fff;
  color: #111;
  font: 14px/18px system-ui;
  box-shadow: 0 2px 5px #0003;
}
.demo-drag-preview strong,
.demo-drag-preview em,
.demo-drag-preview span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.demo-drag-preview em {
  color: #666;
}
.demo-drag-preview span {
  color: #555;
}
.example-choices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
}
.example-choices button {
  padding: 7px 10px;
  font-size: 12px;
}
.example-choices [aria-pressed='true'] {
  border-color: var(--state-live);
}
figcaption {
  margin: 14px 0;
  font-size: 13px;
  line-height: 1.5;
}
.demo-play {
  padding: 7px 12px;
  font-size: 13px;
}
@media (prefers-reduced-motion: reduce) {
  .demo-pointer {
    display: none;
  }
  .demo-cursor {
    transition: none;
  }
}
</style>
