import { describe, expect, it } from 'vitest'
import { DependencyListSchema, ProjectDetailSchema, TaskDetailSchema } from '../index'

const task = {
  id: 1, name: 'Task', project: { id: 4, name: 'Project' }, state: 'in_progress', priority: '0',
  date_deadline: null, description_excerpt: '', subtask_count: 0, subtask_done_count: 0, attachment_count: 0, days_remaining: null, is_overdue: false, is_closed: false, personal_stage: null,
  stage: null, assignees: [], tags: [], allowed_transitions: ['waiting', 'done', 'cancelled'],
  description_html: '', allocated_hours: 0, age_days: 0,
  cycle_days: null, subtasks: [], depends_on: [], attachments: [], can_approve: false,
  created_at: '2030-01-01T00:00:00Z', updated_at: '2030-01-01T00:00:00Z', milestone: null,
  completion_pending: false, completion_revision: 0, completion_return_note: null,
  completion_policy: 'none', completion_approver: null, completion_blocked_reason: null,
}

describe('task lifecycle contracts', () => {
  it('defaults capability for old task detail fixtures', () => {
    expect(TaskDetailSchema.parse(task).can_manage_dependencies).toBe(false)
  })

  it('accepts dependency list metadata and rejects missing flags', () => {
    expect(DependencyListSchema.parse({ items: [], total: 0, can_manage: true, enabled: false }).enabled).toBe(false)
    expect(() => DependencyListSchema.parse({ items: [], total: 0 })).toThrow()
  })

  it('defaults the project dependency feature for old project detail fixtures', () => {
    const project = {
      id: 4, name: 'Project', status: null, progress: 0, task_count: 0, closed_task_count: 0, charter_state: 'draft', phase: 'initiating',
      active: true, can_manage: true, stages: [], description_html: '', manager: null,
      privacy_visibility: 'employees', date_start: null, date_end: null, tags: [], followers_count: 0,
      milestone_count: 0, completion_approval: 'none', completion_approver: null,
      updated_at: 'v1',
      phase_state: { current: 'initiating', next: 'planning', previous: null, next_checks: [] }, change_control_mode: 'optional',
      charter: {
        code: null, type: null, owning_unit: null, sponsor: null, authority: '', rationale: '',
        objectives: [], benefits: '', scope: '', exclusions: '', high_level_requirements: '',
        deliverables: [], success: '', budget_state: 'unknown', amount: null, currency: null,
        priority: null, assumptions: '', constraints: '', closure: '', state: 'draft',
  approval_required: false, can_review: false, submitted_by: null, submitted_at: null,
  approved_by: null, approved_at: null, return_note: '',
      },
    }
    expect(ProjectDetailSchema.parse(project).allow_task_dependencies).toBe(false)
    expect(ProjectDetailSchema.parse({ ...project, allow_task_dependencies: true }).allow_task_dependencies).toBe(true)
  })
})
