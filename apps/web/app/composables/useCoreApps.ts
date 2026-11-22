import { coreAppItems } from './nav/coreApps'
import { toolBadge } from './nav/coreApps'
import { useCoreAppCounts } from './useCoreAppCounts'
import { useShellModel } from './useShellModel'

/**
 * The icon row of the sidebar: the core applications this user may open, each with the badge of its own count. The
 * same loader feeds the phone tab bar, so the two never disagree.
 */
export function useCoreApps() {
  const { t } = useI18n()
  const shell = useShellModel()
  const counts = useCoreAppCounts()
  const badges = computed(() => Object.fromEntries(Object.entries(counts.value).map(([id, count]) => [id, toolBadge(count)])))
  return computed(() => coreAppItems({ core: shell.rail.value.core, activeModule: shell.activeModule.value, badges: badges.value, translate: key => t(key) }))
}
