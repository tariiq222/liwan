import type { ProjectToolKey, ProjectToolsState } from '@liwan/contracts'

export const PROJECT_TOOLS = ['planning', 'governance', 'finance'] as const
export function optionalProjectTools(tools: ProjectToolsState): ProjectToolKey[] {
  return PROJECT_TOOLS.filter(key => tools[key].policy === 'optional')
}
/** One map for primary navigation, child navigation and direct links. */
export function sectionToolRequirements(section: string | null): ProjectToolKey[] {
  if (section === 'evm') return ['planning', 'finance']
  if (['planning', 'schedule', 'milestones', 'baselines'].includes(section ?? '')) return ['planning']
  if (['governance', 'charter', 'stakeholders', 'raci', 'register', 'changes'].includes(section ?? '')) return ['governance']
  return section === 'finance' ? ['finance'] : []
}
export function projectSectionAvailable(section: string | null, tools?: ProjectToolsState): boolean {
  return sectionToolRequirements(section).every(key => tools?.[key].enabled === true)
}
