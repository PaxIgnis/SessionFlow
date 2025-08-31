import * as Actions from '@/services/selection-actions'
import { SelectedItem } from '@/types/session-tree'
import { ref } from 'vue'

export const Selection = {
  selectedItems: ref<Array<SelectedItem>>([]),

  ...Actions,
}
