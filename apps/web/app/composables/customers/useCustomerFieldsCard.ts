import { ref, watch } from 'vue'
import type { CustomerFieldRemovalDetails, CustomerSettings, CustomFieldDefinitionPatchItem } from '@liwan/contracts'
import { ApiError } from '../useApi'
import { useSettingsForm } from '../settings/useSettingsForm'
import { customerFieldRemoval, customerRemovalKind, type CustomerRemovalKind } from './customerErrors'
import { useSaveCustomerSettings } from './useCustomerSettings'

/**
 * The fields card's draft. A write that removes fields, or options of a field, that customers still hold values for is
 * refused (409 `custom_field_values_exist`) with the count per field and per option: the card keeps its draft, raises `removal` for the user to
 * read, and `confirmRemoval()` repeats the write with `confirm_field_removal`.
 */
export function useCustomerFieldsCard(options: { settings: () => CustomerSettings; reload: () => Promise<CustomerSettings>; removalMessage: (kind: CustomerRemovalKind) => string }) {
  const { mutateAsync: saveSettings } = useSaveCustomerSettings()
  const removal = ref<CustomerFieldRemovalDetails | null>(null)
  let confirmed = false
  const form = useSettingsForm({
    source: options.settings,
    read: ({ fields }): { fields: CustomFieldDefinitionPatchItem[] } => ({ fields }),
    save: async ({ fields }, latest) => {
      const confirm = confirmed
      confirmed = false
      removal.value = null
      try {
        return await saveSettings({ revision: latest.revision, fields, ...(confirm ? { confirm_field_removal: true as const } : {}) })
      } catch (error) {
        const withValues = customerFieldRemoval(error)
        if (!withValues) throw error
        removal.value = withValues
        throw new ApiError(409, 'custom_field_values_exist', options.removalMessage(customerRemovalKind(withValues)))
      }
    },
    reload: options.reload,
  })
  // A removal list belongs to the definition it was asked for; an edit makes it stale.
  watch(() => form.draft.value.fields, () => { removal.value = null }, { deep: true })
  // The confirmation belongs to this one save: when the form refuses to write (locked, saving, not dirty) it is dropped
  // here, so it can never ride on a later ordinary save.
  async function confirmRemoval() {
    confirmed = true
    try {
      await form.save()
    } finally {
      confirmed = false
    }
  }
  function cancelRemoval() {
    confirmed = false
    removal.value = null
  }
  function revert() {
    confirmed = false
    removal.value = null
    form.revert()
  }
  return { ...form, revert, removal, confirmRemoval, cancelRemoval }
}
