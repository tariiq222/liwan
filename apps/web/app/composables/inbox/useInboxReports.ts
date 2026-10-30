import type { MaybeRefOrGetter } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import {
  InboxCostReportSchema,
  InboxReportBreakdownSchema,
  InboxReportOverviewSchema,
  InboxTemplateAnalyticsDetailSchema,
  InboxTemplateAnalyticsListSchema,
  type InboxCostQuery,
  type InboxReportBreakdownBy,
  type InboxReportBreakdownQuery,
  type InboxReportQuery,
  type InboxTemplateAnalyticsDetailQuery,
  type InboxTemplateAnalyticsQuery,
} from '@liwan/contracts'
import { saveBlob } from '../../utils/saveBlob'

// Every key starts with 'inbox', so the bus handler's invalidation of ['inbox'] refreshes a report when the inbox changes.
export const inboxReportKeys = {
  overview: (query: object) => ['inbox', 'reports', 'overview', query] as const,
  breakdown: (by: InboxReportBreakdownBy, query: object) => ['inbox', 'reports', 'breakdown', by, query] as const,
  costs: (query: object) => ['inbox', 'reports', 'costs', query] as const,
  templates: (query: object) => ['inbox', 'reports', 'templates', query] as const,
  template: (id: number, query: object) => ['inbox', 'reports', 'template', id, query] as const,
}

/** The breakdown filters: the dimension itself (`by`) is the first argument. */
export type BreakdownFilters = Omit<InboxReportBreakdownQuery, 'by'>

/** Reports are computed from daily aggregates, so a minute of staleness costs nothing and spares the server. */
const REPORT_STALE_MS = 60_000

const cleanQuery = (query: object) => Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== ''))

export function useInboxReportOverview(query: MaybeRefOrGetter<InboxReportQuery>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxReportKeys.overview(toValue(query))),
    enabled: computed(() => toValue(enabled)),
    staleTime: REPORT_STALE_MS,
    retry: false,
    queryFn: () => $api('/api/v1/inbox/reports/overview', { query: cleanQuery(toValue(query)), schema: InboxReportOverviewSchema }),
  })
}

export function useInboxReportBreakdown(by: InboxReportBreakdownBy, query: MaybeRefOrGetter<BreakdownFilters>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxReportKeys.breakdown(by, toValue(query))),
    enabled: computed(() => toValue(enabled)),
    staleTime: REPORT_STALE_MS,
    retry: false,
    queryFn: () => $api('/api/v1/inbox/reports/breakdown', { query: cleanQuery({ by, ...toValue(query) }), schema: InboxReportBreakdownSchema }),
  })
}

export function useInboxCostReport(query: MaybeRefOrGetter<InboxCostQuery>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxReportKeys.costs(toValue(query))),
    enabled: computed(() => toValue(enabled)),
    staleTime: REPORT_STALE_MS,
    retry: false,
    queryFn: () => $api('/api/v1/inbox/reports/costs', { query: cleanQuery(toValue(query)), schema: InboxCostReportSchema }),
  })
}

/** The templates of one channel with Meta's counts; `query` is null until a channel is chosen. */
export function useInboxTemplateAnalytics(query: MaybeRefOrGetter<InboxTemplateAnalyticsQuery | null>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxReportKeys.templates(toValue(query) ?? {})),
    enabled: computed(() => toValue(enabled) && toValue(query) !== null),
    staleTime: REPORT_STALE_MS,
    retry: false,
    queryFn: () => $api('/api/v1/inbox/reports/templates', { query: cleanQuery(toValue(query) ?? {}), schema: InboxTemplateAnalyticsListSchema }),
  })
}

export function useInboxTemplateAnalyticsDetail(id: MaybeRefOrGetter<number | null>, query: MaybeRefOrGetter<InboxTemplateAnalyticsDetailQuery>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxReportKeys.template(toValue(id) ?? 0, toValue(query))),
    enabled: computed(() => toValue(enabled) && !!toValue(id)),
    staleTime: REPORT_STALE_MS,
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/reports/templates/${toValue(id)}`, { query: cleanQuery(toValue(query)), schema: InboxTemplateAnalyticsDetailSchema }),
  })
}

/**
 * The channels the viewer's reports can be narrowed to. The cost report lists every channel with its last sync, and needs
 * only the reports capability (the channel administration list needs more), so it is the one source for the filters.
 */
export function useInboxReportChannels(day: MaybeRefOrGetter<string>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ['inbox', 'reports', 'channels', toValue(day)] as const),
    enabled: computed(() => toValue(enabled)),
    staleTime: REPORT_STALE_MS,
    retry: false,
    queryFn: async () => (await $api('/api/v1/inbox/reports/costs', { query: { from: toValue(day), to: toValue(day) }, schema: InboxCostReportSchema })).channels.map(item => item.channel),
  })
}

/** Downloads the breakdown as CSV (UTF-8 with BOM), named by the server. */
export function useInboxReportExport() {
  const { $download } = useApi()
  return async (by: InboxReportBreakdownBy, query: object) => {
    const search = new URLSearchParams(Object.entries(cleanQuery({ by, ...query })).map(([key, value]) => [key, String(value)]))
    const { blob, filename } = await $download(`/api/v1/inbox/reports/export?${search}`)
    saveBlob(blob, filename ?? `inbox-${by}.csv`)
  }
}
