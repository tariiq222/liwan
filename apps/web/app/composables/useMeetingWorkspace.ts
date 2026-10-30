import { computed, onServerPrefetch, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { MeetingFollowupListSchema, MeetingEventListSchema, MeetingVersionListSchema, MeetingVersionSchema, MeetingSeriesResolutionListSchema } from '@liwan/contracts'
import { meetingKeys, meetingSeriesKeys } from './meetingKeys'

type WorkspaceParams = { limit?: number; offset?: number; q?: string; state?: string }
function paramsOf(params: MaybeRefOrGetter<WorkspaceParams>) {
  const p = toValue(params)
  return { ...p, limit: Math.min(100, Math.max(1, p.limit ?? 25)), offset: Math.max(0, p.offset ?? 0) }
}
function prefetch(query: { suspense: () => Promise<unknown> }, enabled: MaybeRefOrGetter<boolean>) {
  onServerPrefetch(async () => {
    if (toValue(enabled)) {
      try { await query.suspense() } catch { /* Query error is rendered with retry. */ }
    }
  })
}
export function useMeetingEvents(id: MaybeRefOrGetter<number | null>, params: MaybeRefOrGetter<WorkspaceParams> = {}, series = false) {
  const { $api } = useApi()
  const enabled = computed(() => Number.isInteger(toValue(id)) && Number(toValue(id)) > 0)
  const query = useQuery({
    queryKey: computed(() => (series ? meetingSeriesKeys : meetingKeys).events(toValue(id), paramsOf(params))),
    enabled,
    queryFn: () => $api(`/api/v1/${series ? 'meeting-series' : 'meetings'}/${toValue(id)}/events`, { query: paramsOf(params), schema: MeetingEventListSchema }),
  })
  prefetch(query, enabled)
  return query
}
export function useMeetingVersions(id: MaybeRefOrGetter<number | null>, params: MaybeRefOrGetter<WorkspaceParams> = {}) {
  const { $api } = useApi()
  const enabled = computed(() => Number.isInteger(toValue(id)) && Number(toValue(id)) > 0)
  const query = useQuery({
    queryKey: computed(() => meetingKeys.versions(toValue(id), paramsOf(params))),
    enabled,
    queryFn: () => $api(`/api/v1/meetings/${toValue(id)}/versions`, { query: paramsOf(params), schema: MeetingVersionListSchema }),
  })
  prefetch(query, enabled)
  return query
}
export function useMeetingSeriesResolutions(id: MaybeRefOrGetter<number | null>, params: MaybeRefOrGetter<WorkspaceParams> = {}) {
  const { $api } = useApi()
  const enabled = computed(() => Number.isInteger(toValue(id)) && Number(toValue(id)) > 0)
  const query = useQuery({
    queryKey: computed(() => meetingSeriesKeys.resolutions(toValue(id), paramsOf(params))),
    enabled,
    queryFn: () => $api(`/api/v1/meeting-series/${toValue(id)}/resolutions`, { query: paramsOf(params), schema: MeetingSeriesResolutionListSchema }),
  })
  prefetch(query, enabled)
  return query
}

export function useMeetingVersion(id: MaybeRefOrGetter<number | null>, versionId: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const enabled = computed(() => [toValue(id), toValue(versionId)].every(value => Number.isInteger(value) && Number(value) > 0))
  const query = useQuery({
    queryKey: computed(() => meetingKeys.version(toValue(id), toValue(versionId))),
    enabled,
    queryFn: () => $api(`/api/v1/meetings/${toValue(id)}/versions/${toValue(versionId)}`, { schema: MeetingVersionSchema }),
  })
  prefetch(query, enabled)
  return query
}

export type MeetingFollowupParams = { q?: string; mine?: boolean; state?: 'active' | 'overdue' | 'open' | 'in_progress' | 'done' | 'cancelled'; limit?: number; offset?: number }
export function useMeetingFollowup(params: MaybeRefOrGetter<MeetingFollowupParams> = {}, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const query = useQuery({
    queryKey: computed(() => meetingKeys.followup(paramsOf(params))),
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/meetings/resolutions', { query: paramsOf(params), schema: MeetingFollowupListSchema }),
  })
  prefetch(query, enabled)
  return query
}
