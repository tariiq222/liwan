import { defineAsyncComponent, type Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { useShellNavigation } from './useShellNavigation'
import { areaLabelKey, shellModuleList, visibleShellModules, type ShellContextLink } from './nav/shellModules'
import { contextModuleFor } from './nav/activeRoute'
import { createLinkTo } from './nav/createActions'
import { railActiveId, railModel } from './nav/sidebarModel'
import { sidebarPanelFor } from '../modules/surfaces'
import type { AppSidebarPanel } from '../modules/types'
import { postLoginPath } from '../utils/accessPolicy'
import { useAppPins } from './useAppPins'

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
  const { pinned } = useAppPins()
  const rail = computed(() => railModel(visibleShellModules(me.value), pinned.value))
  // The rail entry that stands for the active module: an unpinned application has none, so the launcher is lit.
  const railActive = computed(() => railActiveId(rail.value, activeModule.value))
  const homePath = computed(() => postLoginPath(me.value, undefined))
  const contextTitle = computed(() => t(areaLabelKey(definition.value, activeModule.value)))
  const contextLabelKey = computed(() => definition.value?.labelKey ?? null)
  const panel = computed(() => sidebarPanelFor(contextModule.value) ?? null)
  const panelComponent = computed(() => panel.value ? panelView(panel.value) : null)
  const motionKey = computed(() => `module:${contextModule.value ?? 'none'}`)

  function createTo(link: Pick<ShellContextLink, 'id' | 'to'>): RouteLocationRaw {
    return createLinkTo(link, { path: route.path, fullPath: route.fullPath, query: route.query, params: route.params })
  }

  return {
    activeModule, railActive, contextModule, rail, homePath, contextTitle, contextLabelKey, contextLinks,
    panel, panelView: panelComponent, motionKey, identity: me, createTo,
  }
}
