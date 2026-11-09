import type { ProjectDashboardSummary, ProjectStatus } from '@liwan/contracts'
// Relative import: this module is unit-tested directly under plain vitest.
import { PROJECT_ATTENTION_STATUSES, PROJECT_STATUS_LABEL_KEY } from '../composables/projectStatus'

/** The presets of the projects list, in the order its chips show them. */
export const PROJECT_CHIP_IDS = ['all', 'mine', 'attention', 'at_risk', 'off_track', 'on_track', 'on_hold', 'done', 'archived'] as const
export type ProjectChipId = (typeof PROJECT_CHIP_IDS)[number]

/** The list filters a chip owns: choosing one replaces all three. */
export interface ProjectChipFilters { mine: boolean; status: 'all' | 'attention' | ProjectStatus; archived: boolean }

const STATUS_CHIPS: readonly ProjectStatus[] = ['at_risk', 'off_track', 'on_track', 'on_hold', 'done']

export function projectChipLabelKey(chip: ProjectChipId): string {
  if (chip === 'all') return 'projects.filters.chipAll'
  if (chip === 'mine') return 'nav.myProjects'
  if (chip === 'attention') return 'nav.needsAttention'
  if (chip === 'archived') return 'projects.filters.archived'
  return PROJECT_STATUS_LABEL_KEY[chip]
}

/** The filters a chip stands for. */
export function projectChipFilters(chip: ProjectChipId): ProjectChipFilters {
  if (chip === 'mine') return { mine: true, status: 'all', archived: false }
  if (chip === 'archived') return { mine: false, status: 'all', archived: true }
  if (chip === 'all') return { mine: false, status: 'all', archived: false }
  return { mine: false, status: chip, archived: false }
}

/** The chip the filters equal exactly, or null when they are a mix no chip names (a hand-made link, `mine` with a status). */
export function selectedProjectChip(filters: { mine: boolean; status: string; archived: boolean }): ProjectChipId | null {
  return PROJECT_CHIP_IDS.find((chip) => {
    const preset = projectChipFilters(chip)
    return preset.mine === filters.mine && preset.status === filters.status && preset.archived === filters.archived
  }) ?? null
}

/**
 * The count beside each chip, from the unfiltered summary of the projects the person can read and the summary of
 * their own. A chip without a number (archived projects have no summary) is left out.
 */
export function projectChipCounts(all: Pick<ProjectDashboardSummary, 'project_count' | 'status_counts'> | undefined, mine: Pick<ProjectDashboardSummary, 'project_count'> | undefined): Partial<Record<ProjectChipId, number>> {
  const counts: Partial<Record<ProjectChipId, number>> = {}
  if (all) {
    counts.all = all.project_count
    const byStatus = (status: ProjectStatus) => all.status_counts.find(item => item.status === status)?.count ?? 0
    for (const status of STATUS_CHIPS) counts[status] = byStatus(status)
    counts.attention = PROJECT_ATTENTION_STATUSES.reduce((sum, status) => sum + byStatus(status), 0)
  }
  if (mine) counts.mine = mine.project_count
  return counts
}
