import {
  TaskSchema, TaskDetailSchema, TaskStateSchema, TaskPatchSchema,
  TaskCreateSchema, TimelineEntrySchema, PersonalStageSchema,
  ProjectSchema, ProjectDetailSchema, ProjectStatusBodySchema, PROJECT_STATUSES,
  ProjectListSchema, VisibilitySchema, ProjectPatchSchema, ProjectCreateSchema,
  MilestoneSchema, MilestoneBodySchema, MilestonePatchSchema, ProjectUpdateSchema, ProjectSettingsSchema, StageOrderBodySchema,
} from '../index'

// The literal below matches TASK_KEYS in odoo-addons/nasq_pmo/tests/test_tasks.py exactly —
// dump_task()'s key set is the contract this schema mirrors.
const TASK_JSON = {
  id: 12, name: 'Overdue task', project: { id: 3, name: 'Erada Portal' }, state: 'in_progress',
  priority: '1', date_deadline: '2026-08-01T09:00:00Z', days_remaining: -3,
  is_overdue: true, is_closed: false, personal_stage: { id: 5, name: 'Inbox' }, stage: { id: 9, name: 'To Do' },
  assignees: [{ id: 7, name: 'Sara' }], tags: [{ id: 1, name: 'urgent', color: 2 }],
  allowed_transitions: ['waiting', 'changes_requested', 'approved', 'done', 'cancelled'],
}

describe('TaskSchema', () => {
  it('accepts the shape emitted by dump_task', () => {
    const parsed = TaskSchema.parse(TASK_JSON)
    expect(parsed.priority).toBe('1')
  })
})

describe('TaskDetailSchema', () => {
  it('accepts a closed-task detail payload with cycle_days: null', () => {
    const parsed = TaskDetailSchema.parse({
      ...TASK_JSON,
      description_html: '<p>desc</p>', allocated_hours: 4, age_days: 0, cycle_days: null,
      subtasks: [], depends_on: [], attachments: [], can_approve: false,
      created_at: '2026-08-01T09:00:00Z', updated_at: '2026-08-01T09:00:00Z',
      milestone: null, completion_pending: false, completion_revision: 0, completion_return_note: null,
      completion_policy: 'none', completion_approver: null, completion_blocked_reason: null,
    })
    expect(parsed.cycle_days).toBeNull()
  })
})

describe('TaskStateSchema', () => {
  it('rejects a state not in the API vocabulary', () => {
    expect(() => TaskStateSchema.parse('open')).toThrow()
  })
})

describe('TaskPatchSchema', () => {
  it('rejects project_id (not writable, .strict() catches unknown keys)', () => {
    expect(() => TaskPatchSchema.parse({ project_id: 1 })).toThrow()
  })
})

describe('TaskCreateSchema', () => {
  it('accepts a valid create payload', () => {
    const parsed = TaskCreateSchema.parse({ name: 'New task', project_id: 3 })
    expect(parsed).toEqual({ name: 'New task', project_id: 3 })
  })
  it('accepts an optional parent_id', () => {
    const parsed = TaskCreateSchema.parse({ name: 'Subtask', project_id: 3, parent_id: 12 })
    expect(parsed.parent_id).toBe(12)
  })
  it('rejects a payload missing project_id', () => {
    expect(() => TaskCreateSchema.parse({ name: 'New task' })).toThrow()
  })
  it('rejects an unknown extra key (.strict() catches it)', () => {
    expect(() => TaskCreateSchema.parse({ name: 'New task', project_id: 3, state: 'done' })).toThrow()
  })
})

describe('TimelineEntrySchema', () => {
  it('accepts a comment entry', () => {
    const parsed = TimelineEntrySchema.parse({
      id: 1, kind: 'comment', author: { id: 2, name: 'Sara' }, at: '2026-08-01T09:00:00Z',
      body_html: '<p>hi</p>',
    })
    expect(parsed.kind).toBe('comment')
  })
  it('accepts a tracking entry', () => {
    const parsed = TimelineEntrySchema.parse({
      id: 2, kind: 'tracking', author: { id: 2, name: 'Sara' }, at: '2026-08-01T09:00:00Z',
      changes: [{ field: 'priority', label: 'Priority', old: '0', new: '1' }],
    })
    expect(parsed.kind).toBe('tracking')
  })
})

describe('PersonalStageSchema', () => {
  it('accepts the shape served by GET /api/v1/me/personal-stages', () => {
    const parsed = PersonalStageSchema.parse({ id: 1, name: 'Inbox', sequence: 1, fold: false })
    expect(parsed.name).toBe('Inbox')
  })
})

