import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { useQueries } from '@tanstack/vue-query'
import { attentionProviders } from '../modules/surfaces'
import {
  allFailed,
  ATTENTION_ROWS_PER_PROVIDER,
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
} {
  const { $api } = useApi()
  const { t } = useI18n()
  const { can } = useAccess()
  const { me } = useMe()
  const hydrated = useHydrated()
  // Providers are read once at setup; which of them run follows the scope and the caller's access.
  const providers = attentionProviders()
  const ready = computed(() => hydrated.value && me.value !== null)
  const visible = computed(() => visibleProviders(providersInScope(providers, toValue(scope)), can))
  const results = useQueries({
    queries: computed(() => visible.value.map(provider => ({
      queryKey: provider.queryKey,
      queryFn: () => provider.load($api, t),
      enabled: ready.value,
    }))),
  })
  const rows = computed(() => mergeAttentionRows(
    visible.value.map((provider, index) => ({ provider, rows: results.value[index]?.data ?? [] })),
    options.limit ?? ATTENTION_ROWS_PER_PROVIDER,
  ))
  return {
    rows,
    pending: computed(() => visible.value.length > 0 && results.value.some(result => result.isPending)),
    failed: computed(() => allFailed(results.value)),
  }
}
