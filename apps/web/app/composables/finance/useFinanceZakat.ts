import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { FinanceZakatAdjustmentSchema, FinanceZakatReviewSchema, type FinanceZakatAdjustmentInput, type FinanceZakatReviewInput } from '@webvue/contracts'

// The Zakat workpaper of a fiscal year: the company's adjustments to the base and the accountant's review. The report carries
// both, so a write refreshes the finance reports; nothing here files anything.
function useZakatWrite<T, R>(request: (input: T) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: request, onSuccess: () => qc.invalidateQueries({ queryKey: ['finance', 'reports', 'zakat-base'] }) })
}

export function useAddZakatAdjustment() {
  const { $api } = useApi()
  return useZakatWrite((body: FinanceZakatAdjustmentInput) => $api('/api/v1/finance/zakat/adjustments', { method: 'POST', body, schema: FinanceZakatAdjustmentSchema }))
}

export function useRemoveZakatAdjustment() {
  const { $api } = useApi()
  return useZakatWrite((id: number) => $api(`/api/v1/finance/zakat/adjustments/${id}`, { method: 'DELETE' }))
}

export function useReviewZakat() {
  const { $api } = useApi()
  return useZakatWrite((body: FinanceZakatReviewInput) => $api('/api/v1/finance/zakat/reviews', { method: 'POST', body, schema: FinanceZakatReviewSchema }))
}
