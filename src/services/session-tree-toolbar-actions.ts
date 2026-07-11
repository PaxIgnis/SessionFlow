import * as Messages from '@/services/foreground-messages'
import { SessionTree } from '@/services/foreground-tree'
import { State } from '@/types/session-tree'

export function addRootNote(): void {
  Messages.createNote(undefined, SessionTree.reactiveItems.value.length)
}

export function addRootSeparator(): void {
  Messages.createSeparator(undefined, SessionTree.reactiveItems.value.length)
}

export async function createNewWindow(): Promise<void> {
  await browser.windows.create()
}

export async function createNewTab(): Promise<void> {
  const activeWindow = [...SessionTree.windowsByUid.values()].find(
    (window) => window.active && window.state === State.OPEN && window.id >= 0,
  )

  if (activeWindow) {
    await browser.tabs.create({ windowId: activeWindow.id })
    return
  }

  await browser.windows.create()
}

export async function openSettings(): Promise<void> {
  await browser.runtime.openOptionsPage()
}
