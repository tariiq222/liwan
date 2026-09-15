import type { ProjectSectionId } from './projectSections'
import { GOVERNANCE_SECTION_IDS, type GovernanceSectionId } from './governanceSections'
// Type-only: `ShellModule` lives with the rail model, and erasing this import
// keeps the runtime dependency one-way (shellModules -> activeRoute).
import type { ShellModule } from './shellModules'

/** Strips the query and hash and any trailing slash, so `/projects/` and `/projects?x=1` compare as `/projects`. */
export function normalizedPath(path: string): string {
  return path.split(/[?#]/, 1)[0]!.replace(/\/+$/, '') || '/'
}

export function projectIdFromPath(path: string): number | null {
  const match = normalizedPath(path).match(/^\/projects\/([^/]+)/)
  const parsed = match ? Number(match[1]) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** The four governance children keep their own top-level paths. */
const GOVERNANCE_SEGMENTS = new Set<string>(GOVERNANCE_SECTION_IDS)

const SECTION_SEGMENTS = new Set<ProjectSectionId>(['tasks', 'schedule', 'milestones', 'governance', 'finance', 'meetings', 'updates'])

export function activeProjectSection(path: string): ProjectSectionId | null {
  const id = projectIdFromPath(path)
  if (id === null) return null
  const rest = normalizedPath(path).replace(`/projects/${id}`, '').replace(/^\//, '')
  if (!rest) return 'summary'
  const head = rest.split('/', 1)[0]!
  if (GOVERNANCE_SEGMENTS.has(head)) return 'governance'
  return SECTION_SEGMENTS.has(head as ProjectSectionId) ? head as ProjectSectionId : null
}

/** The governance sub-tab that owns a path, including its record and form pages. */
export function activeGovernanceSection(path: string): GovernanceSectionId | null {
  const id = projectIdFromPath(path)
  if (id === null) return null
  const head = normalizedPath(path).replace(`/projects/${id}`, '').replace(/^\//, '').split('/', 1)[0]!
  return GOVERNANCE_SEGMENTS.has(head) ? head as GovernanceSectionId : null
}

export function activeShellModule(path: string): ShellModule | null {
  if (path === '/projects/dashboard' || path.startsWith('/projects/dashboard/')) return 'home'
  if (path === '/chat' || path.startsWith('/chat/')) return 'chat'
  if (path === '/meetings' || path.startsWith('/meetings/')) return 'meetings'
  if (path === '/hr' || path.startsWith('/hr/')) return 'hr'
  if (path === '/settings' || path.startsWith('/settings/')) return 'settings'
  if (path === '/reports' || path.startsWith('/reports/')) return 'projects'
  if (path === '/tasks' || path.startsWith('/tasks/') || path === '/archived-tasks') return 'projects'
  if (path === '/projects' || path.startsWith('/projects/') || path === '/project-templates' || path.startsWith('/project-templates/')) return 'projects'
  if (path === '/account' || path.startsWith('/account/')) return 'settings'
  if (path === '/search' || path.startsWith('/search/')) return 'projects'
  if (path === '/notifications' || path.startsWith('/notifications/')) return null
  if (path === '/notification-digests' || path.startsWith('/notification-digests/')) return null
  if (path === '/odoo' || path.startsWith('/odoo/')) return 'vendor'
  return null
}

/** The module whose contextual links a rail module shows; `home` shares the projects sidebar. */
export function contextModuleFor(module: ShellModule | null): ShellModule | null {
  return module === 'home' ? 'projects' : module
}
