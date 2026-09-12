import type { ProjectSectionId } from './projectSections'

function normalized(path: string): string {
  return path.split(/[?#]/, 1)[0]!.replace(/\/+$/, '') || '/'
}

export function projectIdFromPath(path: string): number | null {
  const match = normalized(path).match(/^\/projects\/([^/]+)/)
  const parsed = match ? Number(match[1]) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** The four governance children keep their own top-level paths. */
const GOVERNANCE_SEGMENTS = new Set(['charter', 'stakeholders', 'raci', 'register'])

const SECTION_SEGMENTS = new Set<ProjectSectionId>(['tasks', 'schedule', 'milestones', 'governance', 'finance', 'updates'])

export function activeProjectSection(path: string): ProjectSectionId | null {
  const id = projectIdFromPath(path)
  if (id === null) return null
  const rest = normalized(path).replace(`/projects/${id}`, '').replace(/^\//, '')
  if (!rest) return 'summary'
  const head = rest.split('/', 1)[0]!
  if (GOVERNANCE_SEGMENTS.has(head)) return 'governance'
  return SECTION_SEGMENTS.has(head as ProjectSectionId) ? head as ProjectSectionId : null
}
