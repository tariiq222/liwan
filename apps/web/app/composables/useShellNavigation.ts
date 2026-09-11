import { toValue, type MaybeRefOrGetter } from 'vue'
import { useProject } from './useProjects'
import {
  activeShellModule,
  contextLinksForModule,
  contextModuleFor,
  projectSidebarLinks,
  visibleShellModules,
  type ProjectContextId,
  type ShellContextLink,
  type ShellModule,
} from './useNav'
import type { AccessIdentity } from '@/utils/accessPolicy'

function positiveId(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function projectIdFromPath(path: string): number | null {
  const match = path.match(/^\/projects\/([^/]+)/)
  return match ? positiveId(match[1]) : null
}

const projectRootSections: Record<string, ProjectContextId> = {
  schedule: 'planning',
  stakeholders: 'stakeholders',
  raci: 'stakeholders',
  register: 'risks',
  finance: 'finance',
  charter: 'charter',
  settings: 'settings',
  updates: 'summary',
}

const shellSectionRoots = new Set([
  '/projects/dashboard',
  '/projects',
  '/project-templates',
  '/tasks',
  '/archived-tasks',
  '/meetings',
  '/meetings/calendar',
  '/meetings/series',
  '/chat',
  '/hr',
  '/hr/departments',
  '/hr/documents',
  '/account',
  '/settings/appearance',
  '/settings/branding',
  '/settings/projects',
  '/settings/users',
  '/settings/roles',
  '/settings/access-log',
])

function normalizedPath(path: string): string {
  return path.split(/[?#]/, 1)[0]!.replace(/\/+$/, '') || '/'
}

/** Returns the exact shared-shell root represented by a route, if any. */
export function shellSectionRoot(path: string, _query: Record<string, unknown> = {}): string | null {
  const normalized = normalizedPath(path)
  return shellSectionRoots.has(normalized) ? normalized : null
}

export function shellRootBackTargets(path: string): readonly string[] {
  const normalized = normalizedPath(path)
  if (normalized === '/projects' || normalized === '/projects/dashboard' || normalized === '/project-templates') return ['/projects', '/projects/dashboard', '/project-templates']
  if (normalized === '/tasks' || normalized === '/archived-tasks') return ['/tasks', '/archived-tasks']
  if (normalized === '/meetings' || normalized === '/meetings/calendar') return ['/meetings', '/meetings/calendar']
  if (normalized === '/hr' || normalized === '/hr/departments' || normalized === '/hr/documents') return ['/hr', '/hr/departments', '/hr/documents']
  if (normalized === '/account' || normalized.startsWith('/settings/')) return ['/account', '/settings/appearance', '/settings/branding', '/settings/projects', '/settings/users', '/settings/roles', '/settings/access-log']
  return []
}

/** Returns the project context owned by an exact, top-level section route. */
export function projectSectionRoot(path: string, query: Record<string, unknown> = {}): ProjectContextId | null {
  const normalized = path.replace(/\/+$/, '') || '/'
  const match = normalized.match(/^\/projects\/([^/]+)(?:\/(.*))?$/)
  if (!match || !positiveId(match[1])) return null
  const section = match[2]
  if (!section) {
    return query.tab === 'summary' ? 'summary' : 'planning'
  }
  return Object.hasOwn(projectRootSections, section) ? projectRootSections[section]! : null
}

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
  const isProjectRoot = computed(() => /^\/projects\/\d+\/?$/.test(route.path))
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
  // The sidebar breadcrumb still resolves project sections by id.
  const breadcrumbLinks = computed<ShellContextLink[]>(() => {
    if (projectId.value && activeModule.value === 'projects') {
      return projectSidebarLinks(projectId.value, identityValue.value, project.data.value?.active === true, project.data.value?.can_manage === true, route.query, isProjectRoot.value)
    }
    return contextLinks.value
  })
  const module = computed(() => visibleShellModules(identityValue.value).find(item => item.id === activeModule.value) ?? null)
  return { activeModule, module, projectId, project, contextLinks, breadcrumbLinks }
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
  if (target === '/settings/appearance') return path === target || path.startsWith(`${target}/`)
  return path === target || path.startsWith(`${target}/`)
}
