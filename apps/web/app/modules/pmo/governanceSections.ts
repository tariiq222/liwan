import type { AppIcon } from '../types'

export const GOVERNANCE_SECTION_IDS = ['charter', 'stakeholders', 'raci', 'register', 'changes'] as const
export type GovernanceSectionId = typeof GOVERNANCE_SECTION_IDS[number]

export interface GovernanceSection {
  id: GovernanceSectionId
  labelKey: string
  icon: AppIcon
  to: string
}

const DEFINITIONS: Array<Omit<GovernanceSection, 'to'>> = [
  { id: 'charter', labelKey: 'nav.projectCharter', icon: 'i-lucide-file-text' },
  { id: 'stakeholders', labelKey: 'nav.projectStakeholders', icon: 'i-lucide-users' },
  { id: 'raci', labelKey: 'projects.workspace.sections.raci', icon: 'i-lucide-grid-3x3' },
  { id: 'register', labelKey: 'nav.projectRisks', icon: 'i-lucide-circle-alert' },
  { id: 'changes', labelKey: 'nav.projectChanges', icon: 'i-lucide-git-pull-request-arrow' },
]

/**
 * The governance sub-tabs. Each keeps its own top-level project path; the section capability is checked by the parent tab.
 * The changes tab follows the company's change control: it is hidden while the mode is `off`.
 */
export function governanceSections(projectId: number, options: { changeControl: boolean } = { changeControl: true }): GovernanceSection[] {
  return DEFINITIONS.filter(definition => definition.id !== 'changes' || options.changeControl).map(definition => ({ ...definition, to: `/projects/${projectId}/${definition.id}` }))
}
