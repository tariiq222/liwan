import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/vue-query'
import {
  CrmCallListSchema,
  CrmCallResultSchema,
  CrmOpportunityListSchema,
  CrmOpportunitySchema,
  type CrmAssignSchema,
  type CrmCall,
  type CrmCallCreateSchema,
  type CrmCallList,
  type CrmLostSchema,
  type CrmOpportunity,
  type CrmOpportunityCreate,
  type CrmOpportunityFilters,
  type CrmOpportunityPatch,
  type CrmSaleSchema,
} from '@liwan/contracts'
import type { z } from 'zod'
import { crmKeys } from './crmKeys'

type CallBody = z.input<typeof CrmCallCreateSchema>
type SaleBody = z.input<typeof CrmSaleSchema>
type LostBody = z.input<typeof CrmLostSchema>
type AssignBody = z.input<typeof CrmAssignSchema>

export interface OpportunityListParams extends CrmOpportunityFilters { limit: number; offset: number }

const flag = (value: boolean | undefined) => (value === undefined ? undefined : String(value))

function listQuery(params: OpportunityListParams) {
  const { due, unassigned, needs_manager, ...rest } = params
  return { ...rest, due: flag(due), unassigned: flag(unassigned), needs_manager: flag(needs_manager) }
}

/** One page of opportunities for the filters; the previous page stays on screen while the next one loads. */
export function useCrmOpportunities(params: MaybeRefOrGetter<OpportunityListParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => crmKeys.opportunityList(toValue(params))),
    enabled: computed(() => toValue(enabled) && can('crm.leads.read')),
    queryFn: ({ queryKey, signal }) => $api('/api/v1/crm/opportunities', { query: listQuery(queryKey[3] as OpportunityListParams), signal, schema: CrmOpportunityListSchema }),
    placeholderData: keepPreviousData,
  })
}

export function useCrmOpportunity(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => crmKeys.opportunity(toValue(id))),
    enabled: computed(() => toValue(id) > 0 && can('crm.leads.read')),
    queryFn: ({ queryKey, signal }) => $api(`/api/v1/crm/opportunities/${queryKey[3]}`, { signal, schema: CrmOpportunitySchema }),
  })
}

/** Record this opening in the company's audit trail. A named action, not a read: the log is personal data
 * the company keeps only for its stated retention, so a prefetch or a preview never writes one. The route
 * answers 204, so nothing is parsed back. */
function useCrmOpportunitySeen(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  return useMutation({
    mutationFn: () => $api(`/api/v1/crm/opportunities/${toValue(id)}/seen`, { method: 'POST', body: {} }),
  })
}

/** Record the opening of one opportunity page, once per opened record and only after hydration and a
 * successful read.
 *
 * The detail GET never writes, so an SSR render, a prefetch and a link preview record nothing; the client
 * reports the record it actually opened once `useHydrated` turns true and the record query succeeded, and a
 * refetch of the same record reports nothing more. A read the caller may not perform (403) or that found
 * nothing (404) has no view to log, so it writes nothing: the log would grow a row for a record the caller
 * could not read and its own POST would fail for the same reason.
 */
export function useCrmOpportunityOpening(
  recordId: MaybeRefOrGetter<number>,
  hydrated: MaybeRefOrGetter<boolean>,
  loaded: MaybeRefOrGetter<boolean>,
) {
  const seen = useCrmOpportunitySeen(recordId)
  const reported = ref<number | null>(null)
  watch(() => [toValue(hydrated), toValue(loaded), toValue(recordId)] as const, ([ready, open, id]) => {
    if (!ready || !open || !Number.isSafeInteger(id) || id <= 0 || reported.value === id) return
    reported.value = id
    seen.mutate()
  }, { immediate: true })
}

/** Calls per page of the record's call log. */
export const CRM_CALL_PAGE = 20

/** The offset of the next older page of calls, or undefined when every call is loaded. */
export function nextCallOffset(pages: readonly CrmCallList[]): number | undefined {
  const last = pages.at(-1)
  if (!last) return undefined
  const loaded = pages.reduce((sum, page) => sum + page.items.length, 0)
  return last.items.length > 0 && loaded < last.total ? loaded : undefined
}

