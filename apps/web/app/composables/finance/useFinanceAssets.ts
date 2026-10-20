import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  FinanceAssetComputeResultSchema,
  FinanceAssetDetailSchema,
  FinanceAssetListSchema,
  FinanceAssetProfileListSchema,
  type FinanceAssetCreate,
} from '@webvue/contracts'
import { financeEntryKeys } from '@/composables/finance/useFinanceEntries'
import type { AssetListParams } from '@/components/finance/assets/assetListParams'

export const financeAssetKeys = {
  all: ['finance', 'assets'] as const,
  list: (params: AssetListParams) => ['finance', 'assets', 'list', params] as const,
  record: (id: number) => ['finance', 'assets', 'record', id] as const,
  profiles: ['finance', 'asset-profiles'] as const,
}

/** One page of assets; the KPI counts ask for the same list with `limit=1` and read only its total. */
export function useFinanceAssetList(params: MaybeRefOrGetter<AssetListParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeAssetKeys.list(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/finance/assets', { query: { ...toValue(params) }, schema: FinanceAssetListSchema }),
  })
}

export function useFinanceAsset(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeAssetKeys.record(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    queryFn: () => $api(`/api/v1/finance/assets/${toValue(id)}`, { schema: FinanceAssetDetailSchema }),
  })
}

/** The asset profiles: the list filter and the create form choose among them. */
export function useFinanceAssetProfiles(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: financeAssetKeys.profiles,
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/finance/asset-profiles', { query: { limit: 100 }, schema: FinanceAssetProfileListSchema }),
  })
}

function useAssetWrite<T, R>(request: (input: T) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: request,
    // A write waits for the server: every list, KPI count and record refreshes from the answer.
    onSuccess: () => qc.invalidateQueries({ queryKey: financeAssetKeys.all }),
  })
}

export function useCreateFinanceAsset() {
  const { $api } = useApi()
  return useAssetWrite((body: FinanceAssetCreate) => $api('/api/v1/finance/assets', { method: 'POST', body, schema: FinanceAssetDetailSchema }))
}

export function useValidateFinanceAsset() {
  const { $api } = useApi()
  return useAssetWrite((id: number) => $api(`/api/v1/finance/assets/${id}/validate`, { method: 'POST', body: {}, schema: FinanceAssetDetailSchema }))
}

/** Posts the due depreciation of every running asset up to `date`: the assets' boards and the journal entries change. */
export function useComputeFinanceDepreciation() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (date: string) => $api('/api/v1/finance/assets/compute-depreciation', { method: 'POST', body: { date }, schema: FinanceAssetComputeResultSchema }),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: financeAssetKeys.all }),
      qc.invalidateQueries({ queryKey: financeEntryKeys.all }),
    ]),
  })
}
