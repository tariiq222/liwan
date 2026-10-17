import { MeSchema, PersonRefSchema, ProjectDetailSchema, ProjectRefSchema, ProjectSchema, TagSchema, TaskDetailSchema, TaskSchema, type Task } from '@webvue/contracts'

export const tags = TagSchema.array().parse([
  { id: 1, name: 'عاجل', color: 1 },
  { id: 2, name: 'ميزانية', color: 3 },
  { id: 3, name: 'جودة', color: 10 },
])

export const people = PersonRefSchema.array().parse([
  { id: 2, name: 'Admin', user_id: 2 },
  { id: 7, name: 'سارة القحطاني', user_id: 7 },
  { id: 9, name: 'محمد العتيبي', user_id: 9 },
])

export const boardStages = [
  { id: 11, name: 'جديد', sequence: 1, fold: false },
  { id: 12, name: 'قيد التنفيذ', sequence: 2, fold: false },
  { id: 13, name: 'مكتمل', sequence: 3, fold: true },
]

export function makeTask(overrides: Partial<Task> = {}): Task {
  return TaskSchema.parse({
    id: 101, name: 'إعداد تقرير الربع الثالث', description_excerpt: 'جمع أرقام الربع ومراجعتها مع الإدارة المالية قبل الإرسال', project: { id: 1, name: 'مشروع ألفا' }, state: 'in_progress', priority: '2',
    date_deadline: '2026-09-15', days_remaining: 2, is_overdue: false, is_closed: false,
    personal_stage: null, stage: { id: 11, name: 'جديد' },
    assignees: [{ id: 2, name: 'Admin' }, { id: 7, name: 'سارة القحطاني' }], tags: [tags[0]!],
    can_write: true, can_approve: true,
    allowed_transitions: ['changes_requested', 'approved', 'waiting', 'done', 'cancelled'],
    ...overrides,
  })
}

export function taskDetail(overrides: Record<string, unknown> = {}) {
  return TaskDetailSchema.parse({
    ...makeTask(),
    description_html: '', allocated_hours: 0, age_days: 3, cycle_days: null, subtasks: [], depends_on: [], attachments: [],
    can_manage_dependencies: false, milestone: null, created_at: '2026-09-01 08:00:00', updated_at: '2026-09-10 08:00:00',
    planned_start: null, deliverables: [], allowed_actions: ['read', 'write'],
    completion_pending: false, completion_revision: 0, completion_return_note: null, completion_policy: 'none',
    completion_approver: null, completion_blocked_reason: null,
    ...overrides,
  })
}

export const project = ProjectSchema.parse({
  id: 1, name: 'مشروع ألفا', status: 'on_track', progress: 50, task_count: 24, closed_task_count: 12,
  active: true, can_manage: true, manager: { id: 2, name: 'Admin' }, date_end: '2026-12-31', allowed_actions: ['read', 'write', 'archive'],
  charter_state: 'draft', phase: 'initiating',
})

export const projectDetail = ProjectDetailSchema.parse({
  ...project, stages: [], description_html: '', privacy_visibility: 'employees', date_start: '2026-01-01',
  tags: [], followers_count: 0, milestone_count: 1, allow_task_dependencies: false,
  completion_approval: 'none', completion_approver: null, updated_at: 'v1',
  phase_state: { current: 'initiating', next: 'planning', previous: null, next_checks: [{ key: 'charter_approved', ok: false }] },
  charter: {
    code: 'P-1', type: null, owning_unit: null, sponsor: null,
    authority: '', rationale: '', objectives: [], benefits: '', scope: '', exclusions: '',
    high_level_requirements: '', deliverables: [], success: '', budget_state: 'unknown',
    amount: null, currency: { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 },
    priority: null, assumptions: '', constraints: '', closure: '', state: 'draft',
    approval_required: false, can_review: false, submitted_by: null, submitted_at: null,
    approved_by: null, approved_at: null, return_note: '',
  },
})

export const archivedProject = ProjectSchema.parse({ ...project, id: 4, name: 'تحديث الأنظمة', active: false })

export const projectRefs = ProjectRefSchema.array().parse([
  { id: 1, name: 'مشروع ألفا' },
  { id: 2, name: 'تطوير البوابة' },
  { id: 3, name: 'التحول الرقمي' },
])

export const me = MeSchema.parse({
  id: 2, name: 'Admin', login: 'admin', email: 'admin@example.com', lang: 'ar_001', tz: 'Asia/Riyadh',
  role: 'admin', roles: [], capabilities: ['pmo.projects.read'], access_policy_version: 1, company: { id: 1, name: 'ويب فيو' },
})

// Charter wizard: the classification catalog decides which steps a charter walks.
export const charterTypes = [
  { id: 1, name: 'تقني', sequence: 10, active: true, charter_steps: ['justification', 'scope', 'schedule', 'budget', 'risks'] },
  { id: 2, name: 'تشغيلي', sequence: 20, active: true, charter_steps: ['justification', 'scope', 'schedule'] },
  { id: 3, name: 'إنشائي', sequence: 30, active: true, charter_steps: ['justification', 'scope', 'schedule', 'budget', 'risks'] },
  { id: 4, name: 'تطويري', sequence: 40, active: true, charter_steps: ['justification', 'scope', 'schedule', 'budget'] },
]
export const charterOwningUnits = [
  { id: 1, name: 'مكتب إدارة المشاريع', sequence: 10, active: true },
  { id: 2, name: 'تقنية المعلومات', sequence: 20, active: true },
]
export const charterDefaults = { currency: { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 } }
export const projectCreateDefaults = { require_manager_on_create: true, require_end_date_on_create: false, default_manager_id: 2 }
