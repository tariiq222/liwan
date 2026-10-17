import { describe, expect, it } from 'vitest'
import { TaskCreateSchema, TaskDetailSchema, TaskPatchSchema } from '../task'

const task = {
  id: 12,
  name: 'Content task',
  project: { id: 3, name: 'Erada Portal' },
  state: 'in_progress' as const,
  priority: '1' as const,
  date_deadline: null,
  description_excerpt: '',
  days_remaining: null,
  is_overdue: false,
  is_closed: false,
  personal_stage: null,
  stage: null,
  assignees: [],
  tags: [],
  can_write: true,
  can_approve: false,
  allowed_transitions: ['waiting', 'changes_requested', 'approved', 'done', 'cancelled'] as const,
  description_html: '<p>Context</p>',
  allocated_hours: 0,
  age_days: 0,
  cycle_days: null,
  subtasks: [],
  depends_on: [],
  attachments: [],
  can_manage_dependencies: false,
  milestone: null,
  created_at: '2026-09-08T09:00:00Z',
  updated_at: '2026-09-08T09:00:00Z',
  completion_pending: false,
  completion_revision: 0,
  completion_return_note: null,
  completion_policy: 'none' as const,
  completion_approver: null,
  completion_blocked_reason: null,
}

describe('task content contracts', () => {
  it('accepts HTML description and trims checklist names on create and patch', () => {
    const deliverables = [{ name: '  Requirements  ', done: false }]
    const create = TaskCreateSchema.parse({
      name: 'Content task',
      project_id: 3,
      description: '<p>Context</p>',
      deliverables,
    })
    expect(create.description).toBe('<p>Context</p>')
    expect(create.deliverables).toEqual([{ name: 'Requirements', done: false }])
    expect(TaskPatchSchema.parse({ deliverables })).toEqual({
      deliverables: [{ name: 'Requirements', done: false }],
    })
  })

  it('defaults detail checklist to an empty array and rejects malformed rows', () => {
    expect(TaskDetailSchema.parse(task).deliverables).toEqual([])
    expect(() => TaskCreateSchema.parse({
      name: 'Content task', project_id: 3, deliverables: [{ name: ' ', done: false }],
    })).toThrow()
    expect(() => TaskPatchSchema.parse({
      deliverables: [{ name: 'Output', done: false, score: 1 }],
    })).toThrow()
    expect(() => TaskPatchSchema.parse({ deliverables: null })).toThrow()
  })
})
