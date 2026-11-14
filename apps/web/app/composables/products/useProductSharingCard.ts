import { ref, watch } from 'vue'
import type { ProductSettings } from '@liwan/contracts'
import { useSettingsForm } from '../settings/useSettingsForm'
import { isProductSharingTransferRequired } from './productErrors'
import { useSaveProductSettings } from './useProductSettings'

/**
 * The sharing card's draft. While products exist the server refuses a change of mode (409 `sharing_transfer_required`):
 * the card then keeps the saved value, resets its draft to it and raises `transferRequired` until the user picks again.
 */
export function useProductSharingCard(options: { settings: () => ProductSettings; reload: () => Promise<ProductSettings> }) {
  const { mutateAsync: saveSettings } = useSaveProductSettings()
  const transferRequired = ref(false)
  const form = useSettingsForm({
    source: options.settings,
    read: ({ sharing }) => ({ sharing }),
    save: async ({ sharing }, latest) => {
      transferRequired.value = false
      try {
        return await saveSettings({ revision: latest.revision, sharing })
      } catch (error) {
        if (!isProductSharingTransferRequired(error)) throw error
        transferRequired.value = true
        // Handing back the settings as they were resets the draft to the old value.
        return latest
      }
    },
    reload: options.reload,
  })
  // The refusal resets the draft to the saved mode, which is not a new choice; picking another mode clears the message.
  watch(() => form.draft.value.sharing, (mode) => { if (mode !== options.settings().sharing) transferRequired.value = false })
  return { ...form, transferRequired }
}
