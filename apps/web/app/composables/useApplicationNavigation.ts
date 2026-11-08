import type { ShellNavigationItem } from '@liwan/ui/app/types/shell'
import { applicationNavigation } from './nav/applicationNavigation'
import { sidebarApp, sidebarMode, type SidebarMode } from './nav/sidebarMode'
import { useShellModel } from './useShellModel'

/**
 * The sidebar's model: its mode (global, or the open application's own menu) and, in app mode, that application's
 * permission-filtered menu. The same model feeds the desktop sidebar and the phone drawer.
 */
export function useApplicationNavigation() {
  const { t } = useI18n()
  const route = useRoute()
  const shell = useShellModel()
  const personal = computed(() => route.path === '/account' || route.path.startsWith('/account/'))
  /** The rail id of the open application (settings included), `account` on the self-service pages, else null. */
  const activeId = computed(() => sidebarApp(personal.value, shell.activeModule.value, shell.rail.value.all.map(item => item.id)))
  const mode = computed<SidebarMode>(() => sidebarMode(activeId.value))
  const item = computed<ShellNavigationItem | null>(() => {
    if (!activeId.value) return null
    return applicationNavigation({
      identity: shell.identity.value,
      route: { path: route.path, fullPath: route.fullPath, query: route.query, params: route.params },
      activeId: activeId.value,
      only: activeId.value,
      contextLinks: shell.contextLinks.value,
      translate: t,
    })[0] ?? null
  })
  return { item, activeId, mode }
}
