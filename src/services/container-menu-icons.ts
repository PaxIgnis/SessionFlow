import { isKnownFirefoxContainerIcon } from '@/defaults/container-icons'
import type { ContainerMetadata } from '@/types/session-tree'

let iconDocument: Promise<Document> | undefined

/** Reuses the same Mozilla icon artwork as the tree, in its container color. */
export async function containerMenuIcon(
  container: ContainerMetadata,
): Promise<string> {
  const color = /^#[\da-f]{6}$/i.test(container.colorCode)
    ? container.colorCode
    : '#777777'
  let artwork = '<circle cx="16" cy="16" r="12"/>'
  if (isKnownFirefoxContainerIcon(container.icon)) {
    try {
      iconDocument ??= fetch(browser.runtime.getURL('/icons/usercontext.svg'))
        .then(async (response) => {
          if (!response.ok) throw new Error('Container icon asset unavailable')
          return new DOMParser().parseFromString(
            await response.text(),
            'image/svg+xml',
          )
        })
        .catch((error) => {
          iconDocument = undefined
          throw error
        })
      const element = (await iconDocument).getElementById(container.icon)
      if (element) artwork = new XMLSerializer().serializeToString(element)
    } catch {
      // Still show the container color if its artwork cannot be loaded.
    }
  }
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16" fill="${color}">${artwork}</svg>`,
  )}`
}
