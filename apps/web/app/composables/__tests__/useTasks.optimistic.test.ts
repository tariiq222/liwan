import { describe, expect, it } from 'vitest'
import type { Task, TaskDetail } from '@liwan/contracts'
import { applyPatchToTask, PAGE, taskKeys } from '../useTasks'

const baseTask: Task = {
  id: 1, can_write: true, can_approve: false,
  name: 'Write the report',
  description_excerpt: '', subtask_count: 0, subtask_done_count: 0, attachment_count: 0,
  project: { id: 10, name: 'Q1 Planning' },
  state: 'in_progress',
  priority: '1',
  date_deadline: '2030-01-15',
  days_remaining: 2,
  is_overdue: false,
  is_closed: false,
  personal_stage: { id: 5, name: 'Doing' },
  stage: { id: 9, name: 'To Do' },
  assignees: [{ id: 2, name: 'Sara' }],
  tags: [{ id: 3, name: 'urgent', color: 1 }],
  allowed_transitions: ['waiting', 'done', 'cancelled'],
}

const baseDetail: TaskDetail = {
  allowed_actions: ['read', 'write', 'archive'],
  ...baseTask,
  planned_start: null, deliverables: [], description_html: '<p>old</p>',
  allocated_hours: 4,
  age_days: 1,
  cycle_days: null,
  subtasks: [],
  depends_on: [],
  attachments: [],
  can_approve: false, can_manage_dependencies: false,
  milestone: null,
  created_at: '2030-01-01T00:00:00Z',
  updated_at: '2030-01-01T00:00:00Z',
  completion_pending: false,
  completion_revision: 0,
  completion_return_note: null,
  completion_policy: 'none',
  completion_approver: null,
  completion_blocked_reason: null,
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

  it('recomputes days_remaining and is_overdue when the deadline is patched', () => {
    // Deadline moved into the past → overdue, negative day count.
    const past = applyPatchToTask(baseTask, { date_deadline: '2000-01-01T09:00:00Z' })
    expect(past.days_remaining).not.toBeNull()
    expect(past.days_remaining!).toBeLessThan(0)
    expect(past.is_overdue).toBe(true)

    // Deadline moved far into the future → not overdue, positive day count.
    const future = applyPatchToTask({ ...baseTask, days_remaining: -3, is_overdue: true }, { date_deadline: '2099-01-01T09:00:00Z' })
    expect(future.days_remaining!).toBeGreaterThan(0)
    expect(future.is_overdue).toBe(false)

    // Cleared deadline → no day count, never overdue.
    const cleared = applyPatchToTask({ ...baseTask, days_remaining: -3, is_overdue: true }, { date_deadline: null })
    expect(cleared.days_remaining).toBeNull()
    expect(cleared.is_overdue).toBe(false)

    // A closed task is never flagged overdue, however old the deadline.
    const closed = applyPatchToTask({ ...baseTask, is_closed: true }, { date_deadline: '2000-01-01T09:00:00Z' })
    expect(closed.days_remaining!).toBeLessThan(0)
    expect(closed.is_overdue).toBe(false)

    // A patch that does not touch the deadline leaves both alone.
    const untouched = applyPatchToTask({ ...baseTask, days_remaining: 42, is_overdue: true }, { name: 'x' })
    expect(untouched.days_remaining).toBe(42)
    expect(untouched.is_overdue).toBe(true)
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

  it('applies stage_id with the resolved project stage', () => {
    const next = applyPatchToTask(baseTask, { stage_id: 7 }, { stage: { id: 7, name: 'Review' } })
    expect(next.stage).toEqual({ id: 7, name: 'Review' })
    expect(next.personal_stage).toEqual(baseTask.personal_stage)
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

  it('applies milestone_id with the resolved milestone on a detail', () => {
    const resolvedMilestone = { id: 4, name: 'Beta launch' }
    const next = applyPatchToTask(baseDetail, { milestone_id: 4 }, { milestone: resolvedMilestone })
    expect(next.milestone).toEqual(resolvedMilestone)
  })

  it('does not mutate the original detail', () => {
    const next = applyPatchToTask(baseDetail, { description: '<p>new</p>' })
    expect(next).not.toBe(baseDetail)
    expect(baseDetail.description_html).toBe('<p>old</p>')
  })

  it('leaves description_html untouched when patch.description is explicitly undefined', () => {
    // Regression test: the check must be `patch.description !== undefined`,
    // not `'description' in patch` - a patch object with the key present
    // but set to undefined (e.g. built by spreading a partial form state)
    // must not clear the field.
    const next = applyPatchToTask(baseDetail, { description: undefined, name: 'Something else' })
    expect(next.description_html).toBe(baseDetail.description_html)
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
