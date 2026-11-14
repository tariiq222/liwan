import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { SalesOrderListSchema, SalesOrderSchema, SalesSalespeopleSchema, type SalesOrder, type SalesOrderCreate, type SalesOrderPatch } from '@liwan/contracts'
import { salesKeys } from './salesKeys'
import { salesApiQuery, type SalesListState } from './salesListParams'

export const SALES_TRANSITIONS = ['confirm', 'cancel', 'reopen', 'lock', 'unlock'] as const
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

/** The people a holder of `sales.documents.assign` may make a document's salesperson. */
export function useSalesSalespeople(enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: salesKeys.salespeople(''),
    enabled: computed(() => toValue(enabled)),
    retry: false,
    queryFn: () => $api('/api/v1/sales/salespeople', { schema: SalesSalespeopleSchema }),
  })
}

/**
 * Every write answers the document as saved: it replaces the record's cache entry, and the lists refetch. The mutation
 * stays pending until the server answers, so a transition button cannot be pressed twice.
 */
function useSalesWrite<Args>(send: (api: ReturnType<typeof useApi>['$api'], args: Args) => Promise<SalesOrder>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: Args) => send($api, args),
    onSuccess: async (saved) => {
      qc.setQueryData(salesKeys.detail(saved.id), saved)
      await qc.invalidateQueries({ queryKey: salesKeys.all, predicate: query => query.queryKey[1] === 'list' })
    },
  })
}

export const useCreateSalesOrder = () => useSalesWrite<SalesOrderCreate>(
  (api, body) => api('/api/v1/sales/orders', { method: 'POST', body, schema: SalesOrderSchema }),
)

export const useUpdateSalesOrder = () => useSalesWrite<{ id: number; patch: SalesOrderPatch }>(
  (api, { id, patch }) => api(`/api/v1/sales/orders/${id}`, { method: 'PATCH', body: patch, schema: SalesOrderSchema }),
)

export const useSalesTransition = () => useSalesWrite<{ id: number; transition: SalesTransition }>(
  (api, { id, transition }) => api(`/api/v1/sales/orders/${id}/${transition}`, { method: 'POST', schema: SalesOrderSchema }),
)

/** A new salesperson for a staff document, in any state (`sales.documents.assign`). */
export const useAssignSalesOrder = () => useSalesWrite<{ id: number; salespersonId: number }>(
  (api, { id, salespersonId }) => api(`/api/v1/sales/orders/${id}/assign`, { method: 'POST', body: { salesperson_id: salespersonId }, schema: SalesOrderSchema }),
)

/** The copy is a new draft of the caller; its own record entry is filled from the answer. */
export const useDuplicateSalesOrder = () => useSalesWrite<number>(
  (api, id) => api(`/api/v1/sales/orders/${id}/duplicate`, { method: 'POST', schema: SalesOrderSchema }),
)
