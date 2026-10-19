import { normalizedPath } from '../../utils/routePath'
import { GOVERNANCE_SECTION_IDS, type GovernanceSectionId } from './governanceSections'
import type { ProjectSectionId } from './projectSections'

export function projectIdFromPath(path: string): number | null {
  const match = normalizedPath(path).match(/^\/projects\/([^/]+)/)
  const parsed = match ? Number(match[1]) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** The four governance children keep their own top-level paths. */
const GOVERNANCE_SEGMENTS = new Set<string>(GOVERNANCE_SECTION_IDS)

const SECTION_SEGMENTS = new Set<ProjectSectionId>(['tasks', 'governance', 'finance', 'meetings', 'updates'])

export function activeProjectSection(path: string): ProjectSectionId | null {
  const id = projectIdFromPath(path)
  if (id === null) return null
  const rest = normalizedPath(path).replace(`/projects/${id}`, '').replace(/^\//, '')
  if (!rest) return 'summary'
  const head = rest.split('/', 1)[0]!
  if (head === 'schedule' || head === 'milestones') return 'planning'
  if (GOVERNANCE_SEGMENTS.has(head)) return 'governance'
  return SECTION_SEGMENTS.has(head as ProjectSectionId) ? head as ProjectSectionId : null
}

/** Both planning views retain their own route, including records and forms. */
export function activePlanningSection(path: string): 'schedule' | 'milestones' | null {
  if (activeProjectSection(path) !== 'planning') return null
  return normalizedPath(path).split('/')[3] === 'milestones' ? 'milestones' : 'schedule'
}

/** The governance sub-tab that owns a path, including its record and form pages. */
export function activeGovernanceSection(path: string): GovernanceSectionId | null {
  const id = projectIdFromPath(path)
  if (id === null) return null
  const head = normalizedPath(path).replace(`/projects/${id}`, '').replace(/^\//, '').split('/', 1)[0]!
  return GOVERNANCE_SEGMENTS.has(head) ? head as GovernanceSectionId : null
}
