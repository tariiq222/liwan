import { defineAsyncComponent, type Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { useShellNavigation } from './useShellNavigation'
import { areaLabelKey, shellModuleList, visibleShellModules, type ShellContextLink } from './nav/shellModules'
import { contextModuleFor } from './nav/activeRoute'
import { createLinkTo } from './nav/createActions'
import { railActiveId, railModel } from './nav/sidebarModel'
import { pinnedRail } from './nav/railPins'
import { useRailPins } from './useRailPins'
import { sidebarPanelFor } from '../modules/surfaces'
import type { AppSidebarPanel } from '../modules/types'
import { postLoginPath } from '../utils/accessPolicy'

// One async wrapper per declared panel, so a route change inside the module never remounts it.
const panelViews = new WeakMap<AppSidebarPanel, Component>()
function panelView(panel: AppSidebarPanel): Component {
  let view = panelViews.get(panel)
  if (!view) {
    view = defineAsyncComponent(panel.load)
    panelViews.set(panel, view)
  }
  return view
}

/** Everything the shell renders, derived from the route, the identity and the manifests. */
export function useShellModel() {
  const { t } = useI18n()
  const route = useRoute()
  const { me } = useMe()
  const { activeModule, module, contextLinks } = useShellNavigation(me)
  const contextModule = computed(() => contextModuleFor(activeModule.value))
  const definition = computed(() => shellModuleList().find(item => item.id === contextModule.value) ?? module.value)
  const fullRail = computed(() => railModel(visibleShellModules(me.value)))
  const railPins = useRailPins(() => fullRail.value.applications.map(item => item.id))
  const rail = computed(() => pinnedRail(fullRail.value, railPins.pins.value, activeModule.value))
  const railActive = computed(() => railActiveId(rail.value, activeModule.value))
  const homePath = computed(() => postLoginPath(me.value, undefined))
  const personal = computed(() => route.path === '/account' || route.path.startsWith('/account/'))
  const contextTitle = computed(() => t(personal.value ? 'nav.account' : areaLabelKey(definition.value, activeModule.value)))
  const contextLabelKey = computed(() => personal.value ? 'nav.account' : definition.value?.labelKey ?? null)
  const panel = computed(() => sidebarPanelFor(contextModule.value) ?? null)
  const panelComponent = computed(() => panel.value ? panelView(panel.value) : null)
  const motionKey = computed(() => `module:${personal.value ? 'account' : contextModule.value ?? 'none'}`)

  function createTo(link: Pick<ShellContextLink, 'id' | 'to'>): RouteLocationRaw {
    return createLinkTo(link, { path: route.path, fullPath: route.fullPath, query: route.query, params: route.params })
  }

  return {
    activeModule, railActive, contextModule, rail, railPins, homePath, contextTitle, contextLabelKey, contextLinks,
    panel, panelView: panelComponent, motionKey, identity: me, createTo,
  }
}
