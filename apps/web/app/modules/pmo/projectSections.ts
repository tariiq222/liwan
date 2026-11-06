import type { ProjectToolsState } from '@liwan/contracts'
import { projectSectionAvailable } from '../../utils/projectTools'
import { hasCapability, type AccessIdentity } from '../../utils/accessPolicy'
import type { AppIcon } from '../types'

export const PROJECT_SECTION_IDS = ['summary', 'tasks', 'updates', 'planning', 'governance', 'finance'] as const
export type ProjectSectionId = typeof PROJECT_SECTION_IDS[number] | 'meetings'

export interface ProjectSection {
  id: ProjectSectionId
  labelKey: string
  icon: AppIcon
  to: string
  capability: string
}

/** Sections hidden on an archived project: everything that mutates or plans work. */
const ARCHIVED_HIDDEN: readonly ProjectSectionId[] = ['tasks', 'governance']

const DEFINITIONS: Array<Omit<ProjectSection, 'to'> & { segment: string }> = [
  { id: 'summary', labelKey: 'nav.projectSummary', icon: 'i-lucide-layout-dashboard', segment: '', capability: 'pmo.projects.read' },
  { id: 'tasks', labelKey: 'nav.projectTasks', icon: 'i-lucide-clipboard-list', segment: '/tasks', capability: 'pmo.tasks.read' },
  { id: 'planning', labelKey: 'projects.planningLinks.title', icon: 'i-lucide-calendar-range', segment: '/schedule', capability: 'pmo.tasks.read' },
  { id: 'governance', labelKey: 'projects.workspace.groups.governance', icon: 'i-lucide-shield-check', segment: '/charter', capability: 'pmo.projects.read' },
  { id: 'finance', labelKey: 'nav.projectFinance', icon: 'i-lucide-wallet-cards', segment: '/finance', capability: 'pmo.projects.read' },
  { id: 'updates', labelKey: 'projects.tabs.updates', icon: 'i-lucide-megaphone', segment: '/updates', capability: 'pmo.projects.read' },
]

export function projectSections(
  projectId: number,
  identity: AccessIdentity,
  options: { active: boolean; tools?: ProjectToolsState },
): ProjectSection[] {
  return DEFINITIONS
    .filter(definition => projectSectionAvailable(definition.id, options.tools))
    .filter(definition => options.active || !ARCHIVED_HIDDEN.includes(definition.id))
    .filter(definition => hasCapability(identity, definition.capability))
    .sort((a, b) => (PROJECT_SECTION_IDS as readonly string[]).indexOf(a.id) - (PROJECT_SECTION_IDS as readonly string[]).indexOf(b.id))
    .map(({ segment, ...rest }) => ({ ...rest, to: `/projects/${projectId}${segment}` }))
}

/** Planning keeps its two stable URLs under one primary section. */
export function planningSections(projectId: number, options: { active: boolean; baselines?: boolean }) {
  return [
    { id: 'schedule' as const, labelKey: 'projects.planningLinks.schedule', icon: 'i-lucide-calendar-range' as AppIcon, to: `/projects/${projectId}/schedule` },
    ...(options.baselines ? [{ id: 'baselines' as const, labelKey: 'nav.projectBaselines', icon: 'i-lucide-flag' as AppIcon, to: `/projects/${projectId}/baselines` }] : []),
    ...(options.active ? [{ id: 'milestones' as const, labelKey: 'projects.tabs.milestones', icon: 'i-lucide-flag' as AppIcon, to: `/projects/${projectId}/milestones` }] : []),
  ]
}
