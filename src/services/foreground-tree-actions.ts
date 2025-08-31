import { SessionTree } from '@/services/foreground-tree'

export function deselectAllItems(): void {
  SessionTree.reactiveWindowsList.value.forEach((window) => {
    window.tabs.forEach((tab) => {
      tab.selected = false
    })
    window.selected = false
  })
}
