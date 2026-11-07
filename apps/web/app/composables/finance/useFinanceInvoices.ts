import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQueries, useQuery, useQueryClient, keepPreviousData } from '@tanstack/vue-query'
import {
  FinanceInvoiceDetailSchema,
  FinanceInvoiceListSchema,
  FinancePartnerListSchema,
  FinanceZatcaSubmissionSchema,
  type FinanceCreditNoteCreate,
  type FinanceDebitNoteCreate,
  type FinanceInvoiceCreate,
  type FinanceInvoiceDetail,
  type FinanceInvoicePatch,
} from '@liwan/contracts'
import type { InvoiceListParams } from '@/components/finance/invoices/invoiceListParams'

export const financeInvoiceKeys = {
  all: ['finance', 'invoices'] as const,
  list: (params: InvoiceListParams) => ['finance', 'invoices', 'list', params] as const,
  record: (id: number) => ['finance', 'invoices', 'record', id] as const,
  partners: (kind: PartnerPickerKind, q: string) => ['finance', 'partners', 'picker', kind, q] as const,
}

export type PartnerPickerKind = 'customer' | 'vendor' | 'any'

/** One page of documents; the KPI counts come from the filtered summary endpoint. */
export function useFinanceInvoiceList(params: MaybeRefOrGetter<InvoiceListParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeInvoiceKeys.list(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    placeholderData: keepPreviousData,
    queryFn: ({ queryKey, signal }) => $api('/api/v1/finance/invoices', { query: { ...queryKey[3] }, signal, schema: FinanceInvoiceListSchema }),
  })
}

export function useFinanceInvoice(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeInvoiceKeys.record(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    queryFn: ({ queryKey, signal }) => $api(`/api/v1/finance/invoices/${queryKey[3]}`, { signal, schema: FinanceInvoiceDetailSchema }),
  })
}

/** Several documents by id (the register-payment link carries ids): each is its own cached record. */
export function useFinanceInvoicesByIds(ids: MaybeRefOrGetter<readonly number[]>) {
  const { $api } = useApi()
  return useQueries({
    queries: computed(() => toValue(ids).map(id => ({
      queryKey: financeInvoiceKeys.record(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => $api(`/api/v1/finance/invoices/${id}`, { signal, schema: FinanceInvoiceDetailSchema }),
    }))),
    combine: results => ({
      records: results.flatMap(result => result.data ? [result.data] : []),
      pending: results.some(result => result.isPending),
      error: results.find(result => result.error)?.error ?? null,
    }),
  })
}

/** Partners for a picker: customers or vendors only, matched by the typed text. */
export function useFinancePartnerOptions(kind: MaybeRefOrGetter<PartnerPickerKind>, q: MaybeRefOrGetter<string>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeInvoiceKeys.partners(toValue(kind), toValue(q).trim())),
    placeholderData: keepPreviousData,
    queryFn: ({ queryKey, signal }) => {
      const partnerKind = queryKey[3]
      return $api('/api/v1/finance/partners', {
        query: { ...(partnerKind === 'any' ? {} : { kind: partnerKind }), q: queryKey[4] || undefined, limit: 50 },
        signal,
        schema: FinancePartnerListSchema,
      })
    },
  })
}

/** Posted documents with something left to pay, for the payment form's own picker. */
export function useFinanceOpenInvoices(q: MaybeRefOrGetter<string>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ['finance', 'invoices', 'open', toValue(q).trim()] as const),
    enabled: computed(() => toValue(enabled)),
    placeholderData: keepPreviousData,
    queryFn: ({ queryKey, signal }) => $api('/api/v1/finance/invoices', { query: { state: 'posted', q: queryKey[3] || undefined, limit: 50 }, signal, schema: FinanceInvoiceListSchema }),
  })
}

function useInvoiceWrite<T>(request: (input: T) => Promise<FinanceInvoiceDetail>, sourceId?: (input: T) => number) {
  const qc = useQueryClient()
  const { me } = useMe()
  const identity = () => me.value ? `${me.value.company.id}:${me.value.id}` : 'anonymous'
  return useMutation({
    mutationFn: request,
    onMutate: () => identity(),
    onSuccess: (detail, input, owner) => {
      if (owner !== undefined && owner !== identity()) return
      void qc.cancelQueries({ queryKey: financeInvoiceKeys.record(detail.id) })
      qc.setQueryData(financeInvoiceKeys.record(detail.id), detail)
      // Save completion follows the committed response; background reads cannot delay navigation.
      void qc.invalidateQueries({ queryKey: financeInvoiceKeys.all, predicate: q => q.queryKey[2] !== 'record' })
      const source = sourceId?.(input)
      if (source && source !== detail.id) void qc.invalidateQueries({ queryKey: financeInvoiceKeys.record(source) })
    },
  })
}

export function useCreateFinanceInvoice() {
  const { $api } = useApi()
  return useInvoiceWrite((body: FinanceInvoiceCreate) => $api('/api/v1/finance/invoices', { method: 'POST', body, schema: FinanceInvoiceDetailSchema }))
}

export function usePatchFinanceInvoice() {
  const { $api } = useApi()
  return useInvoiceWrite(({ id, body }: { id: number; body: FinanceInvoicePatch }) => $api(`/api/v1/finance/invoices/${id}`, { method: 'PATCH', body, schema: FinanceInvoiceDetailSchema }))
}

export function useDeleteFinanceInvoice() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/finance/invoices/${id}`, { method: 'DELETE' }),
    onSuccess: (_answer, id) => {
      qc.removeQueries({ queryKey: financeInvoiceKeys.record(id) })
      void qc.invalidateQueries({ queryKey: financeInvoiceKeys.all, predicate: q => q.queryKey[2] !== 'record' })
    },
  })
}

export type FinanceInvoiceTransition = 'post' | 'cancel' | 'reset-to-draft'

export function useFinanceInvoiceTransition() {
  const { $api } = useApi()
  return useInvoiceWrite(({ id, action }: { id: number; action: FinanceInvoiceTransition }) =>
    $api(`/api/v1/finance/invoices/${id}/${action}`, { method: 'POST', body: {}, schema: FinanceInvoiceDetailSchema }))
}

export function useCreateFinanceDebitNote() {
  const { $api } = useApi()
  return useInvoiceWrite(({ id, body }: { id: number; body: FinanceDebitNoteCreate }) =>
    $api(`/api/v1/finance/invoices/${id}/debit-note`, { method: 'POST', body, schema: FinanceInvoiceDetailSchema }), input => input.id)
}

export function useCreateFinanceCreditNote() {
  const { $api } = useApi()
  return useInvoiceWrite(({ id, body }: { id: number; body: FinanceCreditNoteCreate }) =>
    $api(`/api/v1/finance/invoices/${id}/credit-note`, { method: 'POST', body, schema: FinanceInvoiceDetailSchema }), input => input.id)
}

/** The submission answer is a committed state even when ZATCA says no: the caller reads the record again either way. */
export function useFinanceZatcaSubmit() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, retry }: { id: number; retry: boolean }) =>
      $api(`/api/v1/finance/invoices/${id}/zatca/${retry ? 'retry' : 'submit'}`, { method: 'POST', body: {}, schema: FinanceZatcaSubmissionSchema }),
    onSettled: () => qc.invalidateQueries({ queryKey: financeInvoiceKeys.all }),
  })
}
