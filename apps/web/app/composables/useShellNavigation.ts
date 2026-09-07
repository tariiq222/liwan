import { toValue, type MaybeRefOrGetter } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { useProject } from './useProjects'
import {
  activeShellModule,
  contextLinksForModule,
  projectContextId,
  projectContextLinks,
  visibleShellModules,
  type ShellContextLink,
  type ShellModule,
} from './useNav'
import type { AccessIdentity } from '@/utils/accessPolicy'

export interface ShellBreadcrumb {
  id: string
  labelKey: string
  to?: RouteLocationRaw
  current?: boolean
  raw?: boolean
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
      .map(link => ({ ...link, active: isContextPathActive(route.path, link.to) }))
  })
  const module = computed(() => visibleShellModules(identityValue.value).find(item => item.id === activeModule.value) ?? null)
  const breadcrumbs = computed<ShellBreadcrumb[]>(() => {
    const currentModule = module.value
    if (!currentModule) return []
    const result: ShellBreadcrumb[] = [{ id: currentModule.id, labelKey: currentModule.labelKey, to: currentModule.to }]
    if (projectId.value && project.data.value) {
      result.push({ id: 'project', labelKey: project.data.value.name, raw: true, to: `/projects/${projectId.value}` })
    }
    const active = contextLinks.value.find(item => item.active)
    if (active) result.push({ id: active.id, labelKey: active.labelKey, current: true })
    return result
  })
  return { activeModule, module, projectId, project, contextLinks, breadcrumbs }
}

export function isContextPathActive(path: string, to: ShellContextLink['to']): boolean {
  const target = typeof to === 'string' ? to : to.path
  if (target === '/hr') return path === '/hr' || path.startsWith('/hr/employees/')
  if (target === '/hr/documents') return path === target || path.startsWith(`${target}/`) || /^\/hr\/departments\/[^/]+\/documents(?:\/|$)/.test(path)
  if (target === '/hr/departments') return path === target || (path.startsWith(`${target}/`) && !/\/documents(?:\/|$)/.test(path))
  if (target === '/meetings') return path === target || (path.startsWith(`${target}/`) && !path.startsWith('/meetings/calendar'))
  if (target === '/meetings/calendar') return path === target
  if (target === '/projects') return path === target || path.startsWith('/projects/')
  if (target === '/tasks') return path === target || path.startsWith('/tasks/')
  if (target === '/settings/appearance') return path === target || path.startsWith(`${target}/`)
  return path === target || path.startsWith(`${target}/`)
}
