import type { ProjectToolsState } from '@liwan/contracts'
import { projectSectionAvailable } from '../../utils/projectTools'
import { hasCapability, type AccessIdentity } from '../../utils/accessPolicy'
import type { AppIcon } from '../types'

/** The five tabs of the project workspace, in order. Updates live in the summary and planning is the tasks' timeline view. */
export const PROJECT_SECTION_IDS = ['summary', 'tasks', 'meetings', 'finance', 'governance'] as const
export type ProjectSectionId = typeof PROJECT_SECTION_IDS[number]

export interface ProjectSection {
  id: ProjectSectionId
  labelKey: string
  icon: AppIcon
  to: string
  capability: string
}

/** Sections hidden on an archived project: the ones that mutate work. */
const ARCHIVED_HIDDEN: readonly ProjectSectionId[] = ['tasks', 'governance']

const DEFINITIONS: Array<Omit<ProjectSection, 'to'> & { segment: string }> = [
  { id: 'summary', labelKey: 'nav.projectSummary', icon: 'i-lucide-layout-dashboard', segment: '', capability: 'pmo.projects.read' },
  { id: 'tasks', labelKey: 'nav.projectTasks', icon: 'i-lucide-clipboard-list', segment: '/tasks', capability: 'pmo.tasks.read' },
  { id: 'meetings', labelKey: 'projects.tabs.meetings', icon: 'i-lucide-calendar-days', segment: '/meetings', capability: 'meetings.read' },
  { id: 'finance', labelKey: 'nav.projectFinance', icon: 'i-lucide-wallet-cards', segment: '/finance', capability: 'pmo.projects.read' },
  { id: 'governance', labelKey: 'projects.workspace.groups.governance', icon: 'i-lucide-shield-check', segment: '/charter', capability: 'pmo.projects.read' },
]

export function projectSections(
  projectId: number,
  identity: AccessIdentity,
  options: { active: boolean; tools?: ProjectToolsState; canReadFinance?: boolean },
): ProjectSection[] {
  return DEFINITIONS
    .filter(definition => projectSectionAvailable(definition.id, options.tools))
    .filter(definition => definition.id !== 'finance' || options.canReadFinance !== false)
    .filter(definition => options.active || !ARCHIVED_HIDDEN.includes(definition.id))
    .filter(definition => hasCapability(identity, definition.capability))
    .sort((a, b) => (PROJECT_SECTION_IDS as readonly string[]).indexOf(a.id) - (PROJECT_SECTION_IDS as readonly string[]).indexOf(b.id))
    .map(({ segment, ...rest }) => ({ ...rest, to: `/projects/${projectId}${segment}` }))
}

/** The planning pages that are not a view of the tasks: the timeline view they link back to, the baselines and the milestones. */
export function planningSections(projectId: number, options: { active: boolean; baselines?: boolean }) {
  return [
    { id: 'timeline' as const, labelKey: 'projects.planningLinks.schedule', icon: 'i-lucide-calendar-range' as AppIcon, to: `/projects/${projectId}/tasks`, query: { view: 'timeline' } },
    ...(options.baselines ? [{ id: 'baselines' as const, labelKey: 'nav.projectBaselines', icon: 'i-lucide-flag' as AppIcon, to: `/projects/${projectId}/baselines` }] : []),
    ...(options.active ? [{ id: 'milestones' as const, labelKey: 'projects.tabs.milestones', icon: 'i-lucide-flag' as AppIcon, to: `/projects/${projectId}/milestones` }] : []),
  ]
}
