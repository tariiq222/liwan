import type { MaybeRefOrGetter } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  InboxOrderCheckoutResultSchema,
  InboxOrderListSchema,
  InboxOrderSchema,
  type InboxOrderCheckout,
  type InboxOrderCreate,
  type InboxOrderPatch,
} from '@liwan/contracts'

// Orders: the carts customers send, the orders agents build, and the checkout that turns one into an online order with a
// pay link. Every key starts with 'inbox', so the bus invalidation of ['inbox'] (a payment arriving) refreshes them.
export const inboxOrderKeys = {
  list: (filters: object) => ['inbox', 'orders', filters] as const,
  ofConversation: (id: number) => ['inbox', 'orders', 'conversation', id] as const,
  detail: (id: number) => ['inbox', 'order', id] as const,
}

export interface OrderFilters {
  state?: string
  payment_status?: string
  channel_id?: number
  q?: string
  limit?: number
  offset?: number
}

const cleanFilters = (filters: OrderFilters) => Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== ''))

export function useInboxOrders(filters: MaybeRefOrGetter<OrderFilters>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxOrderKeys.list(cleanFilters(toValue(filters)))),
    enabled: computed(() => toValue(enabled)),
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: () => $api('/api/v1/inbox/orders', { query: cleanFilters(toValue(filters)), schema: InboxOrderListSchema }),
  })
}

export function useInboxConversationOrders(conversationId: MaybeRefOrGetter<number | undefined>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxOrderKeys.ofConversation(toValue(conversationId) ?? 0)),
    enabled: computed(() => !!toValue(conversationId) && toValue(enabled)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/conversations/${toValue(conversationId)}/orders`, { schema: InboxOrderListSchema }),
  })
}

export function useInboxOrder(id: MaybeRefOrGetter<number | null | undefined>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxOrderKeys.detail(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id) && toValue(enabled)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/orders/${toValue(id)}`, { schema: InboxOrderSchema }),
  })
}

/** An order changed (or a link was sent): the thread's cart cards, the order lists and the messages are all read again. */
function useRefreshOrders() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['inbox'] })
}

export function useCreateInboxOrder(conversationId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const refresh = useRefreshOrders()
  return useMutation({
    mutationFn: (body: InboxOrderCreate) => $api(`/api/v1/inbox/conversations/${toValue(conversationId)}/orders`, { method: 'POST', body, schema: InboxOrderSchema }),
    onSuccess: refresh,
  })
}

export function usePatchInboxOrder() {
  const { $api } = useApi()
  const refresh = useRefreshOrders()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: InboxOrderPatch }) => $api(`/api/v1/inbox/orders/${id}`, { method: 'PATCH', body, schema: InboxOrderSchema }),
    onSuccess: refresh,
  })
}

/** Create the online order (once) and send its pay link; a second call for an ordered order sends a new link only. */
export function useCheckoutInboxOrder() {
  const { $api } = useApi()
  const refresh = useRefreshOrders()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: InboxOrderCheckout }) => $api(`/api/v1/inbox/orders/${id}/checkout`, { method: 'POST', body, schema: InboxOrderCheckoutResultSchema }),
    onSuccess: refresh,
  })
}

/** A cart is dismissed; an ordered order asks the payments service to cancel its online order. */
export function useCancelInboxOrder() {
  const { $api } = useApi()
  const refresh = useRefreshOrders()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/inbox/orders/${id}/cancel`, { method: 'POST', schema: InboxOrderSchema }),
    onSuccess: refresh,
  })
}
