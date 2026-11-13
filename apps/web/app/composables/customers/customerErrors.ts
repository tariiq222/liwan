import { CustomerConflictDetailsSchema, CustomerFieldRemovalDetailsSchema, type CustomerCandidate, type CustomerFieldRemovalDetails } from '@liwan/contracts'

interface Refusal { status?: number; code?: string; field?: string; details?: unknown }

/** The customers a create's 409 `conflict` offers, or null when the error is anything else. */
export function customerConflictCandidates(error: unknown): CustomerCandidate[] | null {
  const failure = error as Refusal | null
  if (failure?.status !== 409 || failure.code !== 'conflict') return null
  const parsed = CustomerConflictDetailsSchema.safeParse(failure.details)
  return parsed.success ? parsed.data.candidates : null
}

/** The fields (with their value counts) a settings write would remove while customers still hold values, or null for any other error. */
export function customerFieldRemoval(error: unknown): CustomerFieldRemovalDetails['fields'] | null {
  const failure = error as Refusal | null
  if (failure?.status !== 409 || failure.code !== 'custom_field_values_exist') return null
  const parsed = CustomerFieldRemovalDetailsSchema.safeParse(failure.details)
  return parsed.success ? parsed.data.fields : null
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
