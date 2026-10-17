import { useMediaQuery } from '@vueuse/core'
import { toValue, type MaybeRefOrGetter } from 'vue'
import { useProject } from './useProjects'
// These names have one owner each under nav/; import for internal use only,
// never re-export, or the auto-import namespace collision just moves here.
import {
  contextLinksForModule,
  visibleShellModules,
  type ShellContextLink,
  type ShellModule,
} from './nav/shellModules'
import { activeShellModule, contextModuleFor, projectIdFromPath } from './nav/activeRoute'
import { CONTEXT_SIDEBAR_COOKIE, contextSidebarState, type ContextSidebarCookie } from './nav/contextSidebarState'
import { isNavPathActive, type AccessIdentity } from '../utils/accessPolicy'

export function useContextSidebar() {
  const cookie = useCookie<ContextSidebarCookie | null>(CONTEXT_SIDEBAR_COOKIE, {
    default: () => null,
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  })
  return contextSidebarState(cookie, useHydrated(), useMediaQuery('(min-width: 1100px)', { ssrWidth: 1100 }))
}

export function useShellNavigation(identity: MaybeRefOrGetter<AccessIdentity>) {
  const route = useRoute()
  const identityValue = computed(() => toValue(identity))
  const activeModule = computed<ShellModule | null>(() => activeShellModule(route.path))
  const projectId = computed(() => projectIdFromPath(route.path))
  const projectQuery = useProject(projectId)
  const hydrated = useHydrated()
  // Server and first client render must use the same navigation shape.
  const project = { ...projectQuery, data: computed(() => hydrated.value ? projectQuery.data.value : undefined) }
  // Inside a project the sidebar keeps the projects module links (2026-09-11);
  // the project's own sections are tabs inside the page.
  const contextLinks = computed<ShellContextLink[]>(() => {
    const linksModule = contextModuleFor(activeModule.value)
    if (!linksModule) return []
    return contextLinksForModule(linksModule, identityValue.value, route.path)
      .map(link => route.path === '/projects' && link.id === 'projects'
        ? { ...link, to: { path: '/projects', query: { ...route.query, mine: undefined, offset: undefined } } }
        : link)
      .map(link => ({ ...link, active: isContextPathActive(route.path, link.to) }))
  })
  const module = computed(() => visibleShellModules(identityValue.value).find(item => item.id === activeModule.value) ?? null)
  return { activeModule, module, projectId, project, contextLinks }
}

/** Active test for a context link: the owning application's `isNavActive`, else same path or sub-path. */
export function isContextPathActive(path: string, to: ShellContextLink['to']): boolean {
  return isNavPathActive(path, typeof to === 'string' ? to : to.path ?? '')
}
