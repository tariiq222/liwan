import type { ShellNavigationItem } from '@liwan/ui/app/types/shell'
import { applicationNavigation } from './nav/applicationNavigation'
import { sidebarApp, sidebarMode, type SidebarMode } from './nav/sidebarMode'
import { sidebarMenuForModule } from './nav/shellModules'
import { activeManifests } from '../modules/manifests'
import { useRecentRecords } from './useRecentRecords'
import { useShellModel } from './useShellModel'
import { useSidebarCounts } from './useSidebarCounts'

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
  // A flat menu's numbers and the records it lists; the cookies of every kind a manifest lists are read once, here.
  const menu = computed(() => activeId.value ? sidebarMenuForModule(activeId.value) : undefined)
  const sidebarCounts = useSidebarCounts(menu)
  const recentStores = Object.fromEntries(activeManifests().flatMap(manifest => manifest.sidebar?.recent ? [[manifest.sidebar.recent.kind, useRecentRecords(manifest.sidebar.recent.kind)] as const] : []))
  const item = computed<ShellNavigationItem | null>(() => {
    if (!activeId.value) return null
    return applicationNavigation({
      identity: shell.identity.value,
      route: { path: route.path, fullPath: route.fullPath, query: route.query, params: route.params },
      activeId: activeId.value,
      only: activeId.value,
      contextLinks: shell.contextLinks.value,
      sidebarCounts: sidebarCounts.value,
      recents: menu.value?.recent ? recentStores[menu.value.recent.kind]?.items.value : undefined,
      translate: t,
    })[0] ?? null
  })
  return { item, activeId, mode }
}
