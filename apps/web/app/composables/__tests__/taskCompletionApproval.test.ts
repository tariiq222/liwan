import { describe, expect, it } from 'vitest'
import { TaskDetailSchema } from '@webvue/contracts'

const base = {
  id: 1, name: 'Task', project: { id: 4, name: 'Project' }, state: 'in_progress' as const, priority: '0' as const,
  date_deadline: null, days_remaining: null, is_overdue: false, is_closed: false, personal_stage: null,
  stage: null, assignees: [], tags: [], description_html: '', allocated_hours: 0, age_days: 0,
  cycle_days: null, subtasks: [], depends_on: [], attachments: [], can_write: true, can_approve: false,
  created_at: '2030-01-01T00:00:00Z', updated_at: '2030-01-01T00:00:00Z', milestone: null,
}

describe('task completion approval client shape', () => {
  it('exposes record-specific completion actions separately from can_approve', () => {
    const detail = TaskDetailSchema.parse({
      ...base,
      allowed_actions: ['read', 'write', 'request_completion'],
      allowed_transitions: ['waiting', 'cancelled'],
      completion_pending: false,
      completion_revision: 1,
      completion_return_note: null,
      completion_policy: 'project_manager',
      completion_approver: { id: 4, name: 'Manager' },
      completion_blocked_reason: null,
    })
    expect(detail.can_approve).toBe(false)
    expect(detail.allowed_actions).toContain('request_completion')
    expect(detail.allowed_actions).not.toContain('accept_completion')
  })
})
