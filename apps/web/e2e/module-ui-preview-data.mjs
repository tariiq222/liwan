// Opt-in synthetic responses for internal module UI review. Never reads or writes Odoo data.

export const moduleUiCapabilities = [
  'access.users.read',
  'access.users.grant',
  'access.users.assign_roles',
  'access.users.disable',
  'access.users.reset_password',
  'access.roles.read',
  'access.roles.manage',
  'access.audit.read',
  'hr.employees.read',
  'hr.employees.manage',
  'hr.employees.archive',
  'hr.employees.access_status.read',
  'hr.departments.read',
  'hr.departments.manage',
  'hr.documents.read',
  'hr.documents.manage',
  'pmo.projects.read',
  'pmo.projects.create',
  'pmo.projects.manage',
  'pmo.settings.manage',
  'pmo.tasks.read',
  'pmo.tasks.create',
  'pmo.tasks.write',
  'pmo.tasks.approve',
  'settings.branding.manage',
  'meetings.read',
  'meetings.create',
  'meetings.manage',
]

const PERSON = { id: 1, name: 'أحمد العتيبي' }
const SECRETARY = { id: 2, name: 'نورة الحربي' }
const PEOPLE = [{ id: PERSON.id, name: PERSON.name, user_id: 1 }, { id: SECRETARY.id, name: SECRETARY.name, user_id: 2 }]
const PROJECT = { id: 1, name: 'تطوير الخدمات الرقمية' }
const DEPARTMENT = { id: 1, name: 'إدارة العمليات' }
const OFFSET = 0

const page = (items, url, extra = {}) => {
  const offset = Number(url?.searchParams?.get('offset') ?? OFFSET)
  const limit = Number(url?.searchParams?.get('limit') ?? 50)
  const start = Number.isFinite(offset) && offset >= 0 ? offset : OFFSET
  const size = Number.isFinite(limit) && limit > 0 ? limit : 50
  return { items: items.slice(start, start + size), total: items.length, ...extra }
}

const resolution = {
  id: 1,
  name: 'اعتماد خطة التنفيذ',
  deadline: '2026-09-30',
  priority: '1',
  state: 'in_progress',
  responsible: PERSON,
  task_id: 101,
  result: 'بدأ الفريق في تنفيذ البنود المعتمدة.',
  can_update_execution: true,
  can_edit_decision: true,
  execution_state: 'in_progress',
  task_linked: true,
  allowed_actions: ['start', 'complete', 'cancel', 'reopen', 'edit_result'],
  execution_period: 'خلال الربع الثالث من عام 2026',
  project: PROJECT,
}

const meeting = {
  id: 1,
  name: 'اجتماع متابعة التحول الرقمي',
  reference: 'MTG-001',
  meeting_date: '2026-09-15',
  start_datetime: '2026-09-15T09:00:00+03:00',
  end_datetime: '2026-09-15T10:00:00+03:00',
  state: 'confirmed',
  organizer: PERSON,
  open_resolution_count: 1,
  series_id: 1,
  project_id: 1,
}

const minutesForm = {
  opening: 'افتتح رئيس الاجتماع الجلسة بالترحيب بالحضور.',
  closing: 'اختتم الاجتماع بتحديد موعد المتابعة القادم.',
  chairperson: 'أحمد العتيبي',
  approver_name: 'نورة الحربي',
  approver_title: 'مديرة مكتب المشاريع',
  topics: [{
    key: 'digital-transformation',
    title: 'خطة التنفيذ',
    discussion: 'استعرض الفريق مراحل التنفيذ ومؤشرات المتابعة.',
    project_id: 1,
    resolution_ids: [1],
  }],
}

const snapshot = {
  captured_at: '2026-09-15T10:05:00+03:00',
  name: meeting.name,
  meeting_date: meeting.meeting_date,
  start_datetime: meeting.start_datetime,
  end_datetime: meeting.end_datetime,
  location: 'قاعة الاجتماعات الرئيسية',
  organizer: PERSON,
  secretary: SECRETARY,
  attendees: [PERSON, SECRETARY],
  agenda: 'متابعة خطة التحول الرقمي والقرارات المفتوحة.',
  minutes: 'تمت مراجعة حالة التنفيذ والاتفاق على إجراءات المتابعة.',
  resolutions: [{
    id: resolution.id,
    name: resolution.name,
    deadline: resolution.deadline,
    priority: resolution.priority,
    state: resolution.state,
    responsible: resolution.responsible,
    result: resolution.result,
    meeting_name: meeting.name,
    execution_period: resolution.execution_period,
    project: resolution.project,
  }],
  minutes_form: minutesForm,
}

