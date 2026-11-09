import type { RouteLocationRaw } from 'vue-router'
import { useShellNavigation } from './useShellNavigation'
import { visibleShellModules, type ShellContextLink } from './nav/shellModules'
import { createLinkTo } from './nav/createActions'
import { railModel } from './nav/sidebarModel'
import { pinnedApplications } from './nav/railPins'
import { useRailPins } from './useRailPins'
import { postLoginPath } from '../utils/accessPolicy'

/** Everything the shell renders, derived from the route, the identity and the manifests. */
export function useShellModel() {
  const route = useRoute()
  const { me } = useMe()
  const { activeModule, contextLinks } = useShellNavigation(me)
  const rail = computed(() => railModel(visibleShellModules(me.value)))
  const railPins = useRailPins(() => rail.value.applications.map(item => item.id))
  /** The «تطبيقاتي» list: the fixed entries around the pinned applications. */
  const pinned = computed(() => pinnedApplications(rail.value, railPins.pins.value))
  const homePath = computed(() => postLoginPath(me.value, undefined))

  function createTo(link: Pick<ShellContextLink, 'id' | 'to'>): RouteLocationRaw {
    return createLinkTo(link, { path: route.path, fullPath: route.fullPath, query: route.query, params: route.params })
  }

  return { activeModule, rail, pinned, railPins, homePath, contextLinks, identity: me, createTo }
}
