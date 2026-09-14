import type { NavIcon } from './projectSections'

export const GOVERNANCE_SECTION_IDS = ['charter', 'stakeholders', 'raci', 'register'] as const
export type GovernanceSectionId = typeof GOVERNANCE_SECTION_IDS[number]

export interface GovernanceSection {
  id: GovernanceSectionId
  labelKey: string
  icon: NavIcon
  to: string
}

const DEFINITIONS: Array<Omit<GovernanceSection, 'to'>> = [
  { id: 'charter', labelKey: 'nav.projectCharter', icon: 'i-lucide-file-text' },
  { id: 'stakeholders', labelKey: 'nav.projectStakeholders', icon: 'i-lucide-users' },
  { id: 'raci', labelKey: 'projects.workspace.sections.raci', icon: 'i-lucide-grid-3x3' },
  { id: 'register', labelKey: 'nav.projectRisks', icon: 'i-lucide-circle-alert' },
]

/** The governance sub-tabs. Each keeps its own top-level project path; the section capability is checked by the parent tab. */
export function governanceSections(projectId: number): GovernanceSection[] {
  return DEFINITIONS.map(definition => ({ ...definition, to: `/projects/${projectId}/${definition.id}` }))
}
