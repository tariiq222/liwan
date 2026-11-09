import { describe, expect, it } from 'vitest'
import { PROJECT_CHIP_IDS, projectChipCounts, projectChipFilters, projectChipLabelKey, selectedProjectChip } from '../projectListChips'

describe('project list chips', () => {
  it('maps every chip to the filters it owns and back', () => {
    for (const chip of PROJECT_CHIP_IDS) expect(selectedProjectChip(projectChipFilters(chip)), chip).toBe(chip)
    expect(projectChipFilters('mine')).toEqual({ mine: true, status: 'all', archived: false })
    expect(projectChipFilters('attention')).toEqual({ mine: false, status: 'attention', archived: false })
    expect(projectChipFilters('off_track')).toEqual({ mine: false, status: 'off_track', archived: false })
    expect(projectChipFilters('archived')).toEqual({ mine: false, status: 'all', archived: true })
  })

  it('names no chip for a mix of filters, so none looks selected', () => {
    expect(selectedProjectChip({ mine: true, status: 'done', archived: false })).toBeNull()
    expect(selectedProjectChip({ mine: false, status: 'unset', archived: false })).toBeNull()
    expect(selectedProjectChip({ mine: true, status: 'all', archived: true })).toBeNull()
  })

  it('labels the chips from the existing vocabulary', () => {
    expect(PROJECT_CHIP_IDS.map(projectChipLabelKey)).toEqual([
      'projects.filters.chipAll', 'nav.myProjects', 'nav.needsAttention', 'projects.status.at_risk', 'projects.status.off_track',
      'projects.status.on_track', 'projects.status.on_hold', 'projects.status.done', 'projects.filters.archived',
    ])
  })

  it('counts each status from the summary, attention as at risk plus off track, and leaves archived without a number', () => {
    const all = { project_count: 9, status_counts: [{ status: 'on_track' as const, count: 4 }, { status: 'at_risk' as const, count: 2 }, { status: 'off_track' as const, count: 1 }, { status: null, count: 2 }] }
    expect(projectChipCounts(all, { project_count: 3 })).toEqual({ all: 9, mine: 3, attention: 3, at_risk: 2, off_track: 1, on_track: 4, on_hold: 0, done: 0 })
    expect(projectChipCounts(undefined, undefined)).toEqual({})
    expect(projectChipCounts(all, undefined).mine).toBeUndefined()
  })
})
