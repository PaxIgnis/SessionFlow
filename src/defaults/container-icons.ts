export const FIREFOX_CONTAINER_ICON_IDS = [
  'briefcase',
  'bullhorn',
  'cart',
  'chill',
  'circle',
  'dollar',
  'fence',
  'fingerprint',
  'folder',
  'food',
  'fruit',
  'gift',
  'hat',
  'pet',
  'tree',
  'vacation',
  'wallet',
] as const

const firefoxContainerIconIds = new Set<string>(FIREFOX_CONTAINER_ICON_IDS)

export function isKnownFirefoxContainerIcon(icon: string): boolean {
  return firefoxContainerIconIds.has(icon)
}
