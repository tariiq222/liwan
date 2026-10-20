import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useQuery } from '@tanstack/vue-query'
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
