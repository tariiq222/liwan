import { describe, expect, it } from 'vitest'
import type { Task, TaskDetail } from '@nasq/contracts'
import { applyPatchToTask, PAGE, taskKeys } from '../useTasks'

const baseTask: Task = {
  id: 1,
  name: 'Write the report',
  project: { id: 10, name: 'Q1 Planning' },
  state: 'in_progress',
  priority: '1',
  date_deadline: '2030-01-15',
  days_remaining: 2,
  is_overdue: false,
  is_closed: false,
  personal_stage: { id: 5, name: 'Doing' },
  assignees: [{ id: 2, name: 'Sara' }],
  tags: [{ id: 3, name: 'urgent', color: 1 }],
}

const baseDetail: TaskDetail = {
  ...baseTask,
  description_html: '<p>old</p>',
  allocated_hours: 4,
  age_days: 1,
  cycle_days: null,
  subtasks: [],
  depends_on: [],
  attachments: [],
  can_approve: false,
  created_at: '2030-01-01T00:00:00Z',
  updated_at: '2030-01-01T00:00:00Z',
}

describe('applyPatchToTask on a list item', () => {
  it('copies simple scalar fields through unchanged', () => {
    const next = applyPatchToTask(baseTask, { name: 'Write the final report', priority: '3', date_deadline: '2030-02-01' })
    expect(next.name).toBe('Write the final report')
    expect(next.priority).toBe('3')
    expect(next.date_deadline).toBe('2030-02-01')
    // Unpatched fields are untouched.
    expect(next.state).toBe('in_progress')
    expect(next.id).toBe(1)
  })

  it('does not mutate the original task', () => {
    const next = applyPatchToTask(baseTask, { name: 'Changed' })
    expect(next).not.toBe(baseTask)
    expect(baseTask.name).toBe('Write the report')
  })

  it('leaves assignees untouched when user_ids is patched but no resolved refs are supplied', () => {
    const next = applyPatchToTask(baseTask, { user_ids: [7] })
    expect(next.assignees).toBe(baseTask.assignees)
  })

  it('replaces assignees with the resolved refs when user_ids is patched', () => {
    const resolvedAssignees = [{ id: 7, name: 'Omar' }]
    const next = applyPatchToTask(baseTask, { user_ids: [7] }, { assignees: resolvedAssignees })
    expect(next.assignees).toEqual(resolvedAssignees)
  })

  it('replaces tags with the resolved tags when tag_ids is patched', () => {
    const resolvedTags = [{ id: 9, name: 'blocked', color: 2 }]
    const next = applyPatchToTask(baseTask, { tag_ids: [9] }, { tags: resolvedTags })
    expect(next.tags).toEqual(resolvedTags)
  })

  it('replaces personal_stage with the resolved ref, including clearing it to null', () => {
    const next = applyPatchToTask(baseTask, { personal_stage_type_id: null }, { personal_stage: null })
    expect(next.personal_stage).toBeNull()
  })

  it('sets personal_stage to a new ref when resolved', () => {
    const resolvedStage = { id: 6, name: 'Review' }
    const next = applyPatchToTask(baseTask, { personal_stage_type_id: 6 }, { personal_stage: resolvedStage })
    expect(next.personal_stage).toEqual(resolvedStage)
  })

  it('does not touch description_html on a plain list Task (it has none)', () => {
    const next: any = applyPatchToTask(baseTask, { description: 'new body' })
    expect(next.description_html).toBeUndefined()
  })

  it('does not touch allocated_hours on a plain list Task (it has none)', () => {
    const next: any = applyPatchToTask(baseTask, { allocated_hours: 8 })
    expect(next.allocated_hours).toBeUndefined()
  })
})

describe('applyPatchToTask on a detail object', () => {
  it('sets description_html from patch.description when description is present in the patch', () => {
    const next = applyPatchToTask(baseDetail, { description: '<p>new</p>' })
    expect(next.description_html).toBe('<p>new</p>')
  })

  it('clears description_html to empty string when patch.description is explicitly empty', () => {
    const next = applyPatchToTask(baseDetail, { description: '' })
    expect(next.description_html).toBe('')
  })

  it('leaves description_html untouched when description is absent from the patch', () => {
    const next = applyPatchToTask(baseDetail, { name: 'Something else' })
    expect(next.description_html).toBe(baseDetail.description_html)
  })

  it('copies allocated_hours through when patched', () => {
    const next = applyPatchToTask(baseDetail, { allocated_hours: 12 })
    expect(next.allocated_hours).toBe(12)
  })

  it('applies resolved assignees on a detail object the same way as on a list item', () => {
    const resolvedAssignees = [{ id: 8, name: 'Lina' }]
    const next = applyPatchToTask(baseDetail, { user_ids: [8] }, { assignees: resolvedAssignees })
    expect(next.assignees).toEqual(resolvedAssignees)
  })

  it('does not mutate the original detail', () => {
    const next = applyPatchToTask(baseDetail, { description: '<p>new</p>' })
    expect(next).not.toBe(baseDetail)
    expect(baseDetail.description_html).toBe('<p>old</p>')
  })
})

describe('taskKeys', () => {
  it('builds stable, structurally-comparable query keys', () => {
    expect(taskKeys.all).toEqual(['tasks'])
    expect(taskKeys.list({ closed: false })).toEqual(['tasks', 'list', { closed: false }])
    expect(taskKeys.detail(42)).toEqual(['tasks', 'detail', 42])
    expect(taskKeys.timeline(42)).toEqual(['tasks', 'timeline', 42])
    expect(taskKeys.stages).toEqual(['me', 'personal-stages'])
  })
})

describe('PAGE', () => {
  it('is the list page size used for both the request limit and offset math', () => {
    expect(PAGE).toBe(50)
  })
})
