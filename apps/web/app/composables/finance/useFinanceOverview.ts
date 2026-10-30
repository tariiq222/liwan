import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { FinanceAgedPartnerBalanceSchema, FinanceInvoiceListSchema } from '@liwan/contracts'
import { localIsoDay } from '@liwan/ui/app/utils/formatDate'

export type FinanceAgingKind = 'receivable' | 'payable'

export const financeOverviewKeys = {
  drafts: (limit: number) => ['finance', 'invoices', 'overview', 'drafts', limit] as const,
  aging: (kind: FinanceAgingKind, day: string) => ['finance', 'reports', 'aged', kind, day] as const,
}

/** Draft documents of every kind: `total` is the server count, `items` the newest `limit` rows (limit 1 for the tile alone). */
export function useFinanceDrafts(limit: number, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: financeOverviewKeys.drafts(limit),
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/finance/invoices', { query: { state: 'draft', limit }, schema: FinanceInvoiceListSchema }),
  })
}

/** Open balances as of today, aged from their due date; `totals.total` is what customers owe (receivable) or the company owes (payable). */
export function useFinanceAging(kind: FinanceAgingKind, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const day = localIsoDay()
  return useQuery({
    queryKey: financeOverviewKeys.aging(kind, day),
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/finance/reports/aged-partner-balance', { query: { date_to: day, kind }, schema: FinanceAgedPartnerBalanceSchema }),
  })
}
