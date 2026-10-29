import type { MaybeRefOrGetter } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  InboxCatalogItemListSchema,
  InboxCatalogItemSchema,
  InboxCatalogListSchema,
  InboxCatalogPickItemListSchema,
  InboxCatalogSchema,
  InboxChannelCommerceSchema,
  type InboxCatalogCreate,
  type InboxCatalogItemCreate,
  type InboxCatalogItemPatch,
  type InboxCatalogPatch,
  type InboxCatalogPickItem,
  type InboxChannelCommercePatch,
} from '@webvue/contracts'
import { hasFeature } from '../../modules/registry'

// Catalogs, their items, a channel's commerce settings and the product picker. Every key starts with 'inbox', so the
// bus handler's invalidation of ['inbox'] refreshes them with the rest of the inbox.
export const CATALOG_FEATURE = 'inbox.catalog'

export const inboxCatalogKeys = {
  catalogs: ['inbox', 'catalogs'] as const,
  catalog: (id: number) => ['inbox', 'catalog', id] as const,
  items: (catalogId: number, filters: object) => ['inbox', 'catalog-items', catalogId, filters] as const,
  item: (id: number) => ['inbox', 'catalog-item', id] as const,
  commerce: (channelId: number) => ['inbox', 'channel-commerce', channelId] as const,
  pick: (source: PickSource, q: string) => ['inbox', 'catalog-pick', source, q] as const,
}

/** Whether the tenant has the catalog feature, so the screens that need it are offered at all. */
export function useInboxCatalogEnabled() {
  const { me } = useMe()
  return computed(() => hasFeature(me.value, CATALOG_FEATURE))
}

export function useInboxCatalogs(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: inboxCatalogKeys.catalogs,
    enabled: computed(() => toValue(enabled)),
    retry: false,
    queryFn: () => $api('/api/v1/inbox/catalogs', { schema: InboxCatalogListSchema }),
  })
}

export function useInboxCatalog(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxCatalogKeys.catalog(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/catalogs/${toValue(id)}`, { schema: InboxCatalogSchema }),
  })
}

export function useCreateInboxCatalog() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InboxCatalogCreate) => $api('/api/v1/inbox/catalogs', { method: 'POST', body, schema: InboxCatalogSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox'] }),
  })
}

export function usePatchInboxCatalog(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InboxCatalogPatch) => $api(`/api/v1/inbox/catalogs/${toValue(id)}`, { method: 'PATCH', body, schema: InboxCatalogSchema }),
    onSuccess: catalog => {
      qc.setQueryData(inboxCatalogKeys.catalog(catalog.id), catalog)
      return qc.invalidateQueries({ queryKey: inboxCatalogKeys.catalogs })
    },
  })
}

export function useDeleteInboxCatalog() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/inbox/catalogs/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox'] }),
  })
}

/** Mark every listed item for a new push to Meta now. */
export function useSyncInboxCatalog() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/inbox/catalogs/${id}/sync`, { method: 'POST', schema: InboxCatalogSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox'] }),
  })
}

export interface CatalogItemFilters {
  q?: string
  sync_state?: string
  review_status?: string
  listed?: boolean
  limit?: number
  offset?: number
}

const cleanFilters = (filters: CatalogItemFilters) => Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== ''))

export function useInboxCatalogItems(catalogId: MaybeRefOrGetter<number | null>, filters: MaybeRefOrGetter<CatalogItemFilters>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxCatalogKeys.items(toValue(catalogId) ?? 0, cleanFilters(toValue(filters)))),
    enabled: computed(() => !!toValue(catalogId)),
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/catalogs/${toValue(catalogId)}/items`, { query: cleanFilters(toValue(filters)), schema: InboxCatalogItemListSchema }),
  })
}

export function useInboxCatalogItem(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxCatalogKeys.item(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/catalog-items/${toValue(id)}`, { schema: InboxCatalogItemSchema }),
  })
}

export function useCreateInboxCatalogItem(catalogId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InboxCatalogItemCreate) => $api(`/api/v1/inbox/catalogs/${toValue(catalogId)}/items`, { method: 'POST', body, schema: InboxCatalogItemSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox'] }),
  })
}

export function usePatchInboxCatalogItem() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: InboxCatalogItemPatch }) => $api(`/api/v1/inbox/catalog-items/${id}`, { method: 'PATCH', body, schema: InboxCatalogItemSchema }),
    onSuccess: item => {
      qc.setQueryData(inboxCatalogKeys.item(item.id), item)
      return qc.invalidateQueries({ queryKey: ['inbox'] })
    },
  })
}

export function useDeleteInboxCatalogItem() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/inbox/catalog-items/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox'] }),
  })
}

/** A channel's commerce settings and the catalog its WhatsApp account uses. A refusal (no feature, no access) is an error the caller reads as "no catalog". */
export function useInboxChannelCommerce(channelId: MaybeRefOrGetter<number | null | undefined>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxCatalogKeys.commerce(toValue(channelId) ?? 0)),
    enabled: computed(() => !!toValue(channelId) && toValue(enabled)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/channels/${toValue(channelId)}/commerce`, { schema: InboxChannelCommerceSchema }),
  })
}

/** Meta first, then WebVue: a refusal changes nothing. The channel is a variable because a catalog card lists several numbers. */
export function usePatchInboxChannelCommerce() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ channelId, body }: { channelId: number; body: InboxChannelCommercePatch }) => $api(`/api/v1/inbox/channels/${channelId}/commerce`, { method: 'PATCH', body, schema: InboxChannelCommerceSchema }),
    onSuccess: commerce => {
      qc.setQueryData(inboxCatalogKeys.commerce(commerce.channel_id), commerce)
      return qc.invalidateQueries({ queryKey: inboxCatalogKeys.catalogs })
    },
  })
}

/** Where the product picker reads its products: the conversation's catalog, or the catalog of a channel (rules and automatic messages). */
export type PickSource = { conversationId: number } | { channelId: number }

/**
 * The listed, synced products a message may name. A conversation has its own route; a channel goes through its commerce
 * answer to the catalog's items (the settings screens hold the catalog capability that route needs).
 */
export function useInboxPickItems(source: MaybeRefOrGetter<PickSource | null>, q: MaybeRefOrGetter<string>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxCatalogKeys.pick(toValue(source) ?? { channelId: 0 }, toValue(q).trim())),
    enabled: computed(() => !!toValue(source)),
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: async () => {
      const target = toValue(source)!
      const query = { q: toValue(q).trim() || undefined, limit: 100 }
      if ('conversationId' in target) return $api(`/api/v1/inbox/conversations/${target.conversationId}/catalog-items`, { query, schema: InboxCatalogPickItemListSchema })
      const commerce = await $api(`/api/v1/inbox/channels/${target.channelId}/commerce`, { schema: InboxChannelCommerceSchema })
      if (!commerce.catalog) return { items: [] as InboxCatalogPickItem[], total: 0 }
      const items = await $api(`/api/v1/inbox/catalogs/${commerce.catalog.id}/items`, { query: { ...query, listed: true, sync_state: 'synced' }, schema: InboxCatalogItemListSchema })
      return {
        items: items.items.filter(item => item.review_status !== 'rejected').map<InboxCatalogPickItem>(item => ({
          id: item.id, product_retailer_id: item.product_retailer_id, name: item.name, price: item.price, currency: item.currency, availability: item.availability, image_url: item.image?.url ?? null,
        })),
        total: items.total,
      }
    },
  })
}
