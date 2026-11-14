import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// What is asserted is the request each hook makes and the cache it refreshes (same recorder as the automation hooks).
type Options = { queryKey?: unknown; enabled?: unknown; queryFn?: () => unknown; mutationFn?: (input: never) => unknown; onSuccess?: (data: unknown, input: unknown) => unknown }
const seen: Options[] = []
const queryClient = { invalidateQueries: vi.fn(async () => {}), setQueryData: vi.fn() }
vi.mock('@tanstack/vue-query', () => ({
  keepPreviousData: undefined,
  useQuery: (options: Options) => { seen.push(options); return {} },
  useMutation: (options: Options) => { seen.push(options); return {} },
  useQueryClient: () => queryClient,
}))
const $api = vi.fn(async (_path: string, _options?: unknown): Promise<unknown> => ({}))
vi.stubGlobal('useApi', () => ({ $api }))
vi.stubGlobal('useMe', () => ({ me: Vue.ref({ platform: { readable_features: ['inbox.catalog'], writable_features: [] } }) }))
vi.stubGlobal('computed', Vue.computed)
vi.stubGlobal('toValue', Vue.toValue)

const catalog = await import('../useInboxCatalog')
const orders = await import('../useInboxOrders')
const last = () => seen.at(-1)!

beforeEach(() => {
  seen.length = 0
  $api.mockClear()
  queryClient.invalidateQueries.mockClear()
})

describe('catalog hooks', () => {
  it('reads the catalog features from the tenant identity', () => {
    expect(Vue.toValue(catalog.useInboxCatalogEnabled())).toBe(true)
  })

  it('lists items with only the filters that are set', async () => {
    catalog.useInboxCatalogItems(4, { q: '', sync_state: 'error', limit: 20 })
    await last().queryFn!()
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/catalogs/4/items', expect.objectContaining({ query: { sync_state: 'error', limit: 20 } }))
  })

  it('patches a channel\'s commerce settings through the variable channel, and keeps the answer', async () => {
    catalog.usePatchInboxChannelCommerce()
    await last().mutationFn!({ channelId: 3, body: { cart_enabled: false } } as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/channels/3/commerce', expect.objectContaining({ method: 'PATCH', body: { cart_enabled: false } }))
    last().onSuccess!({ channel_id: 3 }, undefined)
    expect(queryClient.setQueryData).toHaveBeenCalledWith(catalog.inboxCatalogKeys.commerce(3), { channel_id: 3 })
  })

  it('picks products from a conversation\'s route, or through a channel\'s catalog', async () => {
    catalog.useInboxPickItems({ conversationId: 8 }, 'قهوة')
    await last().queryFn!()
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/conversations/8/catalog-items', expect.objectContaining({ query: { q: 'قهوة', limit: 100 } }))
    $api.mockResolvedValueOnce({ channel_id: 2, catalog: { id: 5, name: 'ك' }, cart_enabled: true, catalog_visible: false })
    $api.mockResolvedValueOnce({ items: [{ id: 1, product_retailer_id: 'wv-1', name: 'قهوة', price: 5, currency: 'SAR', availability: 'in_stock', image: null, review_status: 'approved' }, { id: 2, product_retailer_id: 'wv-2', name: 'س', price: 5, currency: 'SAR', availability: 'in_stock', image: null, review_status: 'rejected' }], total: 2 })
    catalog.useInboxPickItems({ channelId: 2 }, '')
    const picked = await last().queryFn!() as { items: { product_retailer_id: string; image_url: null }[] }
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/catalogs/5/items', expect.objectContaining({ query: { limit: 100, listed: true, sync_state: 'synced' } }))
    expect(picked.items.map(entry => entry.product_retailer_id)).toEqual(['wv-1'])
  })

  it('has no products for a channel without a catalog', async () => {
    $api.mockResolvedValueOnce({ channel_id: 2, catalog: null, cart_enabled: null, catalog_visible: null })
    catalog.useInboxPickItems({ channelId: 2 }, '')
    expect(await last().queryFn!()).toEqual({ items: [], total: 0 })
  })
})

describe('order hooks', () => {
  it('filters the list and reads a conversation\'s orders', async () => {
    orders.useInboxOrders({ state: 'ordered', payment_status: '', limit: 20 })
    await last().queryFn!()
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/orders', expect.objectContaining({ query: { state: 'ordered', limit: 20 } }))
    orders.useInboxConversationOrders(3)
    await last().queryFn!()
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/conversations/3/orders', expect.anything())
  })

  it('creates, checks out and cancels, then refreshes the whole inbox', async () => {
    orders.useCreateInboxOrder(3)
    await last().mutationFn!({ lines: [{ catalog_item_id: 1, quantity: 2 }] } as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/conversations/3/orders', expect.objectContaining({ method: 'POST', body: { lines: [{ catalog_item_id: 1, quantity: 2 }] } }))
    orders.useCheckoutInboxOrder()
    await last().mutationFn!({ id: 7, body: { template_id: 4 } } as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/orders/7/checkout', expect.objectContaining({ method: 'POST', body: { template_id: 4 } }))
    await last().onSuccess!({}, undefined)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inbox'] })
    orders.useCancelInboxOrder()
    await last().mutationFn!(7 as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/orders/7/cancel', expect.objectContaining({ method: 'POST' }))
  })
})
