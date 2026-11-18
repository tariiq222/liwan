import { CrmOpportunityWriteReasonSchema } from '@liwan/contracts'

import { saveErrorMessage } from './formFeedback'

type Translate = (key: string) => string

const WRITE_REASON_KEYS = {
  invalid_phone: 'invalidPhone',
  duplicate_phone: 'duplicatePhone',
  invalid_email: 'invalidEmail',
} as const

const ORDER_REASON_KEYS = { crm_opportunity_closed: 'orderClosed', crm_opportunity_without_customer: 'orderNoCustomer' } as const

const STAGE_REASON_KEYS = {
  stage_has_opportunities: 'hasOpportunities',
  won_stage_required: 'wonRequired',
  won_stage_has_opportunities: 'wonHasOpportunities',
  first_stage_open: 'firstOpen',
  invalid_move_target: 'moveTarget',
} as const

/** Whether a refused stage archive only needs a target stage for its opportunities. */
export function stageNeedsMoveTarget(error: unknown): boolean {
  const { status, details } = (error ?? {}) as { status?: number; details?: Record<string, unknown> }
  return status === 422 && details?.reason === 'stage_has_opportunities'
}

/** What a refused CRM settings-list write says (stages today): a 422 `details.reason` names what blocks, anything else is the generic save text. */
export function crmListErrorMessage(error: unknown, t: Translate): string {
  const { status, details } = (error ?? {}) as { status?: number; details?: Record<string, unknown> }
  const key = status === 422 && typeof details?.reason === 'string' ? STAGE_REASON_KEYS[details.reason as keyof typeof STAGE_REASON_KEYS] : undefined
  return key ? t(`crm.settings.stages.errors.${key}`) : saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
}

/**
 * What a refused CRM write says, in the user's words. The server answers 409 for a closed or changed opportunity,
 * 403 `feature_not_included` when the plan has no Sales (the quotation routes), 404 for an opportunity that is gone or hidden, 409 with
 * `details.reason` `crm_win_by_order` for a package win while an order wins, 422 on `phone` or `email` with a `details.reason` code (invalid or duplicate phone, invalid email), on `stage_id` for the sold stage and on `discount_percent` for a discount that is not allowed, and 403 for a
 * discount above the ceiling when `sale` is set (every other 403 is a missing capability).
 */
export function crmErrorMessage(error: unknown, t: Translate, options: { sale?: boolean } = {}): string {
  const { status, code, field, details } = (error ?? {}) as { status?: number; code?: string; field?: string; details?: Record<string, unknown> }
  if (status === 409 && details?.reason === 'crm_win_by_order') return t('crm.opportunities.errors.winByOrder')
  if (status === 403 && code === 'feature_not_included') return t('crm.opportunities.errors.noSales')
  if (status === 404) return t('crm.opportunities.errors.notFound')
  if (status === 409 && code === 'already_linked') return t('crm.opportunities.errors.alreadyLinked')
  if (status === 409) return t('crm.opportunities.errors.conflict')
  const reason = status === 422 ? CrmOpportunityWriteReasonSchema.safeParse(details?.reason) : null
  if (reason?.success) return t(`crm.opportunities.errors.${WRITE_REASON_KEYS[reason.data]}`)
  const orderReason = status === 422 && typeof details?.reason === 'string' ? ORDER_REASON_KEYS[details.reason as keyof typeof ORDER_REASON_KEYS] : undefined
  if (orderReason) return t(`crm.opportunities.errors.${orderReason}`)
  if (status === 422 && field === 'stage_id') return t('crm.opportunities.errors.stage')
  if (status === 422 && field === 'discount_percent') return t('crm.opportunities.errors.discount')
  if (status === 403) return t(options.sale ? 'crm.opportunities.errors.discountApproval' : 'crm.opportunities.errors.forbidden')
  return saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
}
