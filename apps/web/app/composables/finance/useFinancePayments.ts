import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  FinanceJournalListSchema,
  FinancePaymentListSchema,
  FinancePaymentSchema,
  type FinancePaymentAllocate,
  type FinancePaymentPatch,
  type FinancePaymentRegister,
  type FinancePaymentStandalone,
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

/** The key stays with the form instance, so a retry after a lost answer replays the first request instead of booking a second payment. */
export function useCreateStandalonePayment() {
  const { $api } = useApi()
  const key = crypto.randomUUID()
  return usePaymentWrite((body: FinancePaymentStandalone) =>
    $api('/api/v1/finance/payments/standalone', { method: 'POST', body, headers: { 'Idempotency-Key': key }, schema: FinancePaymentSchema }))
}

export function useFinancePaymentPost() {
  const { $api } = useApi()
  return usePaymentWrite((id: number) => $api(`/api/v1/finance/payments/${id}/post`, { method: 'POST', body: {}, schema: FinancePaymentSchema }))
}

export function useFinancePaymentAllocate() {
  const { $api } = useApi()
  return usePaymentWrite(({ id, body }: { id: number; body: FinancePaymentAllocate }) =>
    $api(`/api/v1/finance/payments/${id}/allocate`, { method: 'POST', body, schema: FinancePaymentSchema }))
}

export function useFinancePaymentUnallocate() {
  const { $api } = useApi()
  return usePaymentWrite((id: number) => $api(`/api/v1/finance/payments/${id}/unallocate`, { method: 'POST', body: {}, schema: FinancePaymentSchema }))
}

/** Edits a draft payment (for example after a reset to draft): amount, date, journal and memo. */
export function usePatchFinancePayment() {
  const { $api } = useApi()
  return usePaymentWrite(({ id, body }: { id: number; body: FinancePaymentPatch }) =>
    $api(`/api/v1/finance/payments/${id}`, { method: 'PATCH', body, schema: FinancePaymentSchema }))
}
