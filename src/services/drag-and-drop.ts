import * as Actions from '@/services/drag-and-drop-actions'
import { DragInfo, DragState } from '@/types/session-tree'

export const DragAndDrop = {
  dragState: {
    dragEventStarted: false,
    sourceType: null,
    destinationId: null,
    destinationType: null,
    isValidDropTarget: false,
    prevEl: null,
  } as DragState,
  dragInfo: null as DragInfo | null,

  ...Actions,
}
