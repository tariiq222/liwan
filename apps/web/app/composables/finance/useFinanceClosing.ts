import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { FinanceClosingPreviewSchema, FinanceFiscalYearListSchema, FinanceFiscalYearSchema } from '@liwan/contracts'
import { financeSetupKey } from './useFinanceSetup'

export const financeClosingKeys = {
  all: ['finance', 'closing'] as const,
  years: ['finance', 'closing', 'years'] as const,
  preview: (year: number) => ['finance', 'closing', 'preview', year] as const,
}

export function useFinanceFiscalYears(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: financeClosingKeys.years,
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/finance/fiscal-years', { schema: FinanceFiscalYearListSchema }),
  })
}

/** What closing an open year would post, and why it cannot be closed yet. */
export function useFinanceClosingPreview(year: MaybeRefOrGetter<number | null>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeClosingKeys.preview(toValue(year) ?? 0)),
    enabled: computed(() => !!toValue(year) && toValue(enabled)),
    queryFn: () => $api(`/api/v1/finance/fiscal-years/${toValue(year)}/closing-preview`, { schema: FinanceClosingPreviewSchema }),
  })
}

/** The close posts the closing entry and moves the fiscal-year lock date, so the years, the previews and the setup refresh from the server. */
export function useCloseFiscalYear() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (year: number) => $api(`/api/v1/finance/fiscal-years/${year}/close`, { method: 'POST', body: {}, schema: FinanceFiscalYearSchema }),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: financeClosingKeys.all }),
      qc.invalidateQueries({ queryKey: financeSetupKey }),
      qc.invalidateQueries({ queryKey: ['finance', 'audit'] }),
    ]),
  })
}
