import { useQueries } from '@tanstack/vue-query'
import { coreCounts } from '../modules/surfaces'
import { canReach, canReachPath } from '../utils/accessPolicy'

export interface CoreCount { id: string, count: number | null }

/**
 * The badge numbers of the core applications (conversations, tasks), from the count loaders the applications
 * declare in `coreCount` of their manifest. One loader feeds both places a number appears — the sidebar's core-app row and
 * the phone tab bar — so the two can never disagree.
 *
 * This replaced the top bar's `quickPanel` loaders when those slide-overs were removed (DESIGN.md §3, 2026-11-21): the
 * numbers stay, the duplicate panels and their second set of queries do not.
 */
export function useCoreAppCounts() {
  const { $api } = useApi()
  const { me } = useMe()
  const hydrated = useHydrated()
  const declared = coreCounts()
  const visible = computed(() => declared.filter(entry => canReach(me.value, entry.capability, entry.to) && canReachPath(me.value, entry.to)))
  const owner = computed(() => ({ companyId: me.value?.company.id ?? null, userId: me.value?.id ?? null }))
  const ready = computed(() => hydrated.value && !!owner.value.companyId && !!owner.value.userId)
  const results = useQueries({
    queries: computed(() => visible.value.map(entry => ({
      queryKey: [...entry.queryKey, owner.value],
      queryFn: () => entry.count($api),
      enabled: ready.value,
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
    }))),
  })
  return computed<Record<string, number | null>>(() => Object.fromEntries(
    visible.value.map((entry, index) => [entry.id, results.value[index]?.data ?? null]),
  ))
}
