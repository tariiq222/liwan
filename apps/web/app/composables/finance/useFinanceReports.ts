import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useQuery } from '@tanstack/vue-query'
import { FinanceVatReturnItemListSchema } from '@webvue/contracts'
import { REPORTS, type ReportSlug } from '@/components/finance/reports/reportConfig'
import type { ReportParams } from '@/components/finance/reports/reportParams'

export const financeReportKeys = {
  report: (slug: ReportSlug, params: ReportParams) => ['finance', 'reports', slug, params] as const,
}

/**
 * One finance report with its filters. Moving between pages of the same report keeps the previous answer on screen; another
 * report never shows the last one's data.
 */
export function useFinanceReport(slug: MaybeRefOrGetter<ReportSlug>, params: MaybeRefOrGetter<ReportParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeReportKeys.report(toValue(slug), toValue(params))),
    enabled: computed(() => toValue(enabled)),
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === toValue(slug) ? previous : undefined,
    queryFn: () => $api(`/api/v1/finance/reports/${toValue(slug)}`, { query: { ...toValue(params) }, schema: REPORTS[toValue(slug)].schema }),
  })
}

export const VAT_RETURN_ITEMS_PAGE_SIZE = 25

/** The journal items behind one column of one VAT return box, for the period; asked only once a figure is opened. */
export function useFinanceVatReturnItems(
  selection: MaybeRefOrGetter<{ code: string; column: 'base' | 'tax'; page: number; dateFrom: string; dateTo: string } | null>,
  enabled: MaybeRefOrGetter<boolean> = true,
) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ['finance', 'reports', 'vat-return', 'items', toValue(selection)] as const),
    enabled: computed(() => toValue(enabled) && toValue(selection) !== null),
    placeholderData: keepPreviousData,
    queryFn: () => {
      const { code, column, page, dateFrom, dateTo } = toValue(selection)!
      return $api('/api/v1/finance/reports/vat-return/items', {
        query: { code, column, date_from: dateFrom, date_to: dateTo, limit: VAT_RETURN_ITEMS_PAGE_SIZE, offset: (page - 1) * VAT_RETURN_ITEMS_PAGE_SIZE },
        schema: FinanceVatReturnItemListSchema,
      })
    },
  })
}
