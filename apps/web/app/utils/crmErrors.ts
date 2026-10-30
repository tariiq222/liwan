import { CrmOpportunityWriteReasonSchema } from '@liwan/contracts'

import { saveErrorMessage } from './formFeedback'

type Translate = (key: string) => string

const WRITE_REASON_KEYS = {
  invalid_phone: 'invalidPhone',
  duplicate_phone: 'duplicatePhone',
  invalid_email: 'invalidEmail',
} as const

/**
 * What a refused CRM write says, in the user's words. The server answers 409 for a closed or changed opportunity,
 * 422 on `phone` or `email` with a `details.reason` code (invalid or duplicate phone, invalid email), on `stage_id` for the sold stage and on `discount_percent` for a discount that is not allowed, and 403 for a
 * discount above the ceiling when `sale` is set (every other 403 is a missing capability).
 */
export function crmErrorMessage(error: unknown, t: Translate, options: { sale?: boolean } = {}): string {
  const { status, field, details } = (error ?? {}) as { status?: number; field?: string; details?: Record<string, unknown> }
  if (status === 409) return t('crm.opportunities.errors.conflict')
  const reason = status === 422 ? CrmOpportunityWriteReasonSchema.safeParse(details?.reason) : null
  if (reason?.success) return t(`crm.opportunities.errors.${WRITE_REASON_KEYS[reason.data]}`)
  if (status === 422 && field === 'stage_id') return t('crm.opportunities.errors.stage')
  if (status === 422 && field === 'discount_percent') return t('crm.opportunities.errors.discount')
  if (status === 403) return t(options.sale ? 'crm.opportunities.errors.discountApproval' : 'crm.opportunities.errors.forbidden')
  return saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
}
