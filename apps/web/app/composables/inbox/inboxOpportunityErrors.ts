import { ConversationOpportunityConflictDetailsSchema } from '@liwan/contracts'
import { isCustomerAlreadyLinked } from '../customers/customerErrors'

type Translate = (key: string, values?: Record<string, unknown>) => string
interface Refusal { status?: number; code?: string; field?: string; details?: unknown }

/**
 * What a refused link or unlink of a conversation's opportunity says. A 409 `already_linked` means another opportunity
 * is linked (unlink it first); a 409 `conflict` names both customers when the contact and the opportunity belong to
 * different ones; 403 is an opportunity of another agent; 422 on `opportunity_id` is an archived opportunity or one of
 * another company.
 */
export function inboxOpportunityErrorMessage(error: unknown, t: Translate): string {
  const failure = (error ?? {}) as Refusal
  if (isCustomerAlreadyLinked(error)) return t('inbox.opportunity.errors.alreadyLinked')
  if (failure.status === 409 && failure.code === 'conflict') {
    const details = ConversationOpportunityConflictDetailsSchema.safeParse(failure.details)
    if (details.success) {
      const none = t('inbox.opportunity.errors.noCustomer')
      return t('inbox.opportunity.errors.customerMismatch', {
        contact: details.data.contact_customer?.name ?? none,
        opportunity: details.data.opportunity_customer?.name ?? none,
      })
    }
  }
  if (failure.status === 403) return t('inbox.opportunity.errors.notYours')
  if (failure.status === 422 && failure.field === 'opportunity_id') return t('inbox.opportunity.errors.unavailable')
  if (failure.status === 404) return t('inbox.opportunity.errors.missing')
  return t('errors.generic')
}
