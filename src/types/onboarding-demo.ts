export type ExampleTabState = 'active' | 'live' | 'unloaded' | 'saved'
export type OnboardingDemoAction =
  | 'open'
  | 'focus'
  | 'organize'
  | 'multi-select'
  | 'labels'
  | 'save'
  | 'close'
  | 'note-add'
  | 'note-edit'
  | 'note-group'
  | 'window-bar'
  | 'tab-groups'
  | 'containers'

/** Local examples only; these items are never sent to the background tree. */
export interface OnboardingExampleItem {
  id: string
  kind: 'tab' | 'window' | 'note' | 'separator'
  title: string
  customLabel?: string
  selected?: boolean
  contextMenu?: boolean
  state?: ExampleTabState
  indentLevel: number
  collapsed?: boolean
  actions?: boolean
  showActions?: boolean
  drop?: 'above' | 'mid' | 'below'
  url?: string
  tabGroup?: Pick<TabGroupMetadata, 'title' | 'color'>
  container?: ContainerMetadata
}

export interface ExampleWindowComposition {
  open: number
  unloaded: number
  saved: number
}
import type { ContainerMetadata, TabGroupMetadata } from './session-tree'
