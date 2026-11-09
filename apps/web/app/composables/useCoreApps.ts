import { coreAppItems } from './nav/coreApps'
import { toolBadge } from './nav/quickPanelModel'
import { useQuickPanels } from './useQuickPanels'
import { useShellModel } from './useShellModel'

/**
 * The icon row of the sidebar: the core applications this user may open, each with the top-bar badge of its tool
 * (conversations, tasks, meetings) from the same count queries, so the numbers match.
 */
export function useCoreApps() {
  const { t } = useI18n()
  const shell = useShellModel()
  const { tools } = useQuickPanels()
  const badges = computed(() => Object.fromEntries(tools.value.map(tool => [tool.panel.id, toolBadge(tool.count)])))
  return computed(() => coreAppItems({ core: shell.rail.value.core, activeModule: shell.activeModule.value, badges: badges.value, translate: key => t(key) }))
}
