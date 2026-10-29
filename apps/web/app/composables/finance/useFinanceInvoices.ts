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
  type FinanceInvoicePatch,
} from '@webvue/contracts'
import type { InvoiceListParams } from '@/components/finance/invoices/invoiceListParams'

export const financeInvoiceKeys = {
  all: ['finance', 'invoices'] as const,
  list: (params: InvoiceListParams) => ['finance', 'invoices', 'list', params] as const,
  record: (id: number) => ['finance', 'invoices', 'record', id] as const,
  partners: (kind: PartnerPickerKind, q: string) => ['finance', 'partners', 'picker', kind, q] as const,
}

export type PartnerPickerKind = 'customer' | 'vendor' | 'any'

/** One page of documents; the KPI counts ask for the same list with `limit=1` and read only its total. */
export function useFinanceInvoiceList(params: MaybeRefOrGetter<InvoiceListParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeInvoiceKeys.list(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/finance/invoices', { query: { ...toValue(params) }, schema: FinanceInvoiceListSchema }),
  })
}

export function useFinanceInvoice(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeInvoiceKeys.record(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    queryFn: () => $api(`/api/v1/finance/invoices/${toValue(id)}`, { schema: FinanceInvoiceDetailSchema }),
  })
}

/** Several documents by id (the register-payment link carries ids): each is its own cached record. */
export function useFinanceInvoicesByIds(ids: MaybeRefOrGetter<readonly number[]>) {
  const { $api } = useApi()
  return useQueries({
    queries: computed(() => toValue(ids).map(id => ({
      queryKey: financeInvoiceKeys.record(id),
      queryFn: () => $api(`/api/v1/finance/invoices/${id}`, { schema: FinanceInvoiceDetailSchema }),
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
    queryFn: () => {
      const partnerKind = toValue(kind)
      return $api('/api/v1/finance/partners', {
        query: { ...(partnerKind === 'any' ? {} : { kind: partnerKind }), q: toValue(q).trim() || undefined, limit: 50 },
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
    queryFn: () => $api('/api/v1/finance/invoices', { query: { state: 'posted', q: toValue(q).trim() || undefined, limit: 50 }, schema: FinanceInvoiceListSchema }),
  })
}

function useInvoiceWrite<T, R>(request: (input: T) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: request,
    // A write waits for the server: every list, KPI count and record refreshes from the answer.
    onSuccess: () => qc.invalidateQueries({ queryKey: financeInvoiceKeys.all }),
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
  return useInvoiceWrite((id: number) => $api(`/api/v1/finance/invoices/${id}`, { method: 'DELETE' }))
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
    $api(`/api/v1/finance/invoices/${id}/debit-note`, { method: 'POST', body, schema: FinanceInvoiceDetailSchema }))
}

export function useCreateFinanceCreditNote() {
  const { $api } = useApi()
  return useInvoiceWrite(({ id, body }: { id: number; body: FinanceCreditNoteCreate }) =>
    $api(`/api/v1/finance/invoices/${id}/credit-note`, { method: 'POST', body, schema: FinanceInvoiceDetailSchema }))
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
