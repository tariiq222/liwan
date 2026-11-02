import type { AppIcon } from '../types'

export const GOVERNANCE_SECTION_IDS = ['charter', 'stakeholders', 'raci', 'register', 'changes', 'baselines', 'evm'] as const
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
  { id: 'baselines', labelKey: 'nav.projectBaselines', icon: 'i-lucide-flag' },
  { id: 'evm', labelKey: 'nav.projectEvm', icon: 'i-lucide-trending-up' },
]

export interface GovernanceSectionOptions {
  /** The company's change control is not `off`. */
  changeControl: boolean
  /** The plan includes the `pmo.baselines` sub-feature. */
  baselines: boolean
  /** The plan includes the `pmo.evm` sub-feature. */
  evm: boolean
}

/**
 * The governance sub-tabs. Each keeps its own top-level project path; the section capability is checked by the parent tab.
 * The changes tab follows the company's change control (hidden while the mode is `off`) and the baselines and earned value tabs the plan's sub-features.
 */
export function governanceSections(projectId: number, options: GovernanceSectionOptions = { changeControl: true, baselines: true, evm: true }): GovernanceSection[] {
  const hidden: Partial<Record<GovernanceSectionId, boolean>> = { changes: !options.changeControl, baselines: !options.baselines, evm: !options.evm }
  return DEFINITIONS.filter(definition => !hidden[definition.id]).map(definition => ({ ...definition, to: `/projects/${projectId}/${definition.id}` }))
}