/** The pages' calls in order, one row per call: a call recorded between two page loads shifts the offsets and repeats a row. */
export function mergeCallPages(pages: readonly CrmCallList[]): CrmCall[] {
  const seen = new Set<number>()
  return pages.flatMap(page => page.items).filter(call => !seen.has(call.id) && !!seen.add(call.id))
}

/** The calls of one opportunity, newest first; `fetchNextPage` loads the next older page. */
export function useCrmCalls(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const { can } = useAccess()
  const query = useInfiniteQuery({
    queryKey: computed(() => crmKeys.calls(toValue(id))),
    enabled: computed(() => toValue(id) > 0 && can('crm.leads.read')),
    initialPageParam: 0,
    queryFn: ({ pageParam, queryKey, signal }) => $api(`/api/v1/crm/opportunities/${queryKey[3]}/calls`, { query: { limit: CRM_CALL_PAGE, offset: pageParam }, signal, schema: CrmCallListSchema }),
    getNextPageParam: (_last, pages) => nextCallOffset(pages),
  })
  const items = computed<CrmCall[]>(() => mergeCallPages(query.data.value?.pages ?? []))
  return { ...query, items }
}

/**
 * Every write on one opportunity answers with the opportunity as the server now holds it. That answer replaces the
 * cached record (a transition is never optimistic); the lists and the call log refetch.
 */
function useOpportunityWrite<Body, Result>(request: (id: number, body: Body) => Promise<Result>, record: (result: Result) => CrmOpportunity) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Body }) => request(id, body),
    // 409: the record was closed or changed meanwhile. Refetch it and its calls so the page shows the real state.
    onError: async (error, { id }) => {
      if ((error as { status?: number }).status !== 409) return
      await Promise.all([qc.invalidateQueries({ queryKey: crmKeys.opportunity(id) }), qc.invalidateQueries({ queryKey: crmKeys.calls(id) })])
    },
    onSuccess: async (result, { id }) => {
      qc.setQueryData(crmKeys.opportunity(id), record(result))
      await Promise.all([
        qc.invalidateQueries({ queryKey: [...crmKeys.opportunities, 'list'] }),
        qc.invalidateQueries({ queryKey: crmKeys.calls(id) }),
        qc.invalidateQueries({ queryKey: crmKeys.dashboardAll }),
      ])
    },
  })
}

export function useCreateCrmOpportunity() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CrmOpportunityCreate) => $api('/api/v1/crm/opportunities', { method: 'POST', body, schema: CrmOpportunitySchema }),
    onSuccess: async created => {
      qc.setQueryData(crmKeys.opportunity(created.id), created)
      await Promise.all([qc.invalidateQueries({ queryKey: [...crmKeys.opportunities, 'list'] }), qc.invalidateQueries({ queryKey: crmKeys.dashboardAll })])
    },
  })
}

export function useCrmOpportunityActions() {
  const { $api } = useApi()
  const same = (opportunity: CrmOpportunity) => opportunity
  return {
    patch: useOpportunityWrite((id, body: CrmOpportunityPatch) => $api(`/api/v1/crm/opportunities/${id}`, { method: 'PATCH', body, schema: CrmOpportunitySchema }), same),
    recordCall: useOpportunityWrite((id, body: CallBody) => $api(`/api/v1/crm/opportunities/${id}/calls`, { method: 'POST', body, schema: CrmCallResultSchema }), result => result.opportunity),
    sell: useOpportunityWrite((id, body: SaleBody) => $api(`/api/v1/crm/opportunities/${id}/won`, { method: 'POST', body, schema: CrmOpportunitySchema }), same),
    lose: useOpportunityWrite((id, body: LostBody) => $api(`/api/v1/crm/opportunities/${id}/lost`, { method: 'POST', body, schema: CrmOpportunitySchema }), same),
    reopen: useOpportunityWrite((id, _body: null) => $api(`/api/v1/crm/opportunities/${id}/reopen`, { method: 'POST', body: {}, schema: CrmOpportunitySchema }), same),
    assign: useOpportunityWrite((id, body: AssignBody) => $api(`/api/v1/crm/opportunities/${id}/assign`, { method: 'POST', body, schema: CrmOpportunitySchema }), same),
  }
}
