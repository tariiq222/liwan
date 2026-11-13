import { ref, watch } from 'vue'
import type { Customer, CustomFieldValues, CustomFieldWithValue } from '@liwan/contracts'
import { customerFormField } from './customerErrors'

/**
 * Whether a new `customer` prop replaces what the user typed. A refetch (window focus) hands the form a new object for
 * the same customer: it only replaces the draft when nothing was typed, so unsaved input is never wiped. Another
 * customer, or the first one, always resets.
 */
export function shouldResetCustomerDraft(previous: Customer | null | undefined, next: Customer | null | undefined, dirty: boolean): boolean {
  return previous?.id !== next?.id || !dirty
}

/**
 * Whether the form's top alert shows a refusal. A refusal that belongs to a field is shown at that field, but only
 * when that field is on the form; otherwise the top alert shows it, so the user always sees it.
 */
export function topAlertVisible(error: unknown, rendered: { kind: boolean; parent: boolean }, hasPropertyError: boolean): boolean {
  if (!error || hasPropertyError) return false
  const field = customerFormField(error)
  if (field === 'phone') return false
  if (field === 'is_company') return !rendered.kind
  if (field === 'parent_id') return !rendered.parent
  return true
}

/**
 * The values the user changed in the custom field rows, and the refusals shown under them. The rows reset their own
 * draft when the definition changes; the values collected here are cleared with it, so the body never sends a value
 * for a field the user no longer sees.
 */
export function useCustomerFormFields(fields: () => CustomFieldWithValue[]) {
  const changed = ref<CustomFieldValues>({})
  const dirty = ref(false)
  const errors = ref<Record<string, string>>({})
  watch(() => JSON.stringify(fields().map(field => [field.key, field.type, field.options, field.value])), () => {
    changed.value = {}
    dirty.value = false
    errors.value = {}
  })
  function change(values: CustomFieldValues) {
    changed.value = values
    errors.value = {}
  }
  return { changed, dirty, errors, change }
}
