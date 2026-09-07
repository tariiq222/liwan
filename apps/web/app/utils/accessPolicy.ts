import { safeReturnTo } from './safeReturnTo'

/** Server capabilities gate navigation; resource authorization remains on the API. */
export type AccessIdentity = { role?: string; capabilities?: readonly string[] } | null | undefined
/** Authenticated Nasq /api/v1/me identities carry a capabilities array. Portal/legacy role-only objects do not. */
export const INTERNAL_NASQ_ACCESS = 'nasq.internal'
/** UI predicate for the shared inbox; this is not a server capability grant. */
export const NOTIFICATION_ACCESS = 'nasq.notifications'
export function hasCapability(identity: AccessIdentity, capability: string): boolean {
  if (capability === INTERNAL_NASQ_ACCESS) return Array.isArray(identity?.capabilities)
  if (capability === NOTIFICATION_ACCESS) return ['pmo.tasks.read', 'meetings.read'].some(key => identity?.capabilities?.includes(key))
  return identity?.capabilities?.includes(capability) ?? false
}

const destinations = [
  ['/tasks', 'pmo.tasks.read'], ['/projects', 'pmo.projects.read'],
  ['/project-templates', 'pmo.projects.read'], ['/reports', 'pmo.projects.read'],
  ['/meetings', 'meetings.read'], ['/meetings/calendar', 'meetings.read'],
  ['/hr', 'hr.employees.read'], ['/hr/departments', 'hr.departments.read'],
  ['/hr/documents', 'hr.documents.read'], ['/settings/users', 'access.users.read'],
  ['/settings/roles', 'access.roles.read'], ['/settings/access-log', 'access.audit.read'],
  ['/settings/projects', 'pmo.settings.manage'], ['/settings/branding', 'settings.branding.manage'],
] as const
export function firstAllowedPath(identity: AccessIdentity): string {
  return destinations.find(([, capability]) => hasCapability(identity, capability))?.[0] ?? '/account'
}
export function postLoginPath(identity: AccessIdentity, next: unknown): string {
  const fallback = firstAllowedPath(identity)
  const target = safeReturnTo(next, fallback, [...destinations.map(([path]) => path), '/account', '/search', '/notifications', '/archived-tasks', '/settings/appearance', '/chat'])
  const capability = requiredCapabilityForPath(new URL(target, 'http://nasq.local').pathname)
  return capability && !hasCapability(identity, capability) ? fallback : target
}
export function isNavPathActive(path: string, target: string): boolean {
  const document = /^\/hr\/departments\/[^/]+\/documents(?:\/|$)/.test(path)
  if (target === '/hr') return path === '/hr' || path.startsWith('/hr/employees/')
  if (target === '/hr/documents') return path === target || path.startsWith(`${target}/`) || document
  if (target === '/hr/departments' && document) return false
  if (target === '/meetings' && path.startsWith('/meetings/calendar')) return false
  if (target === '/meetings/calendar') return path === '/meetings/calendar'
  return path === target || path.startsWith(`${target}/`)
}
export function requiredCapabilityForPath(path: string): string | null {
  if (path === '/chat' || path.startsWith('/chat/')) return INTERNAL_NASQ_ACCESS
  if (/^\/project-templates\/(new|[^/]+\/edit)$/.test(path)) return 'pmo.settings.manage'
  if (path === '/notifications') return NOTIFICATION_ACCESS
  if (path === '/archived-tasks') return 'pmo.tasks.read'
  if (path === '/meetings/new') return 'meetings.create'
  if (/^\/meetings\/[^/]+\/(edit|resolutions\/new)$/.test(path)) return 'meetings.read'
  if (path === '/hr/documents/new') return 'hr.documents.manage'
  if (path === '/tasks/new' || /^\/projects\/[^/]+\/tasks\/new$/.test(path)) return 'pmo.tasks.create'
  if (path === '/projects/new') return 'pmo.projects.create'
  if (path === '/settings/users/new') return 'access.users.grant'
  if (/^\/settings\/users\/[^/]+\/access$/.test(path)) return 'access.users.assign_roles'
  if (/^\/settings\/roles\/(new|[^/]+\/edit)$/.test(path)) return 'access.roles.manage'
  if (/^\/hr\/departments\/[^/]+\/documents(?:\/|$)/.test(path)) {
    return /\/(new|edit)$/.test(path) ? 'hr.documents.manage' : 'hr.documents.read'
  }
  if (/^\/hr\/employees\/(new|[^/]+\/edit)$/.test(path)) return 'hr.employees.manage'
  if (/^\/hr\/departments\/(new|[^/]+\/edit)$/.test(path)) return 'hr.departments.manage'
  if (/^\/hr\/employees\/[^/]+\/access$/.test(path)) return 'access.users.grant'
  return destinations.find(([target]) => isNavPathActive(path, target))?.[1] ?? null
}
