import { useQueries } from '@tanstack/vue-query'
import { quickPanels } from '../modules/surfaces'
import type { AppQuickPanel } from '../modules/types'
import { canReach, canReachPath } from '../utils/accessPolicy'
import { orderQuickPanels } from './nav/quickPanelModel'

export interface QuickTool { panel: AppQuickPanel; count: number | null }

/**
 * The top-bar tools the applications declare (`quickPanel`) that this user may open, in the bar's order, with the badge
 * number of each from the application's own count loader and the caller's own session. A tool the capability or the
 * application feature does not allow is never asked.
 */
export function useQuickPanels() {
  const { $api } = useApi()
  const { me } = useMe()
  const hydrated = useHydrated()
  // Panels are read once at setup; which of them run follows the caller's access.
  const declared = orderQuickPanels(quickPanels())
  const visible = computed(() => declared.filter(panel => canReach(me.value, panel.capability, panel.to) && canReachPath(me.value, panel.to)))
  const owner = computed(() => ({ companyId: me.value?.company.id ?? null, userId: me.value?.id ?? null }))
  const ready = computed(() => hydrated.value && !!owner.value.companyId && !!owner.value.userId)
  const results = useQueries({
    queries: computed(() => visible.value.map(panel => ({
      queryKey: [...panel.queryKey, owner.value],
      queryFn: () => panel.count($api),
      enabled: ready.value,
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
    }))),
  })
  const tools = computed<QuickTool[]>(() => visible.value.map((panel, index) => ({ panel, count: results.value[index]?.data ?? null })))
  return { tools, panels: visible }
}
