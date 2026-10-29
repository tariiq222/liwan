import { useMediaQuery } from '@vueuse/core'
import { toValue, type MaybeRefOrGetter } from 'vue'
// These names have one owner each under nav/; import for internal use only,
// never re-export, or the auto-import namespace collision just moves here.
import {
  contextLinksForModule,
  visibleShellModules,
  type ShellContextLink,
  type ShellModule,
} from './nav/shellModules'
import { activeShellModule, contextModuleFor } from './nav/activeRoute'
import { CONTEXT_SIDEBAR_COOKIE, contextSidebarState, type ContextSidebarCookie } from './nav/contextSidebarState'
import { useAssistantSheet } from './useAssistantSheet'
import { effectiveActivePart, anchorOf } from './nav/settingsScroll'
import { canReachPath, isNavPathActive, type AccessIdentity } from '../utils/accessPolicy'
import { personalContextLinks } from './nav/personalModel'

export function useContextSidebar() {
  const cookie = useCookie<ContextSidebarCookie | null>(CONTEXT_SIDEBAR_COOKIE, {
    default: () => null,
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  })
  // A docked sheet takes the room from 768px up; below it the sheet is a full-screen layer and the sidebar is not shown.
  const desktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
  const { shown } = useAssistantSheet()
  const forced = computed(() => shown.value && desktop.value)
  return contextSidebarState(cookie, useHydrated(), useMediaQuery('(min-width: 1100px)', { ssrWidth: 1100 }), forced)
}

export function useShellNavigation(identity: MaybeRefOrGetter<AccessIdentity>) {
  const route = useRoute()
  const identityValue = computed(() => toValue(identity))
  const activePart = useSettingsActivePart()
  // The server never sees the URL hash, so the first client render must not either: a hydration pass that disagrees
  // with the server's markup leaves the stale attribute in the DOM.
  const hydrated = useHydrated()
  // A page the identity may not open (the 403 page) belongs to no application: no application title, links or side panel.
  const activeModule = computed<ShellModule | null>(() => {
    const owner = activeShellModule(route.path)
    return owner && identityValue.value && !canReachPath(identityValue.value, route.path) ? null : owner
  })
  // Inside a project the sidebar keeps the projects module links (2026-09-11);
  // the project's own sections are tabs inside the page.
  const contextLinks = computed<ShellContextLink[]>(() => {
    if (route.path === '/account' || route.path.startsWith('/account/')) {
      return personalContextLinks(identityValue.value).map(link => ({ ...link, active: isContextLinkActive(route.path, link) }))
    }
    const linksModule = contextModuleFor(activeModule.value)
    if (!linksModule) return []
    const links = contextLinksForModule(linksModule, identityValue.value, route.path)
      .map(link => route.path === '/projects' && link.id === 'projects'
        ? { ...link, to: { path: '/projects', query: { ...route.query, mine: undefined, offset: undefined } } }
        : link)
    const part = effectiveActivePart(route.path, links, activePart.value, hydrated.value ? route.hash : '')
    return links.map(link => ({ ...link, active: isContextLinkActive(route.path, link, part) }))
  })
  const module = computed(() => visibleShellModules(identityValue.value).find(item => item.id === activeModule.value) ?? null)
  return { activeModule, module, contextLinks }
}

/**
 * A link is active on its `within` prefix, only on its own path when `exact`, else by `isContextPathActive`. A link
 * that scrolls to a card of its page (a hash target) is active there while that card is `activePart`.
 */
export function isContextLinkActive(path: string, link: Pick<ShellContextLink, 'to' | 'exact' | 'within'>, activePart: string | null = null): boolean {
  const anchor = anchorOf(link)
  const target = typeof link.to === 'string' ? link.to : link.to.path ?? ''
  if (anchor !== null) return (link.within !== undefined && isNavPathActive(path, link.within)) || ((path.replace(/\/+$/, '') || '/') === target && anchor === activePart)
  if (link.within) return isNavPathActive(path, link.within)
  return link.exact ? (path.replace(/\/+$/, '') || '/') === target : isContextPathActive(path, link.to)
}

/** Active test for a context link: the owning application's `isNavActive`, else same path or sub-path. */
export function isContextPathActive(path: string, to: ShellContextLink['to']): boolean {
  return isNavPathActive(path, typeof to === 'string' ? to : to.path ?? '')
}
