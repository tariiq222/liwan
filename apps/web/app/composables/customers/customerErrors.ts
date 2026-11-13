import { CustomerConflictDetailsSchema, CustomerFieldRemovalDetailsSchema, type CustomerCandidate, type CustomerFieldRemovalDetails } from '@liwan/contracts'

interface Refusal { status?: number; code?: string; field?: string; details?: unknown }

/** The customers a create's 409 `conflict` offers, or null when the error is anything else. */
export function customerConflictCandidates(error: unknown): CustomerCandidate[] | null {
  const failure = error as Refusal | null
  if (failure?.status !== 409 || failure.code !== 'conflict') return null
  const parsed = CustomerConflictDetailsSchema.safeParse(failure.details)
  return parsed.success ? parsed.data.candidates : null
}

/** What a settings write would take from customers who still hold values (removed fields, removed options), or null for any other error. */
export function customerFieldRemoval(error: unknown): CustomerFieldRemovalDetails | null {
  const failure = error as Refusal | null
  if (failure?.status !== 409 || failure.code !== 'custom_field_values_exist') return null
  const parsed = CustomerFieldRemovalDetailsSchema.safeParse(failure.details)
  return parsed.success ? parsed.data : null
}

export type CustomerRemovalKind = 'fields' | 'options' | 'both'

/** Whether a refused write removes only fields, only options of fields that stay, or both: the confirmation words itself by it. */
export function customerRemovalKind(removal: CustomerFieldRemovalDetails): CustomerRemovalKind {
  if (!removal.options.length) return 'fields'
  return removal.fields.length ? 'both' : 'options'
}

/** The form field a create or edit refusal belongs to: the phone, the party kind (`is_company`) or the parent company; null for any other refusal. */
export function customerFormField(error: unknown): 'phone' | 'is_company' | 'parent_id' | null {
  const failure = error as Refusal | null
  if (failure?.status !== 422) return null
  if (failure.code === 'invalid_phone' || failure.field === 'phone') return 'phone'
  if (failure.field === 'is_company') return 'is_company'
  if (failure.field === 'parent_id') return 'parent_id'
  return null
}

/** A refusal of one custom field's value, keyed by the field's key; null for any other refusal. */
export function customerPropertyError(error: unknown): { key: string } | null {
  const failure = error as Refusal | null
  const prefix = 'properties.'
  if (failure?.status !== 422 || !failure.field?.startsWith(prefix)) return null
  return { key: failure.field.slice(prefix.length) }
}

/** Whether a settings write was refused because customers already exist, so the sharing mode cannot change yet. */
export function isSharingTransferRequired(error: unknown): boolean {
  const failure = error as Refusal | null
  return failure?.status === 409 && failure.code === 'sharing_transfer_required'
}
