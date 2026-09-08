import { toValue, type MaybeRefOrGetter } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
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
  type ShellModuleDefinition,
} from './useNav'
import type { AccessIdentity } from '@/utils/accessPolicy'
import { safeReturnTo } from '../utils/safeReturnTo'
import { parseChatListRoute, serializeChatListRoute } from '../utils/chatState'
import { adminListQuery, adminPathWithQuery } from './adminSettingsPaths'

export interface ShellBreadcrumb {
  id: string
  labelKey: string
  to?: RouteLocationRaw
  current?: boolean
  raw?: boolean
}

export interface ShellBreadcrumbTarget {
  routeKey: string
  href: string | null
}

export function useShellBreadcrumbTarget() {
  return useState<ShellBreadcrumbTarget>('nasq-shell-breadcrumb-target', () => ({ routeKey: '', href: null }))
}

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

function routePath(to: ShellContextLink['to']): string {
  return normalizedPath(typeof to === 'string' ? to.split(/[?#]/, 1)[0]! : to.path ?? '')
}

function routeQuery(to: ShellContextLink['to']): Record<string, unknown> {
  return typeof to === 'string' ? {} : (to.query ?? {}) as Record<string, unknown>
}

function rootReturnTo(query: Record<string, unknown>, module: ShellModule): { raw: string; path: string } | null {
  const allowed = module === 'projects'
    ? ['/projects', '/project-templates']
    : module === 'tasks'
      ? ['/tasks', '/archived-tasks']
      : module === 'meetings'
        ? ['/meetings']
        : module === 'chat'
          ? ['/chat']
          : module === 'hr'
            ? ['/hr']
            : module === 'settings'
              ? ['/account', '/settings']
              : []
  const raw = safeReturnTo(query.returnTo, '', allowed)
  if (!raw) return null
  const target = new URL(raw, 'http://nasq.local')
  const path = normalizedPath(target.pathname)
  if (shellSectionRoot(path)) return { raw, path }
  if (module === 'projects' && path === '/project-templates') return { raw, path }
  return null
}

function contextLinkForRoot(path: string, query: Record<string, unknown>, links: ShellContextLink[]): ShellContextLink | undefined {
  const normalized = normalizedPath(path)
  const mine = query.mine === '1' || query.mine === 'true'
  return links.find(link => {
    if (link.pinned) return false
    const linkPath = routePath(link.to)
    if (normalized === '/projects' && linkPath === '/projects') {
      const linkMine = routeQuery(link.to).mine === '1' || routeQuery(link.to).mine === 'true'
      return linkMine === mine
    }
    return linkPath === normalized
  })
}

function withChatListState(link: ShellContextLink | undefined, query: Record<string, unknown>): ShellContextLink | undefined {
  if (!link) return undefined
  const chatQuery = serializeChatListRoute(parseChatListRoute(query))
  return Object.values(chatQuery).some(Boolean) ? { ...link, to: { path: '/chat', query: chatQuery } } : link
}

function withAdminListState(link: ShellContextLink, query: Record<string, unknown>): ShellContextLink {
  const adminKeys: Record<string, string[]> = {
    users: ['q', 'status', 'role_id', 'department_id', 'offset'],
    roles: ['q', 'type', 'status', 'offset'],
    'access-log': ['from', 'to', 'actor_id', 'target_type', 'target_id', 'action', 'offset'],
  }
  const keys = adminKeys[link.id]
  if (!keys) return link
  const adminQuery = adminListQuery(query, keys)
  return Object.keys(adminQuery).length ? { ...link, to: adminPathWithQuery(routePath(link.to), adminQuery) } : link
}

function contextAncestorForRoute(
  path: string,
  query: Record<string, unknown>,
  module: ShellModule,
  links: ShellContextLink[],
): ShellContextLink | undefined {
  const nonPinned = links.filter(link => !link.pinned)
  const returnRoot = rootReturnTo(query, module)
  if (returnRoot) {
    const returned = contextLinkForRoot(returnRoot.path, Object.fromEntries(new URL(returnRoot.raw, 'http://nasq.local').searchParams.entries()), nonPinned)
    if (returned) return { ...returned, to: returnRoot.raw }
    if (module === 'projects' && returnRoot.path === '/project-templates') {
      const projects = nonPinned.find(link => link.id === 'projects')
      if (projects) return { id: 'project-templates', labelKey: 'projects.templates.title', icon: projects.icon, to: returnRoot.raw, capability: projects.capability }
    }
  }

  const normalized = normalizedPath(path)
  if (module === 'projects' && (normalized === '/projects/new' || normalized === '/project-templates' || normalized.startsWith('/project-templates/'))) {
    if (normalized === '/projects/new') return contextLinkForRoot('/projects', query, nonPinned) ?? nonPinned.find(link => routePath(link.to) === '/projects')
    if (normalized === '/project-templates') return nonPinned.find(link => link.id === 'projects')
    const templates = nonPinned.find(link => link.id === 'projects')
    return templates ? { id: 'project-templates', labelKey: 'projects.templates.title', icon: templates.icon, to: '/project-templates', capability: templates.capability } : undefined
  }
  if (module === 'chat' && normalized === '/chat/new') return withChatListState(nonPinned.find(link => link.id === 'chat'), query)
  if (module === 'meetings' && normalized === '/meetings/new') return nonPinned.find(link => link.id === 'meetings')

  const active = nonPinned.find(link => link.active)
  if (active) {
    if (module === 'chat' && active.id === 'chat') return withChatListState(active, query)
    return module === 'settings' ? withAdminListState(active, query) : active
  }
  return undefined
}

export function shellBreadcrumbsForRoute(
  path: string,
  query: Record<string, unknown>,
  currentModule: ShellModuleDefinition | null | undefined,
  links: ShellContextLink[],
): ShellBreadcrumb[] {
  if (!currentModule) return []
  if (path === '/search' || path.startsWith('/search/') || path === '/notifications' || path.startsWith('/notifications/') || path === '/notification-digests' || path.startsWith('/notification-digests/')) return []
  const projectId = projectIdFromPath(path)
  const active = links.find(item => item.active)
  if (projectId) return projectBreadcrumbsForRoute(path, query, active)
  if (shellSectionRoot(path)) return []
  const ancestor = contextAncestorForRoute(path, query, currentModule.id, links)
  return ancestor ? [{ id: ancestor.id, labelKey: ancestor.labelKey, to: ancestor.to }] : []
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

export function projectBreadcrumbsForRoute(
  path: string,
  query: Record<string, unknown>,
  active: ShellContextLink | undefined,
): ShellBreadcrumb[] {
  if (!projectIdFromPath(path) || projectSectionRoot(path, query)) return []
  if (!active) return []
  const projectId = projectIdFromPath(path)!
  const returnTo = safeReturnTo(query.returnTo, '', ['/projects'])
  if (returnTo) {
    const target = new URL(returnTo, 'http://nasq.local')
    const targetQuery = Object.fromEntries(target.searchParams.entries())
    if (projectIdFromPath(target.pathname) === projectId && projectSectionRoot(target.pathname, targetQuery) === active.id) {
      return [{ id: active.id, labelKey: active.labelKey, to: returnTo }]
    }
  }
  return [{ id: active.id, labelKey: active.labelKey, to: active.to }]
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
  const breadcrumbs = computed<ShellBreadcrumb[]>(() => {
    const currentModule = module.value
    if (!currentModule) return []
    return shellBreadcrumbsForRoute(route.path, route.query, currentModule, contextLinks.value)
  })
  return { activeModule, module, projectId, project, contextLinks, breadcrumbs }
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
