import { defineAsyncComponent, type Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { useShellNavigation } from './useShellNavigation'
import { shellModuleList, visibleShellModules, type ShellContextLink } from './nav/shellModules'
import { contextModuleFor } from './nav/activeRoute'
import { createLinkTo } from './nav/createActions'
import { railModel } from './nav/sidebarModel'
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
  const rail = computed(() => railModel(visibleShellModules(me.value)))
  const homePath = computed(() => postLoginPath(me.value, undefined))
  const contextTitle = computed(() => definition.value ? t(definition.value.labelKey) : t('app.productName'))
  const contextLabelKey = computed(() => definition.value?.labelKey ?? null)
  const panel = computed(() => sidebarPanelFor(contextModule.value) ?? null)
  const panelComponent = computed(() => panel.value ? panelView(panel.value) : null)
  const motionKey = computed(() => `module:${contextModule.value ?? 'none'}`)

  function createTo(link: Pick<ShellContextLink, 'id' | 'to'>): RouteLocationRaw {
    return createLinkTo(link, { path: route.path, fullPath: route.fullPath, query: route.query, params: route.params })
  }

  return {
    activeModule, contextModule, rail, homePath, contextTitle, contextLabelKey, contextLinks,
    panel, panelView: panelComponent, motionKey, identity: me, createTo,
  }
}