const meetingDetail = {
  ...meeting,
  agenda: 'متابعة خطة التحول الرقمي والقرارات المفتوحة.',
  minutes: 'تمت مراجعة حالة التنفيذ والاتفاق على إجراءات المتابعة.',
  location: 'قاعة الاجتماعات الرئيسية',
  meeting_url: 'https://meet.example.test/mtg-001',
  can_edit: true,
  can_manage: true,
  secretary: SECRETARY,
  attendees: [PERSON, SECRETARY],
  resolutions: [resolution],
  series: { id: 1, name: 'اجتماعات متابعة التحول الرقمي' },
  project: PROJECT,
  previous_resolutions: [{ ...resolution, meeting_id: 1, meeting_name: meeting.name }],
  minutes_snapshot: snapshot,
  minutes_form: minutesForm,
}

const series = {
  id: 1,
  name: 'اجتماعات متابعة التحول الرقمي',
  recurrence: 'monthly',
  until_date: '2026-12-31',
  until_count: null,
  organizer: PERSON,
  project: PROJECT,
  open_resolution_count: 1,
  overdue_resolution_count: 0,
}

const seriesDetail = {
  ...series,
  location: 'قاعة الاجتماعات الرئيسية',
  meeting_url: 'https://meet.example.test/digital-followup',
  secretary: SECRETARY,
  attendees: [PERSON, SECRETARY],
  meetings: [meeting],
  can_edit: true,
}

const events = [{
  id: 1,
  meeting_id: 1,
  meeting_name: meeting.name,
  occurred_at: '2026-09-15T10:05:00+03:00',
  actor: PERSON,
  kind: 'minutes_saved',
  summary: 'حُفظ محضر الاجتماع.',
}]

const attachments = [{ id: 1, name: 'محضر الاجتماع.pdf', mimetype: 'application/pdf', url: '/api/v1/attachments/1' }]
const versions = [{ id: 1, number: 1, captured_at: snapshot.captured_at, actor: PERSON, snapshot }]

const employee = {
  id: 1,
  name: 'سارة محمد',
  job_title: 'مديرة العمليات',
  department: DEPARTMENT,
  work_email: 'sara@example.test',
  work_phone: '+966500000001',
  user_id: 1,
  manager: PERSON,
  active: true,
  access: { user_id: 1, login: 'sara', role: 'admin', active: true },
}
const department = {
  id: 1,
  name: DEPARTMENT.name,
  parent_id: null,
  manager: { id: 1, name: employee.name },
  child_ids: [],
  employee_count: 4,
}
const document = {
  id: 1,
  name: 'دليل إجراءات التشغيل',
  department: DEPARTMENT,
  body: 'يوضح هذا المستند إجراءات التشغيل المعتمدة للفريق.',
  attachment_ids: [{ id: 1, name: 'دليل التشغيل.pdf', mimetype: 'application/pdf', file_size: 245760 }],
  write_date: '2026-09-10T08:00:00+03:00',
}

const roleRef = {
  id: 1,
  key: 'admin',
  name: { ar: 'مدير النظام', en: 'Administrator' },
  type: 'built_in',
  protected: true,
}
const assignment = {
  id: 1,
  role: roleRef,
  scope: { kind: 'company', id: 1, name: 'شركة نسق' },
}
const employeeRef = { id: 1, name: employee.name, department: DEPARTMENT }
const adminUser = {
  id: 1,
  name: employee.name,
  login: 'sara',
  employee: employeeRef,
  active: true,
  protected: true,
  assignments: [assignment],
  version: 'user-1-v1',
}
const capabilitySources = moduleUiCapabilities.map((key) => ({
  key,
  sources: [{ role_assignment_id: 1, role: roleRef, scope: assignment.scope, source: 'assignment' }],
}))
const adminUserDetail = {
  ...adminUser,
  capabilities: capabilitySources,
  allowed_actions: ['read', 'assign_roles', 'reset_password', 'disable', 'reactivate'],
}
const role = {
  id: 1,
  key: 'admin',
  name: { ar: 'مدير النظام', en: 'Administrator' },
  description: 'صلاحيات إدارة النظام والوحدات الداخلية.',
  type: 'built_in',
  active: true,
  protected: true,
  assignable: true,
  user_count: 1,
  version: 'role-1-v1',
}
const roleDetail = {
  ...role,
  permissions: moduleUiCapabilities,
  allowed_actions: ['read', 'edit', 'disable', 'enable', 'delete', 'clone'],
}

const accessChanging = new Set([
  'access.users.grant',
  'access.users.assign_roles',
  'access.users.disable',
  'access.users.reset_password',
  'access.roles.manage',
])
const permissionCatalog = {
  items: moduleUiCapabilities.map((key) => {
    const parts = key.split('.')
    const domain = parts[0] === 'settings' ? 'settings' : parts[0]
    return {
      key,
      domain,
      resource: parts[1] ?? parts[0],
      action: parts.slice(2).join('.') || 'manage',
      label: { ar: `صلاحية ${parts.slice(1).join(' ')}`, en: key },
      description: { ar: `الوصول إلى ${parts.slice(1).join(' ')} ضمن الوحدة.`, en: `Access to ${key}.` },
      dependencies: [],
      scopes: [{ kind: 'company', assignable: true }],
      custom_role_allowed: !accessChanging.has(key),
      sensitive: accessChanging.has(key),
    }
  }),
  total: moduleUiCapabilities.length,
  version: 'access-catalog-v1',
}

