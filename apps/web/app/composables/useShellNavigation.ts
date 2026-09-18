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
import type { AccessIdentity } from '@/utils/accessPolicy'

export function useModuleRail() {
  const expanded = useState('nasq-module-rail-expanded', () => false)
  const hydrated = useHydrated()
  function toggle() {
    if (hydrated.value) expanded.value = !expanded.value
  }
  return { expanded, hydrated, toggle }
}

export function useContextSidebar() {
  const expanded = useState('nasq-context-sidebar-expanded', () => true)
  const hydrated = useHydrated()
  function toggle() {
    if (hydrated.value) expanded.value = !expanded.value
  }
  return { expanded, hydrated, toggle }
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
      .map(link => ({ ...link, active: isContextPathActive(route.path, link.to, route.query) }))
  })
  const module = computed(() => visibleShellModules(identityValue.value).find(item => item.id === activeModule.value) ?? null)
  return { activeModule, module, projectId, project, contextLinks }
}

export function isContextPathActive(path: string, to: ShellContextLink['to'], query: Record<string, unknown> = {}): boolean {
  const target = typeof to === 'string' ? to : to.path
  if (target === '/hr') return path === '/hr' || (path.startsWith('/hr/employees/') && path !== '/hr/employees/new')
  if (target === '/hr/documents') return (path === target || (path.startsWith(`${target}/`) && path !== '/hr/documents/new') || /^\/hr\/departments\/[^/]+\/documents(?:\/|$)/.test(path))
  if (target === '/hr/departments') return path === target || (path.startsWith(`${target}/`) && path !== '/hr/departments/new' && !/\/documents(?:\/|$)/.test(path))
  if (target === '/meetings') return path === target || (path.startsWith(`${target}/`) && path !== '/meetings/new' && !path.startsWith('/meetings/calendar') && !path.startsWith('/meetings/series'))
  if (target === '/chat') return path === target || (path.startsWith(`${target}/`) && !path.startsWith('/chat/new'))
  if (target === '/meetings/calendar') return path === target
  // «كل المشاريع» stays active on the list, its create form and every project record.
  if (target === '/projects') return path === target || path === '/projects/new' || /^\/projects\/[1-9]\d*(?:\/|$)/.test(path)
  if (target === '/tasks') return path === target || path.startsWith('/tasks/') || path === '/archived-tasks'
  return path === target || path.startsWith(`${target}/`)
}
