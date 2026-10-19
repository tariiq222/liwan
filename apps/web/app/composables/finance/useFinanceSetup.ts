import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { FinanceSetupSchema, type FinanceSetup } from '@webvue/contracts'

export type { FinanceSetup }

export const financeSetupKey = ['finance', 'setup'] as const

export function useFinanceSetup(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: financeSetupKey,
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/finance/setup', { schema: FinanceSetupSchema }),
  })
}

/** Loads the Saudi chart of accounts into the company; the server answers with the refreshed setup. */
export function useLoadFinanceChart() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: () => $api('/api/v1/finance/setup/chart', { method: 'POST', schema: FinanceSetupSchema }),
    onSuccess: setup => qc.setQueryData(financeSetupKey, setup),
  })
}
