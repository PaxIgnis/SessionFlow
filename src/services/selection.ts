import * as Actions from '@/services/selection-actions'
import { SelectedItem, TreeItem } from '@/types/session-tree'
import { ref } from 'vue'

export const Selection = {
  selectedItems: ref<Array<SelectedItem>>([]),

  /*
   * The item a shift-click range extends from. Held separately because
   * selectedItems is rebuilt in tree order by every range fill, which would
   * otherwise move the anchor to whichever item sorts first.
   */
  anchor: ref<TreeItem | undefined>(undefined),

  ...Actions,
}
