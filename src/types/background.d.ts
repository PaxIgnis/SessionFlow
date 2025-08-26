import type { Window as SessionWindow } from '@/types/session-tree'

declare global {
  interface Window {
    getSessionTree?: () => Array<SessionWindow>
    setSessionTree?: (windows: Array<SessionWindow>) => void
    resetSessionTree?: () => void
  }
}
export {}
