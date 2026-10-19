import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  FinanceJournalListSchema,
  FinancePaymentListSchema,
  FinancePaymentSchema,
  type FinancePaymentRegister,
} from '@webvue/contracts'
import { financeInvoiceKeys } from './useFinanceInvoices'

export const financePaymentKeys = {
  all: ['finance', 'payments'] as const,
  list: (params: Record<string, unknown>) => ['finance', 'payments', 'list', params] as const,
  journals: ['finance', 'journals', 'payment'] as const,
}

export function useFinancePayments(params: MaybeRefOrGetter<Record<string, unknown>>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financePaymentKeys.list(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/finance/payments', { query: toValue(params), schema: FinancePaymentListSchema }),
  })
}

const PAYMENT_JOURNAL_TYPES = ['bank', 'cash', 'credit']

/** Bank, cash and card journals: the only ones a payment can be registered in. */
export function useFinancePaymentJournals(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: financePaymentKeys.journals,
    enabled: computed(() => toValue(enabled)),
    queryFn: async () => {
      const journals = await $api('/api/v1/finance/journals', { query: { limit: 200 }, schema: FinanceJournalListSchema })
      return journals.items.filter(journal => PAYMENT_JOURNAL_TYPES.includes(journal.type))
    },
  })
}

function usePaymentWrite<T, R>(request: (input: T) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: request,
    // A payment changes the documents it pays: both lists refresh from the server.
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: financePaymentKeys.all }),
      qc.invalidateQueries({ queryKey: financeInvoiceKeys.all }),
    ]),
  })
}

export function useRegisterFinancePayment() {
  const { $api } = useApi()
  return usePaymentWrite((body: FinancePaymentRegister) => $api('/api/v1/finance/payments', { method: 'POST', body, schema: FinancePaymentSchema }))
}

export function useFinancePaymentTransition() {
  const { $api } = useApi()
  return usePaymentWrite(({ id, action }: { id: number; action: 'cancel' | 'reset-to-draft' }) =>
    $api(`/api/v1/finance/payments/${id}/${action}`, { method: 'POST', body: {}, schema: FinancePaymentSchema }))
}
