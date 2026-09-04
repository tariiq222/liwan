import {
  BrandingSchema, MeSchema, TaskSchema, TaskDetailSchema, TaskStateSchema, TaskPatchSchema,
  TaskCreateSchema, TimelineEntrySchema, PersonalStageSchema,
} from '../index'

describe('BrandingSchema', () => {
  it('accepts the shape served by GET /api/v1/branding', () => {
    const parsed = BrandingSchema.parse({
      name: 'Erada', logo_url: '/web/binary/company_logo?company=1',
      primary_color: '#0055ff', font: 'IBM_Plex_Sans_Arabic',
    })
    expect(parsed.primary_color).toBe('#0055ff')
  })
  it('rejects a non-hex primary_color', () => {
    expect(() => BrandingSchema.parse({ name: 'x', logo_url: '/l', primary_color: 'blue', font: 'Lato' })).toThrow()
  })
})

describe('MeSchema', () => {
  it('accepts the shape served by GET /api/v1/me', () => {
    const me = MeSchema.parse({
      id: 2, name: 'Sara', login: 'emp', email: 'sara@example.com', lang: 'ar_001',
      tz: 'Asia/Riyadh', role: 'employee', company: { id: 1, name: 'Erada' },
    })
    expect(me.role).toBe('employee')
  })
  it('rejects unknown roles', () => {
    expect(() => MeSchema.parse({
      id: 2, name: 'x', login: 'x', email: '', lang: 'ar_001', tz: '', role: 'root', company: { id: 1, name: 'c' },
    })).toThrow()
  })
})

// The literal below matches TASK_KEYS in odoo-addons/nasq_api/tests/test_tasks.py exactly —
// dump_task()'s key set is the contract this schema mirrors.
const TASK_JSON = {
  id: 12, name: 'Overdue task', project: { id: 3, name: 'Erada Portal' }, state: 'in_progress',
  priority: '1', date_deadline: '2026-08-01T09:00:00Z', days_remaining: -3,
  is_overdue: true, is_closed: false, personal_stage: { id: 5, name: 'Inbox' },
  assignees: [{ id: 7, name: 'Sara' }], tags: [{ id: 1, name: 'urgent', color: 2 }],
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
