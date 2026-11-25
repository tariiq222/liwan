import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { InboxCampaignListSchema, InboxConversationListSchema } from '@liwan/contracts'
import { useQuery } from '@tanstack/vue-query'
import {
  INBOX_CAMPAIGN_KPI_KEYS, INBOX_ORDER_KPI_KEYS,
  inboxCampaignKpiFilters, inboxCampaignKpiLinks, inboxCampaignTiles,
  inboxConversationKpiFilters, inboxConversationKpiLinks, inboxConversationTiles,
  inboxOrderKpiFilters, inboxOrderKpiLinks, inboxOrderTiles, inboxQueueCountsKey,
  type InboxCampaignKpiScope, type InboxConversationKpiScope, type InboxOrderKpiScope,
} from '../../utils/inboxKpis'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import { useInboxOrders } from './useInboxOrders'

// The KPI tiles ask the list endpoints they belong to for one row under the page's scope, so a tile is the server's
// own total and never a sum over the loaded page. Every key starts with 'inbox', so a conversation event refreshes them.

/** The filters of one `limit=1` conversation count. */
type ConversationQuery = Record<string, string | number>

/** One `limit=1` count of the conversations endpoint, under the tile's own filters. */
function useInboxConversationTotal(filters: MaybeRefOrGetter<ConversationQuery>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ['inbox', 'conversations', 'kpi', toValue(filters)] as const),
    enabled: computed(() => toValue(enabled)),
    retry: false,
    queryFn: () => $api('/api/v1/inbox/conversations', { query: toValue(filters), schema: InboxConversationListSchema }),
  })
}

/**
 * The two open queue counts (unassigned, mine) in one query. The sidebar's rows read the same key over the same filter
 * pair, so with no scope filter the page and the menu fetch each number once; the row ids are the sidebar's own.
 */
function useInboxQueueTotals(unassigned: MaybeRefOrGetter<ConversationQuery>, mine: MaybeRefOrGetter<ConversationQuery>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  const { me } = useMe()
  const owner = computed(() => ({ companyId: me.value?.company.id ?? null, userId: me.value?.id ?? null }))
  return useQuery({
    queryKey: computed(() => [...inboxQueueCountsKey(toValue(unassigned), toValue(mine)), owner.value] as const),
    enabled: computed(() => toValue(enabled)),
    retry: false,
    queryFn: async () => {
      const count = (query: ConversationQuery) => $api('/api/v1/inbox/conversations', { query, schema: InboxConversationListSchema })
      const [openUnassigned, openMine] = await Promise.all([count(toValue(unassigned)), count(toValue(mine))])
      return { 'inbox-unassigned': openUnassigned.total, 'inbox-mine': openMine.total }
    },
  })
}

/** The four tiles of the conversations page (open, pending, unassigned, mine). */
export function useInboxConversationKpis(scope: MaybeRefOrGetter<InboxConversationKpiScope>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { t } = useI18n()
  const filters = computed(() => inboxConversationKpiFilters(toValue(scope)))
  const open = useInboxConversationTotal(() => filters.value.open, enabled)
  const pending = useInboxConversationTotal(() => filters.value.pending, enabled)
  const queues = useInboxQueueTotals(() => filters.value.unassigned, () => filters.value.mine, enabled)
  const counts = computed<Partial<Record<'open' | 'pending' | 'unassigned' | 'mine', number>>>(() => ({
    open: open.data.value?.total,
    pending: pending.data.value?.total,
    unassigned: queues.data.value?.['inbox-unassigned'] ?? undefined,
    mine: queues.data.value?.['inbox-mine'] ?? undefined,
  }))
  const tiles = computed<KpiTile[]>(() => inboxConversationTiles(counts.value, inboxConversationKpiLinks(toValue(scope)), t))
  const loading = computed(() => open.isLoading.value || pending.isLoading.value || queues.isLoading.value)
  return { tiles, loading }
}

/** The four tiles of the orders list (total, carts, ordered, paid). */
export function useInboxOrderKpis(scope: MaybeRefOrGetter<InboxOrderKpiScope>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { t } = useI18n()
  const filters = computed(() => inboxOrderKpiFilters(toValue(scope)))
  const queries = Object.fromEntries(INBOX_ORDER_KPI_KEYS.map(key => [
    key, useInboxOrders(() => filters.value[key]!, enabled),
  ])) as Record<typeof INBOX_ORDER_KPI_KEYS[number], ReturnType<typeof useInboxOrders>>
  const tiles = computed<KpiTile[]>(() => inboxOrderTiles(
    Object.fromEntries(INBOX_ORDER_KPI_KEYS.map(key => [key, queries[key].data.value?.total])) as Partial<Record<typeof INBOX_ORDER_KPI_KEYS[number], number>>,
    inboxOrderKpiLinks(toValue(scope)),
    t,
  ))
  const loading = computed(() => Object.values(queries).some(query => query.isLoading.value))
  return { tiles, loading }
}

/** One `limit=1` count of the campaigns endpoint, under the tile's own state. */
function useInboxCampaignTotal(filters: MaybeRefOrGetter<Record<string, string | number>>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ['inbox', 'campaigns', 'kpi', toValue(filters)] as const),
    enabled: computed(() => toValue(enabled)),
    retry: false,
    queryFn: () => $api('/api/v1/inbox/campaigns', { query: toValue(filters), schema: InboxCampaignListSchema }),
  })
}

/** The five tiles of the campaigns list (total, draft, scheduled, running, paused). */
export function useInboxCampaignKpis(scope: MaybeRefOrGetter<InboxCampaignKpiScope>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { t } = useI18n()
  const filters = computed(() => inboxCampaignKpiFilters(toValue(scope)))
  const queries = Object.fromEntries(INBOX_CAMPAIGN_KPI_KEYS.map(key => [
    key, useInboxCampaignTotal(() => filters.value[key]!, enabled),
  ])) as Record<typeof INBOX_CAMPAIGN_KPI_KEYS[number], ReturnType<typeof useInboxCampaignTotal>>
  const tiles = computed<KpiTile[]>(() => inboxCampaignTiles(
    Object.fromEntries(INBOX_CAMPAIGN_KPI_KEYS.map(key => [key, queries[key].data.value?.total])) as Partial<Record<typeof INBOX_CAMPAIGN_KPI_KEYS[number], number>>,
    inboxCampaignKpiLinks(toValue(scope)),
    t,
  ))
  const loading = computed(() => Object.values(queries).some(query => query.isLoading.value))
  return { tiles, loading }
}
