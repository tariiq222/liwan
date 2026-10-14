import { defineAsyncComponent, type Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { useShellNavigation } from './useShellNavigation'
import { shellModuleList, visibleShellModules, type ShellContextLink } from './nav/shellModules'
import { contextModuleFor } from './nav/activeRoute'
import { createLinkTo } from './nav/createActions'
import { railModel } from './nav/sidebarModel'
import { sidebarPanelFor } from '../modules/surfaces'
import type { AppSidebarPanel } from '../modules/types'
import { firstAllowedPath } from '../utils/accessPolicy'

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
  const identity = useWorkspaceIdentity()
  const { activeModule, module, projectId, project, contextLinks } = useShellNavigation(identity)
  // `home` and `projects` share one projects sidebar (2026-09-11).
  const contextModule = computed(() => contextModuleFor(activeModule.value))
  const definition = computed(() => shellModuleList().find(item => item.id === contextModule.value) ?? module.value)
  const rail = computed(() => railModel(visibleShellModules(identity.value)))
  const homePath = computed(() => firstAllowedPath(me.value))
  const contextTitle = computed(() => definition.value ? t(definition.value.labelKey) : t('app.productName'))
  const contextLabelKey = computed(() => definition.value?.labelKey ?? null)
  const panel = computed(() => sidebarPanelFor(contextModule.value) ?? null)
  const panelComponent = computed(() => panel.value ? panelView(panel.value) : null)
  const motionKey = computed(() => `module:${contextModule.value ?? 'none'}`)

  function createTo(link: ShellContextLink): RouteLocationRaw {
    return createLinkTo(link, { path: route.path, fullPath: route.fullPath, query: route.query, params: route.params })
  }

  return {
    activeModule, contextModule, rail, homePath, contextTitle, contextLabelKey, contextLinks,
    panel, panelView: panelComponent, motionKey, projectId, project, identity, createTo,
  }
}
