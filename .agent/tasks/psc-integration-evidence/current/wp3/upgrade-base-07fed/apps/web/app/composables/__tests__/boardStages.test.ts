import { describe, expect, it } from 'vitest'
import type { Task } from '@nasq/contracts'
import { moveTo, stageOf } from '../boardStages'

const task = {
  id: 1, can_write: true, can_approve: false, name: 't', project: { id: 1, name: 'p' }, state: 'in_progress', priority: '0', date_deadline: null,
  days_remaining: null, is_overdue: false, is_closed: false,
  personal_stage: { id: 5, name: 'Doing' }, stage: { id: 9, name: 'To Do' }, assignees: [], tags: [],
} satisfies Task

describe('stageOf', () => {
  it('reads the personal or the project stage', () => {
    expect(stageOf(task, 'personal')).toEqual({ id: 5, name: 'Doing' })
    expect(stageOf(task, 'project')).toEqual({ id: 9, name: 'To Do' })
  })
})

describe('moveTo', () => {
  const stage = { id: 7, name: 'Review', sequence: 3, fold: false }
  it('personal boards patch personal_stage_type_id and resolve personal_stage', () => {
    expect(moveTo('personal', stage)).toEqual({ patch: { personal_stage_type_id: 7 }, resolved: { personal_stage: { id: 7, name: 'Review' } } })
    expect(moveTo('personal', null)).toEqual({ patch: { personal_stage_type_id: null }, resolved: { personal_stage: null } })
  })
  it('project boards patch stage_id and never allow "no stage"', () => {
    expect(moveTo('project', stage)).toEqual({ patch: { stage_id: 7 }, resolved: { stage: { id: 7, name: 'Review' } } })
    expect(moveTo('project', null)).toBeNull()
  })
})
