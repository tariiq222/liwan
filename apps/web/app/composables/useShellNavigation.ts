import { toValue, type MaybeRefOrGetter } from 'vue'
import { useProject } from './useProjects'
import {
  activeShellModule,
  contextLinksForModule,
  projectContextId,
  projectContextLinks,
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
}

const shellSectionRoots = new Set([
  '/projects/dashboard',
  '/projects',
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
  if (normalized === '/projects' || normalized === '/projects/dashboard') return ['/projects', '/projects/dashboard']
  if (normalized === '/tasks' || normalized === '/archived-tasks') return ['/tasks', '/archived-tasks']
  if (normalized === '/meetings' || normalized === '/meetings/calendar') return ['/meetings', '/meetings/calendar']
  if (normalized === '/hr' || normalized === '/hr/departments' || normalized === '/hr/documents') return ['/hr', '/hr/departments', '/hr/documents']
  if (normalized === '/account' || normalized.startsWith('/settings/')) return ['/account', '/settings/appearance', '/settings/projects', '/settings/users', '/settings/roles', '/settings/access-log']
  return []
}

/** Returns the project context owned by an exact, top-level section route. */
export function projectSectionRoot(path: string, query: Record<string, unknown> = {}): ProjectContextId | null {
  const normalized = path.replace(/\/+$/, '') || '/'
  const match = normalized.match(/^\/projects\/([^/]+)(?:\/(.*))?$/)
  if (!match || !positiveId(match[1])) return null
  const section = match[2]
  if (!section) {
    return ['tasks', 'list', 'board', 'milestones'].includes(String(query.tab)) || ['table', 'board'].includes(String(query.view))
      ? 'planning'
      : 'summary'
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

export function useShellNavigation(identity: MaybeRefOrGetter<AccessIdentity>) {
  const route = useRoute()
  const identityValue = computed(() => toValue(identity))
  const activeModule = computed<ShellModule | null>(() => activeShellModule(route.path))
  const projectId = computed(() => projectIdFromPath(route.path))
  const projectQuery = useProject(projectId)
  const hydrated = useHydrated()
  // Server and first client render must use the same navigation shape.
  const project = { ...projectQuery, data: computed(() => hydrated.value ? projectQuery.data.value : undefined) }
  const contextLinks = computed<ShellContextLink[]>(() => {
    const currentModule = activeModule.value
    if (projectId.value && currentModule === 'projects') {
      return projectContextLinks(projectId.value, identityValue.value, project.data.value?.active === true, project.data.value?.can_manage === true, route.query)
        .map(link => ({ ...link, active: projectContextId(route.path, route.query) === link.id }))
    }
    if (!currentModule) return []
    return contextLinksForModule(currentModule, identityValue.value)
      .map(link => ({ ...link, active: isContextPathActive(route.path, link.to, route.query) }))
  })
  const module = computed(() => visibleShellModules(identityValue.value).find(item => item.id === activeModule.value) ?? null)
  return { activeModule, module, projectId, project, contextLinks }
}

export function isContextPathActive(path: string, to: ShellContextLink['to'], query: Record<string, unknown> = {}): boolean {
  const target = typeof to === 'string' ? to : to.path
  if (target === '/hr') return path === '/hr' || path.startsWith('/hr/employees/')
  if (target === '/hr/documents') return path === target || path.startsWith(`${target}/`) || /^\/hr\/departments\/[^/]+\/documents(?:\/|$)/.test(path)
  if (target === '/hr/departments') return path === target || (path.startsWith(`${target}/`) && !/\/documents(?:\/|$)/.test(path))
  if (target === '/meetings') return path === target || (path.startsWith(`${target}/`) && !path.startsWith('/meetings/calendar'))
  if (target === '/chat') return path === target || (path.startsWith(`${target}/`) && !path.startsWith('/chat/new'))
  if (target === '/meetings/calendar') return path === target
  if (target === '/projects') {
    const mine = query.mine === '1' || query.mine === 'true'
    const targetMine = typeof to === 'object' && 'query' in to && (to.query?.mine === '1' || to.query?.mine === 'true')
    return path === target && mine === Boolean(targetMine)
  }
  if (target === '/tasks') return path === target || path.startsWith('/tasks/')
  if (target === '/settings/appearance') return path === target || path.startsWith(`${target}/`)
  return path === target || path.startsWith(`${target}/`)
}
