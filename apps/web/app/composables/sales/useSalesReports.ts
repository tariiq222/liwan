import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/vue-query'
import { SalesReportBreakdownSchema, SalesReportSummarySchema } from '@liwan/contracts'
import { saveBlob } from '../../utils/saveBlob'
import { salesKeys } from './salesKeys'
import { salesReportBreakdownQuery, salesReportFilters, salesReportSummaryQuery, type SalesReportState } from './salesReportParams'

export const SALES_REPORT_EXPORT_PATH = '/api/v1/sales/reports/export'
const FALLBACK_FILENAME = 'sales-report.csv'

/** Orders and amounts of the documents the caller reads, one group per state, under the page's filters. Nothing is asked while `enabled` is false (the caller lacks the capabilities). */
export function useSalesReportSummary(state: MaybeRefOrGetter<SalesReportState>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => salesKeys.report('summary', salesReportSummaryQuery(toValue(state)))),
    enabled: computed(() => toValue(enabled)),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/sales/reports/summary', { query: salesReportSummaryQuery(toValue(state)), schema: SalesReportSummarySchema }),
  })
}

/** One page of the groups of the page's dimension. */
export function useSalesReportBreakdown(state: MaybeRefOrGetter<SalesReportState>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => salesKeys.report('breakdown', salesReportBreakdownQuery(toValue(state)))),
    enabled: computed(() => toValue(enabled)),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/sales/reports/breakdown', { query: salesReportBreakdownQuery(toValue(state)), schema: SalesReportBreakdownSchema }),
  })
}

/** Downloads the detail rows behind the page's filters as CSV, named by the server. Paging and the dimension are not filters. */
export function useSalesReportExport() {
  const { $download } = useApi()
  return useMutation({
    mutationFn: async (state: SalesReportState) => {
      const { blob, filename } = await $download(SALES_REPORT_EXPORT_PATH, { query: salesReportFilters(state) })
      saveBlob(blob, filename ?? FALLBACK_FILENAME)
    },
  })
}
