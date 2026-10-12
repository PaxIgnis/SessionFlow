import { FIREFOX_CONTAINER_ICON_IDS } from '@/defaults/container-icons'

export interface ContainerColorChoice {
  color: string
  colorCode: string
}

// Older Firefox versions do not expose the supported-choice APIs.
const fallbackColors: ContainerColorChoice[] = [
  { color: 'blue', colorCode: '#37adff' },
  { color: 'turquoise', colorCode: '#00c79a' },
  { color: 'green', colorCode: '#51cd00' },
  { color: 'yellow', colorCode: '#ffcb00' },
  { color: 'orange', colorCode: '#ff9f00' },
  { color: 'red', colorCode: '#ff613d' },
  { color: 'pink', colorCode: '#ff4bda' },
  { color: 'purple', colorCode: '#af51f5' },
  { color: 'toolbar', colorCode: '#7c7c7d' },
]
const fallbackIcons = FIREFOX_CONTAINER_ICON_IDS.filter(
  (icon) => !['bullhorn', 'folder', 'hat', 'wallet'].includes(icon),
)

type SupportedChoiceApi = typeof browser.contextualIdentities & {
  getSupportedColors?: () => Promise<ContainerColorChoice[]>
  getSupportedIcons?: () => Promise<{ icon: string; iconUrl: string }[]>
}

export function defaultContainerChoices() {
  return {
    colors: fallbackColors.slice(),
    icons: fallbackIcons.slice() as string[],
  }
}

export async function supportedContainerChoices() {
  const api = browser.contextualIdentities as SupportedChoiceApi
  const defaults = defaultContainerChoices()
  const [colors, icons] = await Promise.allSettled([
    api.getSupportedColors?.() ?? Promise.resolve(defaults.colors),
    api
      .getSupportedIcons?.()
      .then((choices) => choices.map(({ icon }) => icon)) ??
      Promise.resolve(defaults.icons),
  ])
  return {
    colors:
      colors.status === 'fulfilled' && colors.value.length
        ? colors.value
        : defaults.colors,
    icons:
      icons.status === 'fulfilled' && icons.value.length
        ? icons.value
        : defaults.icons,
  }
}
