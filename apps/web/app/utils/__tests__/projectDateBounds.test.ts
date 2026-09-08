import { describe, expect, it } from 'vitest'
import {
  validateMilestoneDates,
  validateTaskDates,
} from '../projectDateBounds'
import { buildMilestonePatch } from '../milestonePayload'

describe('project date bounds', () => {
  it('accepts a complete milestone schedule inside the project window', () => {
    expect(validateMilestoneDates({
      projectStart: '2030-01-01',
      projectEnd: '2030-12-31',
      startDate: '2030-02-01',
      deadline: '2030-02-28',
    })).toBeNull()
  })

  it('rejects a milestone that starts before the project or ends after it', () => {
    expect(validateMilestoneDates({
      projectStart: '2030-01-01',
      projectEnd: '2030-12-31',
      startDate: '2029-12-31',
      deadline: '2030-02-28',
    })).toBe('milestone.startOutsideProject')
    expect(validateMilestoneDates({
      projectStart: '2030-01-01',
      projectEnd: '2030-12-31',
      startDate: '2030-12-01',
      deadline: '2031-01-01',
    })).toBe('milestone.deadlineOutsideProject')
  })

  it('rejects an inverted milestone pair', () => {
    expect(validateMilestoneDates({
      projectStart: '2030-01-01',
      projectEnd: '2030-12-31',
      startDate: '2030-04-02',
      deadline: '2030-04-01',
    })).toBe('milestone.startAfterDeadline')
  })

  it('keeps task start and UTC deadline inside the selected milestone', () => {
    expect(validateTaskDates({
      milestoneStart: '2030-02-01',
      milestoneDeadline: '2030-02-28',
      plannedStart: '2030-02-02',
      dateDeadline: '2030-02-28T23:59:00Z',
    })).toBeNull()
    expect(validateTaskDates({
      milestoneStart: '2030-02-01',
      milestoneDeadline: '2030-02-28',
      plannedStart: '2030-01-31',
      dateDeadline: '2030-02-28T23:59:00Z',
    })).toBe('task.startOutsideMilestone')
    expect(validateTaskDates({
      milestoneStart: '2030-02-01',
      milestoneDeadline: '2030-02-28',
      plannedStart: '2030-02-02',
      dateDeadline: '2030-03-01T00:00:00Z',
    })).toBe('task.deadlineOutsideMilestone')
  })

  it('omits unchanged legacy milestone dates from an edit patch', () => {
    expect(buildMilestonePatch({
      name: 'Renamed legacy milestone',
      startDate: '2020-01-01',
      deadline: '2020-01-31',
      originalStartDate: '2020-01-01',
      originalDeadline: '2020-01-31',
      deliverables: [],
      isNew: false,
    })).toEqual({ name: 'Renamed legacy milestone', deliverables: [] })
  })
})
