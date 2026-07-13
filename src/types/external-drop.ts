export interface ExternalDropItem {
  url: string
  title?: string
}

export interface ExternalDropPayload {
  items: ExternalDropItem[]
  firefoxTabIds: number[]
}
