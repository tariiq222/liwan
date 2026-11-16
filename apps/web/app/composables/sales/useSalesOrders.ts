import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { SalesOrderInvoiceBodySchema, SalesOrderListSchema, SalesOrderRefundBodySchema, SalesOrderSchema, type SalesOrder, type SalesOrderCreate, type SalesOrderInvoiceBody, type SalesOrderPatch, type SalesOrderRefundBody } from '@liwan/contracts'
import { createInvoiceAttempts } from '../../utils/salesInvoicing'
import { salesKeys } from './salesKeys'
import { salesApiQuery, type SalesListState } from './salesListParams'

// `send` mails the quotation to the customer; like the others it answers the document as saved.
export const SALES_TRANSITIONS = ['confirm', 'cancel', 'reopen', 'lock', 'unlock', 'send'] as const
export type SalesTransition = typeof SALES_TRANSITIONS[number]

export function useSalesOrders(state: MaybeRefOrGetter<SalesListState>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => salesKeys.list(toValue(state))),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/sales/orders', { query: salesApiQuery(toValue(state)), schema: SalesOrderListSchema }),
  })
}

export function useSalesOrder(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => salesKeys.detail(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    queryFn: () => $api(`/api/v1/sales/orders/${toValue(id)}`, { schema: SalesOrderSchema }),
  })
}

/**
 * Every write answers the document as saved: it replaces the record's cache entry, and the lists refetch. The mutation
 * stays pending until the server answers, so a transition button cannot be pressed twice. A refused write on an existing
 * document refetches it, so its actions show what the server now allows.
 */
function useSalesWrite<Args>(send: (api: ReturnType<typeof useApi>['$api'], args: Args) => Promise<SalesOrder>, target?: (args: Args) => number, alsoRefetch: readonly (readonly string[])[] = []) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: Args) => send($api, args),
    onSuccess: async (saved) => {
      qc.setQueryData(salesKeys.detail(saved.id), saved)
      await qc.invalidateQueries({ queryKey: salesKeys.all, predicate: query => query.queryKey[1] === 'list' })
      for (const queryKey of alsoRefetch) await qc.invalidateQueries({ queryKey })
    },
    onError: async (_failure, args) => {
      if (target) await qc.invalidateQueries({ queryKey: salesKeys.detail(target(args)) })
    },
  })
}

export const useCreateSalesOrder = () => useSalesWrite<SalesOrderCreate>(
  (api, body) => api('/api/v1/sales/orders', { method: 'POST', body, schema: SalesOrderSchema }),
)

export const useUpdateSalesOrder = () => useSalesWrite<{ id: number; patch: SalesOrderPatch }>(
  (api, { id, patch }) => api(`/api/v1/sales/orders/${id}`, { method: 'PATCH', body: patch, schema: SalesOrderSchema }),
  ({ id }) => id,
)

export const useSalesTransition = () => useSalesWrite<{ id: number; transition: SalesTransition }>(
  (api, { id, transition }) => api(`/api/v1/sales/orders/${id}/${transition}`, { method: 'POST', schema: SalesOrderSchema }),
  ({ id }) => id,
)

/** A new salesperson for a staff document, in any state (`sales.documents.assign`). */
export const useAssignSalesOrder = () => useSalesWrite<{ id: number; salespersonId: number }>(
  (api, { id, salespersonId }) => api(`/api/v1/sales/orders/${id}/assign`, { method: 'POST', body: { salesperson_id: salespersonId }, schema: SalesOrderSchema }),
  ({ id }) => id,
)

/** Records a refund the tenant already made at its gateway (`payments.refund`); the body is checked against the contract before it leaves. */
export const useRefundSalesOrder = () => useSalesWrite<{ id: number; refund: SalesOrderRefundBody }>(
  (api, { id, refund }) => api(`/api/v1/sales/orders/${id}/refunds`, { method: 'POST', body: SalesOrderRefundBodySchema.parse(refund), schema: SalesOrderSchema }),
  ({ id }) => id,
)

/** The copy is a new draft of the caller; its own record entry is filled from the answer. */
export const useDuplicateSalesOrder = () => useSalesWrite<number>(
  (api, id) => api(`/api/v1/sales/orders/${id}/duplicate`, { method: 'POST', schema: SalesOrderSchema }),
  id => id,
)

/**
 * Makes a draft customer invoice of a confirmed staff order (`sales.orders.confirm` and `finance.invoices.manage`): the whole
 * order, or a down payment by percent or by amount. The body is checked against the contract before it leaves, and the answer
 * is the order whose `invoicing` lists the new invoice first. The invoice lists of finance are stale after it, so they refetch.
 * The request carries an `Idempotency-Key` that stays with the form while the same body is retried (see `createInvoiceAttempts`).
 */
export function useInvoiceSalesOrder() {
  const attempts = createInvoiceAttempts()
  return useSalesWrite<{ id: number; invoice: SalesOrderInvoiceBody }>(
    async (api, { id, invoice }) => {
      const body = SalesOrderInvoiceBodySchema.parse(invoice)
      const saved = await api(`/api/v1/sales/orders/${id}/invoices`, { method: 'POST', body, headers: { 'Idempotency-Key': attempts.keyFor(id, body) }, schema: SalesOrderSchema })
      attempts.settle()
      return saved
    },
    ({ id }) => id,
    // The keys of the finance invoice lists and records (`financeInvoiceKeys.all`); sales never imports another application's composables.
    [['finance', 'invoices']],
  )
}
