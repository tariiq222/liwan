import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  FinancePartnerListSchema,
  FinancePartnerSchema,
  LookupListSchema,
  type FinancePartner,
  type FinancePartnerCreate,
  type FinancePartnerPatch,
} from '@webvue/contracts'
import { FINANCE_PARTNER_PAGE_SIZE, type FinancePartnerKind } from './financePartnerParams'

export type { FinancePartner }

export interface FinancePartnerListParams {
  q?: string
  kind?: FinancePartnerKind | null
  archived?: boolean
  limit?: number
  offset?: number
}

export const financePartnerKeys = {
  all: ['finance', 'partners'] as const,
  list: (params: FinancePartnerListParams) => ['finance', 'partners', params] as const,
  detail: (id: number) => ['finance', 'partner', id] as const,
  countries: (q: string) => ['finance', 'countries', q] as const,
  states: (countryId: number) => ['finance', 'states', countryId] as const,
}

export function financePartnerQuery(params: FinancePartnerListParams) {
  return {
    q: params.q || undefined,
    kind: params.kind ?? undefined,
    archived: params.archived ? 'true' : undefined,
    limit: params.limit ?? FINANCE_PARTNER_PAGE_SIZE,
    offset: params.offset ?? 0,
  }
}

export function useFinancePartners(params: MaybeRefOrGetter<FinancePartnerListParams> = {}, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    enabled: computed(() => toValue(enabled)),
    queryKey: computed(() => financePartnerKeys.list(toValue(params))),
    queryFn: () => $api('/api/v1/finance/partners', { query: financePartnerQuery(toValue(params)), schema: FinancePartnerListSchema }),
  })
}

export function useFinancePartner(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financePartnerKeys.detail(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    queryFn: () => $api(`/api/v1/finance/partners/${toValue(id)}`, { schema: FinancePartnerSchema }),
  })
}

/** Countries matching `q` (name or code), for the address field; the selected one is added by the form. */
export function useFinanceCountries(q: MaybeRefOrGetter<string>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financePartnerKeys.countries(toValue(q))),
    queryFn: () => $api('/api/v1/finance/countries', { query: { q: toValue(q) || undefined, limit: 50 }, schema: LookupListSchema }),
    staleTime: 5 * 60 * 1000,
  })
}

export function useFinanceStates(countryId: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financePartnerKeys.states(toValue(countryId) ?? 0)),
    enabled: computed(() => !!toValue(countryId)),
    queryFn: () => $api(`/api/v1/finance/countries/${toValue(countryId)}/states`, { query: { limit: 200 }, schema: LookupListSchema }),
    staleTime: 5 * 60 * 1000,
  })
}

function useStoreAfterWrite() {
  const qc = useQueryClient()
  return (partner: FinancePartner) => {
    qc.setQueryData(financePartnerKeys.detail(partner.id), partner)
    void qc.invalidateQueries({ queryKey: financePartnerKeys.all })
    void qc.invalidateQueries({ queryKey: ['search', 'finance-partners'] })
  }
}

export function useCreateFinancePartner() {
  const { $api } = useApi()
  const store = useStoreAfterWrite()
  return useMutation({
    mutationFn: (body: FinancePartnerCreate) => $api('/api/v1/finance/partners', { method: 'POST', body, schema: FinancePartnerSchema }),
    onSuccess: store,
  })
}

export function useUpdateFinancePartner() {
  const { $api } = useApi()
  const store = useStoreAfterWrite()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: FinancePartnerPatch }) =>
      $api(`/api/v1/finance/partners/${id}`, { method: 'PATCH', body: patch, schema: FinancePartnerSchema }),
    onSuccess: store,
  })
}

function usePartnerArchiveMutation(action: 'archive' | 'unarchive') {
  const { $api } = useApi()
  const store = useStoreAfterWrite()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/finance/partners/${id}/${action}`, { method: 'POST', schema: FinancePartnerSchema }),
    onSuccess: store,
  })
}
export function useArchiveFinancePartner() { return usePartnerArchiveMutation('archive') }
export function useUnarchiveFinancePartner() { return usePartnerArchiveMutation('unarchive') }
