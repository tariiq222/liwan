import { saveErrorMessage } from './formFeedback'

type Translate = (key: string) => string

/**
 * What a refused CRM write says, in the user's words. The server answers 409 for a closed or changed opportunity,
 * 422 on `phone` for a duplicate and on `discount_percent` for a discount that is not allowed, and 403 for a
 * discount above the ceiling when `sale` is set (every other 403 is a missing capability).
 */
export function crmErrorMessage(error: unknown, t: Translate, options: { sale?: boolean } = {}): string {
  const { status, field } = (error ?? {}) as { status?: number; field?: string }
  if (status === 409) return t('crm.opportunities.errors.conflict')
  if (status === 422 && field === 'phone') return t('crm.opportunities.errors.duplicatePhone')
  if (status === 422 && field === 'discount_percent') return t('crm.opportunities.errors.discount')
  if (status === 403) return t(options.sale ? 'crm.opportunities.errors.discountApproval' : 'crm.opportunities.errors.forbidden')
  return saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
}
