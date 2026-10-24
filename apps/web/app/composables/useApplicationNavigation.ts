import { applicationNavigation } from './nav/applicationNavigation'
import { useShellModel } from './useShellModel'

/** The same permission-filtered menu feeds the desktop sidebar and mobile drawer. */
export function useApplicationNavigation() {
  const { t } = useI18n()
  const route = useRoute()
  const shell = useShellModel()
  const personal = computed(() => route.path === '/account' || route.path.startsWith('/account/'))
  const activeId = computed(() => personal.value ? 'account' : shell.railActive.value)
  const items = computed(() => applicationNavigation({
    identity: shell.identity.value,
    route: { path: route.path, fullPath: route.fullPath, query: route.query, params: route.params },
    activeId: activeId.value,
    contextLinks: shell.contextLinks.value,
    translate: t,
  }))
  return { items, activeId, rail: shell.rail, railActive: shell.railActive, title: shell.contextTitle, routeKey: computed(() => route.fullPath), panel: shell.panel, panelView: shell.panelView, homePath: shell.homePath }
}
