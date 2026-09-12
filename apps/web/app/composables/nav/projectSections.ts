import { hasCapability, type AccessIdentity } from '../../utils/accessPolicy'

/** Declared here (not re-imported from useNav) so useNav can later re-export this module without a cycle. */
export type NavIcon = `i-lucide-${string}`

export const PROJECT_SECTION_IDS = ['summary', 'tasks', 'schedule', 'milestones', 'governance', 'finance', 'updates'] as const
export type ProjectSectionId = typeof PROJECT_SECTION_IDS[number]

export interface ProjectSection {
  id: ProjectSectionId
  labelKey: string
  icon: NavIcon
  to: string
  capability: string
}

/** Sections hidden on an archived project: everything that mutates or plans work. */
const ARCHIVED_HIDDEN: readonly ProjectSectionId[] = ['tasks', 'milestones', 'governance']

const DEFINITIONS: Array<Omit<ProjectSection, 'to'> & { segment: string }> = [
  { id: 'summary', labelKey: 'nav.projectSummary', icon: 'i-lucide-layout-dashboard', segment: '', capability: 'pmo.projects.read' },
  { id: 'tasks', labelKey: 'nav.projectTasks', icon: 'i-lucide-clipboard-list', segment: '/tasks', capability: 'pmo.tasks.read' },
  { id: 'schedule', labelKey: 'projects.planningLinks.schedule', icon: 'i-lucide-calendar-range', segment: '/schedule', capability: 'pmo.tasks.read' },
  { id: 'milestones', labelKey: 'projects.tabs.milestones', icon: 'i-lucide-flag', segment: '/milestones', capability: 'pmo.tasks.read' },
  { id: 'governance', labelKey: 'projects.workspace.groups.governance', icon: 'i-lucide-shield-check', segment: '/governance', capability: 'pmo.projects.read' },
  { id: 'finance', labelKey: 'nav.projectFinance', icon: 'i-lucide-wallet-cards', segment: '/finance', capability: 'pmo.projects.read' },
  { id: 'updates', labelKey: 'projects.tabs.updates', icon: 'i-lucide-megaphone', segment: '/updates', capability: 'pmo.projects.read' },
]

export function projectSections(
  projectId: number,
  identity: AccessIdentity,
  options: { active: boolean },
): ProjectSection[] {
  return DEFINITIONS
    .filter(definition => options.active || !ARCHIVED_HIDDEN.includes(definition.id))
    .filter(definition => hasCapability(identity, definition.capability))
    .map(({ segment, ...rest }) => ({ ...rest, to: `/projects/${projectId}${segment}` }))
}
