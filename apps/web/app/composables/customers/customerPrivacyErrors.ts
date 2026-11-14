import { CustomerEraseIncompleteDetailsSchema, type CustomerPrivacyIncomplete } from '@liwan/contracts'

interface Refusal { status?: number; code?: string; field?: string; details?: unknown }

/** What an erase or export refusal asks the user to do next. */
export type CustomerPrivacyRefusal =
  | { kind: 'incomplete'; incomplete: CustomerPrivacyIncomplete[] }
  | { kind: 'token' }
  | { kind: 'confirmation' }
  | { kind: 'reason' }
  | { kind: 'conflict' }
  | { kind: 'forbidden' }
  | { kind: 'missing' }
  | { kind: 'other' }

/** Reads a refused privacy request: every code the privacy routes answer has its own next step, anything else is `other`. */
export function customerPrivacyRefusal(error: unknown): CustomerPrivacyRefusal {
  const failure = error as Refusal | null
  if (failure?.status === 409 && failure.code === 'erase_incomplete') {
    const parsed = CustomerEraseIncompleteDetailsSchema.safeParse(failure.details)
    return parsed.success ? { kind: 'incomplete', incomplete: parsed.data.incomplete } : { kind: 'other' }
  }
  if (failure?.status === 409 && failure.code === 'conflict') return { kind: 'conflict' }
  if (failure?.status === 422 && failure.code === 'invalid_token') return { kind: 'token' }
  if (failure?.status === 422 && failure.field === 'confirmation') return { kind: 'confirmation' }
  if (failure?.status === 422 && failure.field === 'reason') return { kind: 'reason' }
  if (failure?.status === 403) return { kind: 'forbidden' }
  if (failure?.status === 404) return { kind: 'missing' }
  return { kind: 'other' }
}
