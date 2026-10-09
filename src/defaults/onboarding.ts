export const ONBOARDING_FEATURES = [
  {
    id: 'states',
    title: 'onboardingStates',
    description: 'onboardingReadTreeDescription',
  },
  {
    id: 'open',
    title: 'onboardingOpen',
    description: 'onboardingOpenDescription',
  },
  {
    id: 'focus',
    title: 'onboardingFocus',
    description: 'onboardingFocusDescription',
  },
  {
    id: 'close',
    title: 'onboardingClose',
    description: 'onboardingCloseDescription',
  },
  {
    id: 'save',
    title: 'onboardingSave',
    description: 'onboardingSaveDescription',
  },
  {
    id: 'organize',
    title: 'onboardingOrganize',
    description: 'onboardingOrganizeDescription',
  },
  {
    id: 'multi-select',
    title: 'onboardingMultiSelect',
    description: 'onboardingMultiSelectDescription',
  },
  {
    id: 'labels',
    title: 'onboardingLabels',
    description: 'onboardingLabelsDescription',
  },
  {
    id: 'note-add',
    title: 'onboardingNoteAdd',
    description: 'onboardingNoteAddDescription',
  },
  {
    id: 'note-edit',
    title: 'onboardingNoteEdit',
    description: 'onboardingNoteEditDescription',
  },
  {
    id: 'note-group',
    title: 'onboardingNoteGroup',
    description: 'onboardingNoteGroupDescription',
  },
  {
    id: 'window-bar',
    title: 'onboardingWindowBar',
    description: 'onboardingWindowBarDescription',
  },
  {
    id: 'tab-groups',
    title: 'onboardingTabGroups',
    description: 'onboardingTabGroupsDescription',
  },
  {
    id: 'containers',
    title: 'onboardingContainers',
    description: 'onboardingContainersDescription',
  },
] as const

export type OnboardingFeatureId = (typeof ONBOARDING_FEATURES)[number]['id']
