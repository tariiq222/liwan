import { describe, expect, it } from 'vitest'
import {
  NotificationDigestDetailSchema,
  NotificationSchema,
  ProjectCreateDefaultsSchema,
  ProjectCreateSchema,
  ProjectDetailSchema,
  ProjectSettingsSchema,
  TaskDetailSchema,
} from '../index'

const EMPTY_CHARTER = {
  code: null, type: null, owning_unit: null, sponsor: null, authority: '', rationale: '',
  objectives: [], benefits: '', scope: '', exclusions: '', high_level_requirements: '',
  deliverables: [], success: '', budget_state: 'unknown', amount: null, currency: null,
  priority: null, assumptions: '', constraints: '', closure: '', state: 'draft',
  approval_required: false, can_review: false, submitted_by: null, submitted_at: null,
  approved_by: null, approved_at: null, return_note: '',
}

describe('project settings controls contracts', () => {
  it('parses company settings including create and reminder toggles', () => {
    const parsed = ProjectSettingsSchema.parse({
      project_creators: 'managers',
      default_stages: [{ name: 'A', fold: false }],
      require_manager_on_create: false,
      require_end_date_on_create: true,
      default_completion_approval: 'project_manager',
      deadline_reminders_enabled: true,
      deadline_reminders_days_before: 3,
      overdue_digest_enabled: false,
      require_charter_approval: false,
    })
    expect(parsed.require_end_date_on_create).toBe(true)
    expect(parsed.deadline_reminders_days_before).toBe(3)
    expect(() => ProjectSettingsSchema.parse({
      project_creators: 'managers',
      default_stages: [{ name: 'A', fold: false }],
      deadline_reminders_days_before: 31,
    })).toThrow()
  })

  it('requires the charter approval policy flag', () => {
    const full = {
      project_creators: 'managers',
      default_stages: [{ name: 'A', fold: false }],
      require_manager_on_create: true,
      require_end_date_on_create: true,
      default_completion_approval: 'none',
      deadline_reminders_enabled: true,
      deadline_reminders_days_before: 1,
      overdue_digest_enabled: true,
      require_charter_approval: false,
    }
    expect(ProjectSettingsSchema.safeParse(full).success).toBe(true)
    const { require_charter_approval: _omitted, ...rest } = full
    expect(ProjectSettingsSchema.safeParse(rest).success).toBe(false)
  })

  it('keeps create defaults creator-gated and create payload strict', () => {
    expect(ProjectCreateDefaultsSchema.parse({
      require_manager_on_create: true,
      require_end_date_on_create: true,
      default_manager_id: 2,
    }).default_manager_id).toBe(2)
    expect(ProjectCreateSchema.parse({ name: 'P', date_end: '2030-01-01' }).date_end).toBe('2030-01-01')
    expect(() => ProjectCreateSchema.parse({ name: 'P', extra: true })).toThrow()
  })

  it('requires completion fields on project and task detail', () => {
    const project = {
      id: 4, name: 'Project', status: null, progress: 0, task_count: 0, closed_task_count: 0, charter_state: 'draft', phase: 'initiating',
      active: true, can_manage: true, stages: [], description_html: '', manager: null,
      privacy_visibility: 'employees', date_start: null, date_end: null, tags: [], followers_count: 0,
      milestone_count: 0, updated_at: 'v1', charter: EMPTY_CHARTER, phase_state: { current: 'initiating', next: 'planning', previous: null, next_checks: [] },
    }
    expect(() => ProjectDetailSchema.parse(project)).toThrow()
    expect(ProjectDetailSchema.parse({
      ...project, completion_approval: 'none', completion_approver: null,
    }).completion_approval).toBe('none')
    const task = {
      id: 1, name: 'Task', project: { id: 4, name: 'Project' }, state: 'in_progress', priority: '0',
      date_deadline: null, description_excerpt: '', days_remaining: null, is_overdue: false, is_closed: false, personal_stage: null,
      stage: null, assignees: [], tags: [], allowed_transitions: ['cancelled'],
      description_html: '', allocated_hours: 0, age_days: 0,
      cycle_days: null, subtasks: [], depends_on: [], attachments: [], can_approve: false,
      created_at: '2030-01-01T00:00:00Z', updated_at: '2030-01-01T00:00:00Z', milestone: null,
    }
    expect(() => TaskDetailSchema.parse(task)).toThrow()
    expect(TaskDetailSchema.parse({
      ...task,
      completion_pending: true, completion_revision: 1, completion_return_note: null,
      completion_policy: 'project_manager', completion_approver: { id: 2, name: 'Mgr' },
      completion_blocked_reason: 'reviewer_ineligible',
      allowed_actions: ['read', 'write', 'withdraw_completion'],
    }).allowed_actions).toContain('withdraw_completion')
  })

  it('discriminates digest notifications from task notifications', () => {
    expect(NotificationSchema.parse({
      id: 1, kind: 'assignment', task_id: 9, task_name: 'T', body: 'x',
      created_at: '2026-09-06T10:00:00Z', is_read: false,
    }).kind).toBe('assignment')
    const digest = NotificationSchema.parse({
      id: 2, kind: 'overdue_digest', digest_id: 2, overdue_count: 4, local_date: '2026-09-06',
      body: '4 overdue tasks', created_at: '2026-09-06T10:00:00Z', is_read: false,
    })
    expect(digest.kind).toBe('overdue_digest')
    expect(() => NotificationSchema.parse({
      id: 2, kind: 'overdue_digest', task_id: 9, task_name: 'T', body: 'x',
      created_at: '2026-09-06T10:00:00Z', is_read: false,
    })).toThrow()
    expect(NotificationDigestDetailSchema.parse({
      id: 2, kind: 'overdue_digest', local_date: '2026-09-06', overdue_count: 0, items: [], total: 0,
    }).total).toBe(0)
  })
})
