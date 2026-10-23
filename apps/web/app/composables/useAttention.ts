import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { CancelledError, useQueries, useQueryClient } from '@tanstack/vue-query'
import { attentionProviders } from '../modules/surfaces'
import type { AppAttentionRow, AppWorkKind } from '../modules/types'
import {
  allFailed,
  cappedWorkKinds,
  DEFAULT_SURFACE_ROWS,
  mergeAttentionRows,
  providersInScope,
  visibleProviders,
  type AttentionRowWithModule,
  type AttentionScope,
} from './nav/attentionModel'

/**
 * What needs the user's attention in a rail module (or in all of them), from the applications' own attention
 * providers and the caller's own session. A provider the caller's capability and application feature do not allow
 * is never asked; a provider that fails contributes nothing, and `failed` turns true only when all of them fail.
 */
export function useAttention(scope: MaybeRefOrGetter<AttentionScope>, options: { limit?: number } = {}): {
  rows: ComputedRef<AttentionRowWithModule[]>
  pending: ComputedRef<boolean>
  failed: ComputedRef<boolean>
  /** Work kinds whose count is a lower bound: a provider of that kind returned as many rows as it may. */
  cappedKinds: ComputedRef<AppWorkKind[]>
  refetch: () => Promise<unknown>
} {
  const { $api } = useApi()
  const { t } = useI18n()
  const { can } = useAccess()
  const { me } = useMe()
  const hydrated = useHydrated()
  const client = useQueryClient()
  const identity = computed(() => ({ companyId: me.value?.company.id ?? null, userId: me.value?.id ?? null }))
  // Providers are read once at setup; which of them run follows the scope and the caller's access.
  const providers = attentionProviders()
  const ready = computed(() => hydrated.value && !!identity.value.companyId && !!identity.value.userId)
  const visible = computed(() => visibleProviders(providersInScope(providers, toValue(scope)), can))
  const queries = computed(() => visible.value.map(provider => {
    const owner = identity.value
    const currentOwner = () => ready.value && owner.companyId === identity.value.companyId && owner.userId === identity.value.userId
    return {
      // Keep the owning collection prefix so application mutations still invalidate attention.
      queryKey: [...provider.queryKey, owner],
      queryFn: async () => {
        if (!currentOwner()) throw new CancelledError({ revert: true })
        const rows = await provider.load($api, t)
        if (!currentOwner()) throw new CancelledError({ revert: true })
        return rows
      },
      enabled: ready.value,
    }
  }))
  const results = useQueries({ queries })
  const states = computed(() => queries.value.map((query, index) => {
    // Observer updates are queued. Track them, but read by the current key so an
    // identity/scope change cannot expose the previous observer's cached data.
    void results.value[index]
    return client.getQueryState<AppAttentionRow[]>(query.queryKey)
  }))
  const perProvider = computed(() => visible.value.map((provider, index) => ({
    provider, rows: ready.value ? states.value[index]?.data ?? [] : [],
  })))
  const rows = computed(() => mergeAttentionRows(perProvider.value, options.limit ?? DEFAULT_SURFACE_ROWS))
  return {
    rows,
    cappedKinds: computed(() => cappedWorkKinds(perProvider.value)),
    pending: computed(() => visible.value.length > 0 && (!ready.value || states.value.some(state => !state || state.status === 'pending'))),
    failed: computed(() => ready.value && allFailed(states.value.map(state => ({ isError: state?.status === 'error' })))),
    refetch: () => ready.value
      ? Promise.all(queries.value.map(({ queryKey }) => client.refetchQueries({ queryKey, exact: true })))
      : Promise.resolve([]),
  }
}
