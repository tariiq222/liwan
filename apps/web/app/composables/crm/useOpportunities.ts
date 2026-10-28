import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/vue-query'
import {
  CrmCallListSchema,
  CrmCallResultSchema,
  CrmOpportunityListSchema,
  CrmOpportunitySchema,
  type CrmAssignSchema,
  type CrmCallCreateSchema,
  type CrmLostSchema,
  type CrmOpportunity,
  type CrmOpportunityCreate,
  type CrmOpportunityFilters,
  type CrmOpportunityPatch,
  type CrmSaleSchema,
} from '@webvue/contracts'
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
    queryFn: () => $api('/api/v1/crm/opportunities', { query: listQuery(toValue(params)), schema: CrmOpportunityListSchema }),
    placeholderData: keepPreviousData,
  })
}

export function useCrmOpportunity(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => crmKeys.opportunity(toValue(id))),
    enabled: computed(() => toValue(id) > 0 && can('crm.leads.read')),
    queryFn: () => $api(`/api/v1/crm/opportunities/${toValue(id)}`, { schema: CrmOpportunitySchema }),
  })
}

export function useCrmCalls(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => crmKeys.calls(toValue(id))),
    enabled: computed(() => toValue(id) > 0 && can('crm.leads.read')),
    queryFn: () => $api(`/api/v1/crm/opportunities/${toValue(id)}/calls`, { query: { limit: 100 }, schema: CrmCallListSchema }),
  })
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
      await qc.invalidateQueries({ queryKey: [...crmKeys.opportunities, 'list'] })
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
