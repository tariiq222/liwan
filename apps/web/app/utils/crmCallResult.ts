import type { CrmOpportunity } from '@liwan/contracts'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { relativeTime } from './crmOpportunity'

type Translate = (key: string, named?: Record<string, unknown>) => string

/** What a recorded call tells the agent: when the next call is due, or that the opportunity was sold or the call recorded. */
export function callRecordedText(opportunity: Pick<CrmOpportunity, 'next_call_at' | 'status'>, t: Translate, locale: string): string {
  const next = opportunity.next_call_at
  if (next) return t('crm.opportunities.call.nextCall', { relative: relativeTime(next, Date.now(), locale), absolute: formatDateTime(next) })
  return t(opportunity.status === 'won' ? 'crm.opportunities.sale.sold' : 'crm.opportunities.call.recorded')
}
