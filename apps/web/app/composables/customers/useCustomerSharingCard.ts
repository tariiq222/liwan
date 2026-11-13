import { ref, watch } from 'vue'
import type { CustomerSettings } from '@liwan/contracts'
import { useSettingsForm } from '../settings/useSettingsForm'
import { isSharingTransferRequired } from './customerErrors'
import { useSaveCustomerSettings } from './useCustomerSettings'

/**
 * The sharing card's draft. While customers exist the server refuses a change of mode (409 `sharing_transfer_required`):
 * the card then keeps the saved value, resets its draft to it and raises `transferRequired` until the user picks again.
 */
export function useCustomerSharingCard(options: { settings: () => CustomerSettings; reload: () => Promise<CustomerSettings> }) {
  const { mutateAsync: saveSettings } = useSaveCustomerSettings()
  const transferRequired = ref(false)
  const form = useSettingsForm({
    source: options.settings,
    read: ({ sharing }) => ({ sharing }),
    save: async ({ sharing }, latest) => {
      transferRequired.value = false
      try {
        return await saveSettings({ revision: latest.revision, sharing })
      } catch (error) {
        if (!isSharingTransferRequired(error)) throw error
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