const audit = {
  id: 1,
  occurred_at: '2026-09-10T08:30:00+03:00',
  actor: { id: 1, name: PERSON.name, login: 'ahmad' },
  action: 'user.roles_changed',
  target: { type: 'user', id: 1, name: employee.name },
  result: 'succeeded',
}
const auditDetail = {
  ...audit,
  before: { role_count: 0 },
  after: { role_count: 1 },
  reason: 'تحديث صلاحيات الوصول حسب مسؤوليات الوظيفة.',
}
const candidate = {
  id: 1,
  name: employee.name,
  department: DEPARTMENT,
  work_email: employee.work_email,
  active: true,
  user_id: 1,
  access_active: true,
}

const task = {
  id: 101,
  name: 'متابعة اعتماد خطة التنفيذ',
  project: PROJECT,
  state: 'in_progress',
  priority: '1',
  date_deadline: '2026-09-30',
  days_remaining: 20,
  is_overdue: false,
  is_closed: false,
  personal_stage: null,
  stage: { id: 1, name: 'قيد التنفيذ' },
  assignees: [PERSON],
  tags: [{ id: 1, name: 'متابعة', color: 5 }],
  can_write: true,
  can_approve: true,
  allowed_transitions: ['in_progress', 'approved', 'changes_requested', 'done', 'cancelled'],
}
const notifications = [
  { id: 1, kind: 'meeting_reminder', meeting_id: 1, meeting_name: meeting.name, body: 'تذكير: يبدأ الاجتماع غداً الساعة 9:00.', created_at: '2026-09-14T09:00:00+03:00', is_read: false },
  { id: 2, kind: 'overdue_digest', digest_id: 1, overdue_count: 1, local_date: '2026-09-10', body: 'لديك مهمة تحتاج إلى متابعة.', created_at: '2026-09-10T07:00:00+03:00', is_read: false },
]
const digest = {
  id: 1,
  kind: 'overdue_digest',
  local_date: '2026-09-10',
  overdue_count: 1,
  items: [task],
  total: 1,
}

const isId = (path, prefix) => path === `${prefix}/1`

export function moduleUiPreviewData(path, url) {
  const normalizedPath = String(path || '/').replace(/\/+$/, '') || '/'
  const parsedUrl = url instanceof URL ? url : new URL(String(url || 'http://preview.local'), 'http://preview.local')

  if (normalizedPath === '/api/v1/people') return PEOPLE
  if (normalizedPath === '/api/v1/meetings') return page([meeting], parsedUrl)
  if (isId(normalizedPath, '/api/v1/meetings')) return meetingDetail
  if (normalizedPath === '/api/v1/meetings/1/events') return page(events, parsedUrl)
  if (normalizedPath === '/api/v1/meetings/1/versions') return page(versions, parsedUrl)
  if (normalizedPath === '/api/v1/meetings/1/versions/1') return versions[0]
  if (normalizedPath === '/api/v1/meetings/1/attachments') return page(attachments, parsedUrl)

  if (normalizedPath === '/api/v1/meeting-series') return page([series], parsedUrl)
  if (isId(normalizedPath, '/api/v1/meeting-series')) return seriesDetail
  if (normalizedPath === '/api/v1/meeting-series/1/events') return page(events, parsedUrl)
  if (normalizedPath === '/api/v1/meeting-series/1/resolutions') return page([{ ...resolution, meeting_id: 1, meeting_name: meeting.name }], parsedUrl)

  if (normalizedPath === '/api/v1/hr/employees') return page([employee], parsedUrl)
  if (isId(normalizedPath, '/api/v1/hr/employees')) return employee
  if (normalizedPath === '/api/v1/hr/departments') return page([department], parsedUrl)
  if (isId(normalizedPath, '/api/v1/hr/departments')) return department
  if (normalizedPath === '/api/v1/hr/documents') return page([document], parsedUrl)
  if (isId(normalizedPath, '/api/v1/hr/documents')) return document

  if (normalizedPath === '/api/v1/admin/users') return page([adminUser], parsedUrl)
  if (normalizedPath === '/api/v1/admin/users/candidates') return page([candidate], parsedUrl)
  if (isId(normalizedPath, '/api/v1/admin/users')) return adminUserDetail
  if (normalizedPath === '/api/v1/admin/roles') return page([role], parsedUrl)
  if (isId(normalizedPath, '/api/v1/admin/roles')) return roleDetail
  if (normalizedPath === '/api/v1/admin/permissions') return permissionCatalog
  if (normalizedPath === '/api/v1/admin/access-log') return page([audit], parsedUrl)
  if (isId(normalizedPath, '/api/v1/admin/access-log')) return auditDetail

  if (normalizedPath === '/api/v1/notifications') return { ...page(notifications, parsedUrl), unread_count: notifications.filter((item) => !item.is_read).length }
  if (normalizedPath === '/api/v1/notification-digests/1') return digest

  return undefined
}
