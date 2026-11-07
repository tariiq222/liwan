import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { keepPreviousData, useQuery } from '@tanstack/vue-query'
import {
  FinanceInvoiceSummarySchema, FinanceEntrySummarySchema, FinanceAssetSummarySchema, FinanceBudgetSummarySchema,
} from '@liwan/contracts'
import type { z } from 'zod'

type Filters = Record<string, string | number | undefined>
const schemas = {
  invoices: FinanceInvoiceSummarySchema,
  entries: FinanceEntrySummarySchema,
  assets: FinanceAssetSummarySchema,
  budgets: FinanceBudgetSummarySchema,
}
type Resource = keyof typeof schemas

function useFinanceSummary<T>(resource: Resource, schema: z.ZodType<T>, params: MaybeRefOrGetter<Filters>) {
  const { $api } = useApi()
  const filters = computed(() => {
    const { state: _state, page: _page, limit: _limit, offset: _offset, sort: _sort, ...rest } = toValue(params)
    return rest
  })
  return useQuery({
    queryKey: computed(() => ['finance', resource, 'summary', filters.value] as const),
    placeholderData: keepPreviousData,
    // Read the key's snapshot rather than reactive filters after the request has started.
    queryFn: ({ queryKey, signal }) => $api(`/api/v1/finance/${resource}/summary`, {
      query: { ...queryKey[3] }, signal, schema,
    }),
  })
}

export const useFinanceInvoiceSummary = (params: MaybeRefOrGetter<Filters>) => useFinanceSummary('invoices', schemas.invoices, params)
export const useFinanceEntrySummary = (params: MaybeRefOrGetter<Filters>) => useFinanceSummary('entries', schemas.entries, params)
export const useFinanceAssetSummary = (params: MaybeRefOrGetter<Filters>) => useFinanceSummary('assets', schemas.assets, params)
export const useFinanceBudgetSummary = (params: MaybeRefOrGetter<Filters>) => useFinanceSummary('budgets', schemas.budgets, params)
