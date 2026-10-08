import type { ProjectSectionId } from './projectSections'
import { GOVERNANCE_SECTION_IDS, type GovernanceSectionId } from './governanceSections'
// Type-only: `ShellModule` lives with the rail model, and erasing this import
// keeps the runtime dependency one-way (shellModules -> activeRoute).
import type { ShellModule } from './shellModules'
import { manifestForPath } from '../../modules/manifests'
import type { AppManifest } from '../../modules/types'

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

/** The rail module of a path an application owns: its most specific nav item, else the application's default rail. */
function moduleWithinApp(manifest: AppManifest, path: string): ShellModule {
  const pathname = normalizedPath(path)
  const item = [...manifest.nav]
    .sort((a, b) => b.to.length - a.to.length)
    .find(candidate => pathname === candidate.to || pathname.startsWith(`${candidate.to}/`))
  if (item) return item.module ?? manifest.id
  const fallback = manifest.defaultRail ?? manifest.id
  return manifest.rail.some(entry => entry.id === fallback) ? fallback : manifest.rail[0]?.id ?? fallback
}

export function activeShellModule(path: string): ShellModule | null {
  if (path === '/vendor' || path.startsWith('/vendor/')) return 'management'
  const owner = manifestForPath(path)
  if (owner) return moduleWithinApp(owner, path)
  if (path === '/settings' || path.startsWith('/settings/')) return 'settings'
  if (path === '/subscription' || path.startsWith('/subscription/')) return 'settings'
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