const EMPTY_CHARTER = {
  code: null, type: null, owning_unit: null, sponsor: null, authority: '', rationale: '',
  objectives: [], benefits: '', scope: '', exclusions: '', high_level_requirements: '',
  deliverables: [], success: '', budget_state: 'unknown', amount: null,
  currency: { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 },
  priority: null, assumptions: '', constraints: '', closure: '', state: 'draft',
  approval_required: false, can_review: false, submitted_by: null, submitted_at: null,
  approved_by: null, approved_at: null, return_note: '',
}
const PROJECT_JSON = { id: 3, name: 'Erada Portal', status: null, progress: 33, task_count: 3, closed_task_count: 1, active: true, can_manage: false, charter_state: 'draft', phase: 'initiating' }

describe('ProjectSchema', () => {
  it('carries existing manager and end date in list rows without exposing other user fields', () => {
    const value = { ...PROJECT_JSON, manager: { id: 7, name: 'Mona' }, date_end: '2030-12-31' }
    expect(ProjectSchema.parse(value)).toMatchObject(value)
    expect(ProjectSchema.parse({ ...PROJECT_JSON, manager: null, date_end: null }).manager).toBeNull()
    expect(() => ProjectSchema.parse({ ...value, manager: { ...value.manager, email: 'private@example.test' } })).toThrow()
  })
  it('accepts the list shape with a null (unset) status', () => {
    expect(ProjectSchema.parse(PROJECT_JSON).status).toBeNull()
  })
  it('rejects to_define — it is never on the wire', () => {
    expect(() => ProjectSchema.parse({ ...PROJECT_JSON, status: 'to_define' })).toThrow()
  })
  it('rejects a progress outside 0..100', () => {
    expect(() => ProjectSchema.parse({ ...PROJECT_JSON, progress: 101 })).toThrow()
  })
})

describe('ProjectDetailSchema', () => {
  it('accepts stages and can_manage', () => {
    const parsed = ProjectDetailSchema.parse({
      ...PROJECT_JSON, status: 'at_risk', can_manage: true,
      stages: [{ id: 1, name: 'A', sequence: 10, fold: true, task_count: 0 }],
      description_html: '', manager: null, privacy_visibility: 'employees',
      date_start: null, date_end: null, tags: [], followers_count: 0, milestone_count: 0,
      completion_approval: 'none', completion_approver: null,
      updated_at: 'v1', charter: EMPTY_CHARTER, phase_state: { current: 'initiating', next: 'planning', previous: null, next_checks: [] },
    })
    expect(parsed.stages[0]!.fold).toBe(true)
  })
  it('requires completion fields instead of defaulting a server omission', () => {
    const base = {
      ...PROJECT_JSON, status: 'at_risk', can_manage: true,
      stages: [{ id: 1, name: 'A', sequence: 10, fold: true, task_count: 0 }],
      description_html: '', manager: null, privacy_visibility: 'employees',
      date_start: null, date_end: null, tags: [], followers_count: 0, milestone_count: 0,
      updated_at: 'v1', charter: EMPTY_CHARTER, phase_state: { current: 'initiating', next: 'planning', previous: null, next_checks: [] },
    }
    expect(() => ProjectDetailSchema.parse(base)).toThrow()
    expect(() => ProjectDetailSchema.parse({ ...base, completion_approval: 'none' })).toThrow()
  })
})

describe('ProjectStatusBodySchema', () => {
  it('lists exactly the five writable statuses and rejects to_define', () => {
    expect(PROJECT_STATUSES).toEqual(['on_track', 'at_risk', 'off_track', 'on_hold', 'done'])
    expect(() => ProjectStatusBodySchema.parse({ status: 'to_define' })).toThrow()
  })
})

describe('TaskPatchSchema stage_id', () => {
  it('accepts stage_id', () => {
    expect(TaskPatchSchema.parse({ stage_id: 4 })).toEqual({ stage_id: 4 })
  })
})

const STAGE = { id: 1, name: 'A', sequence: 10, fold: false, task_count: 2 }
const PROJECT = { id: 3, name: 'P', status: null, progress: 0, task_count: 0, closed_task_count: 0, active: true, can_manage: true, charter_state: 'draft', phase: 'initiating' }

describe('ProjectListSchema', () => {
  it('is an object with items, can_create and can_list_archived, not the phase-2 bare array', () => {
    const parsed = ProjectListSchema.parse({ items: [PROJECT], total: 1, can_create: false, can_list_archived: true })
    expect(parsed.can_create).toBe(false)
    expect(parsed.can_list_archived).toBe(true)
    expect(() => ProjectListSchema.parse([PROJECT])).toThrow()
  })
  it('rejects a payload missing can_list_archived (.strict() catches it)', () => {
    expect(() => ProjectListSchema.parse({ items: [PROJECT], total: 1, can_create: false })).toThrow()
  })
})

describe('ProjectDetailSchema (3a)', () => {
  it('carries settings fields', () => {
    const d = ProjectDetailSchema.parse({
      ...PROJECT, stages: [STAGE], description_html: '', manager: { id: 2, name: 'M' }, privacy_visibility: 'followers',
      date_start: '2030-01-01', date_end: null, tags: [], followers_count: 1, milestone_count: 0,
      completion_approval: 'none', completion_approver: null,
      updated_at: 'v2', charter: EMPTY_CHARTER, phase_state: { current: 'initiating', next: 'planning', previous: null, next_checks: [] },
    })
    expect(d.stages[0]!.task_count).toBe(2)
  })
  it('rejects portal visibility', () => {
    expect(() => VisibilitySchema.parse('portal')).toThrow()
  })
})

