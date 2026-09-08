import { describe, expect, it } from 'vitest'
import { ProjectScheduleSchema, ScheduleTaskPatchSchema } from '../schedule'

const task = { id: 4, name: 'Design', start: '2030-02-01', end: '2030-02-04', state: 'in_progress' as const, dependency_ids: [], milestone_id: null }

describe('schedule contracts', () => {
  it('accepts date-only schedule values and explicit clearing', () => {
    expect(ScheduleTaskPatchSchema.parse({ start: null, end: null })).toEqual({ start: null, end: null })
    expect(ProjectScheduleSchema.parse({ project_id: 3, tasks: [task], milestones: [], can_manage: true, total: 1 }).tasks[0].start).toBe('2030-02-01')
    expect(ProjectScheduleSchema.parse({
      project_id: 3, tasks: [task], milestones: [{
        id: 9, name: 'M', start_date: '2030-02-01', deadline: '2030-02-04',
      }], can_manage: true, total: 1,
    }).milestones[0]?.start_date).toBe('2030-02-01')
    expect(ProjectScheduleSchema.parse({ project_id: 3, tasks: [{ ...task, start: null }], milestones: [], can_manage: false, total: 1 }).tasks[0].end).toBe('2030-02-04')
  })

  it('rejects invalid calendar, partial and reversed ranges', () => {
    expect(() => ScheduleTaskPatchSchema.parse({ start: '2030-02-30', end: '2030-03-01' })).toThrow()
    expect(() => ScheduleTaskPatchSchema.parse({ start: '2030-03-02', end: '2030-03-01' })).toThrow()
    expect(() => ScheduleTaskPatchSchema.parse({ start: null, end: '2030-03-01' })).toThrow()
    expect(() => ProjectScheduleSchema.parse({ project_id: 3, tasks: [{ ...task, extra: true }], milestones: [], can_manage: true, total: 1 })).toThrow()
  })
})
