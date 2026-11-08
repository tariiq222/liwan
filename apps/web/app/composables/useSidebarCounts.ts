import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { CancelledError, useQueries, useQueryClient } from '@tanstack/vue-query'
import type { AppSidebarMenu } from '../modules/types'

const COUNT_STALE_MS = 30_000

/**
 * The numbers beside the rows of a flat sidebar menu, by row id, through the caller's own session. A loader whose
 * capability the caller lacks is never asked; a number that is pending or failed is left out (never a wrong zero).
 */
export function useSidebarCounts(menu: MaybeRefOrGetter<AppSidebarMenu | undefined>) {
  const { $api } = useApi()
  const { can } = useAccess()
  const { me } = useMe()
  const hydrated = useHydrated()
  const client = useQueryClient()
  const owner = computed(() => ({ companyId: me.value?.company.id ?? null, userId: me.value?.id ?? null }))
  const ready = computed(() => hydrated.value && !!owner.value.companyId && !!owner.value.userId)
  const visible = computed(() => (toValue(menu)?.counts ?? []).filter(counts => can(counts.capability)))
  const queries = computed(() => visible.value.map((counts) => {
    const asked = owner.value
    const current = () => ready.value && asked.companyId === owner.value.companyId && asked.userId === owner.value.userId
    return {
      queryKey: [...counts.queryKey, asked],
      queryFn: async () => {
        if (!current()) throw new CancelledError({ revert: true })
        const value = await counts.load($api)
        if (!current()) throw new CancelledError({ revert: true })
        return value
      },
      enabled: ready.value,
      retry: false,
      staleTime: COUNT_STALE_MS,
    }
  }))
  const results = useQueries({ queries })
  return computed<Record<string, number | undefined>>(() => {
    const merged: Record<string, number | undefined> = {}
    visible.value.forEach((_counts, index) => {
      // Observer updates are queued: track them, but read by the current key so an owner change never shows old data.
      void results.value[index]
      const arrived = ready.value ? client.getQueryData<Record<string, number | null>>(queries.value[index]!.queryKey) : undefined
      for (const [id, value] of Object.entries(arrived ?? {})) if (typeof value === 'number') merged[id] = value
    })
    return merged
  })
}