describe('ProjectPatchSchema', () => {
  it('accepts nullable dates and manager, rejects unknown keys', () => {
    expect(ProjectPatchSchema.parse({ date_start: null, user_id: null, tag_ids: [1] })).toEqual({ date_start: null, user_id: null, tag_ids: [1] })
    expect(() => ProjectPatchSchema.parse({ active: false })).toThrow()
  })
  it('requires expected_updated_at when charter is present', () => {
    expect(() => ProjectPatchSchema.parse({ charter: {} })).toThrow()
    expect(ProjectPatchSchema.parse({ charter: {}, expected_updated_at: 'v3' }).expected_updated_at).toBe('v3')
  })
})

describe('ProjectCreateSchema', () => {
  it('still accepts name only and optional charter', () => {
    expect(ProjectCreateSchema.parse({ name: 'N' })).toEqual({ name: 'N' })
    expect(ProjectCreateSchema.parse({ name: 'N', charter: { budget_state: 'estimate', amount: 0 } }).charter?.amount).toBe(0)
  })
})

describe('Milestone / ProjectUpdate / Settings', () => {
  it('parse their fixtures', () => {
    MilestoneSchema.parse({ id: 1, name: 'M', deadline: null, is_reached: false, reached_date: null, task_count: 0, done_task_count: 0 })
    ProjectUpdateSchema.parse({ id: 1, name: 'W1', status: 'on_track', description_html: '<p>x</p>', date: '2030-01-01', author: { id: 2, name: 'M' } })
    expect(ProjectSettingsSchema.parse({
      project_creators: 'managers', default_stages: [{ name: 'A', fold: true }],
      require_manager_on_create: true, require_end_date_on_create: true,
      default_completion_approval: 'none', deadline_reminders_enabled: true,
      deadline_reminders_days_before: 1, overdue_digest_enabled: true,
      require_charter_approval: false,
    }).default_stages).toHaveLength(1)
    expect(() => ProjectSettingsSchema.parse({ project_creators: 'anyone', default_stages: [] })).toThrow()
    expect(StageOrderBodySchema.parse({ ids: [2, 1] }).ids).toEqual([2, 1])
  })

  it('accepts dated milestones with strict checklist deliverables', () => {
    const milestone = MilestoneSchema.parse({
      id: 1, name: 'M', start_date: '2026-10-05', deadline: '2026-10-20',
      deliverables: [{ name: 'Requirements', done: false }], is_reached: false,
      reached_date: null, task_count: 0, done_task_count: 0,
    })
    expect(milestone.start_date).toBe('2026-10-05')
    expect(milestone.deliverables[0]).toEqual({ name: 'Requirements', done: false })
    expect(() => MilestoneSchema.parse({
      id: 1, name: 'M', start_date: null, deadline: null,
      deliverables: [{ name: 'Requirements', done: false, score: 1 }], is_reached: false,
      reached_date: null, task_count: 0, done_task_count: 0,
    })).toThrow()
    expect(MilestoneBodySchema.parse({
      name: 'M', start_date: '2026-10-05', deadline: '2026-10-20',
      deliverables: [{ name: 'Requirements', done: true }],
    }).deliverables?.[0]?.done).toBe(true)
    expect(MilestonePatchSchema.parse({ start_date: null, deliverables: [] })).toEqual({ start_date: null, deliverables: [] })
  })
})

describe('Task milestone', () => {
  it('detail carries milestone and patch accepts milestone_id null', () => {
    expect(TaskPatchSchema.parse({ milestone_id: null })).toEqual({ milestone_id: null })
  })

  it('accepts planned_start on task create and detail', () => {
    expect(TaskCreateSchema.parse({
      name: 'Scheduled task', project_id: 3, planned_start: '2026-10-05',
      date_deadline: '2026-10-20T00:00:00Z',
    }).planned_start).toBe('2026-10-05')
    expect(() => TaskCreateSchema.parse({ name: 'Scheduled task', project_id: 3, planned_start: '2026-02-30' })).toThrow()
    expect(TaskDetailSchema.parse({
      ...TASK_JSON, planned_start: '2026-10-05', description_html: '', allocated_hours: 0,
      age_days: 0, cycle_days: null, subtasks: [], depends_on: [], attachments: [],
      can_approve: false, created_at: '2026-08-01T09:00:00Z', updated_at: '2026-08-01T09:00:00Z',
      milestone: null, completion_pending: false, completion_revision: 0, completion_return_note: null,
      completion_policy: 'none', completion_approver: null, completion_blocked_reason: null,
    }).planned_start).toBe('2026-10-05')
  })
})
