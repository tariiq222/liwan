#!/usr/bin/env node
import http from 'node:http'
import { projectsPreviewData } from './projects-ui-preview-data.mjs'
import { pmoPreviewData } from './pmo-ui-preview-data.mjs'
import { moduleUiCapabilities, moduleUiPreviewData } from './module-ui-preview-data.mjs'
import { hrPayrollPreviewWrite } from './hr-payroll-ui-preview-data.mjs'
import { capabilitiesForRequest } from './mock-capabilities.mjs'
import { INBOX_CAPABILITIES, INBOX_FEATURES, inboxPreviewData, resetInboxPreview } from './inbox-ui-preview-data.mjs'
import { handleCommercial } from './commercial-mock-routes.mjs'
import { handlePayments, PAYMENTS_MANAGE } from './payments-mock-routes.mjs'
import crypto from 'node:crypto'
import { URL } from 'node:url'

const PORT = Number(process.env.MOCK_PORT || 4388)
const SESSION = 'webvue-ui-mock'
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
// Deterministic local asset for the two employee records in the screenshot fixture.
const HR_FIXTURE_AVATAR = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="#e2e8f0"/><circle cx="64" cy="46" r="22" fill="#64748b"/><path d="M24 120c0-27 18-44 40-44s40 17 40 44" fill="#64748b"/></svg>'

const CAPABILITIES = [
  'access.users.read', 'access.users.grant', 'access.users.assign_roles', 'access.users.disable',
  'access.users.reset_password', 'access.roles.read', 'access.roles.manage', 'access.audit.read',
  'hr.employees.read', 'hr.employees.manage', 'hr.employees.archive', 'hr.employees.access_status.read',
  'hr.departments.read', 'hr.departments.manage', 'documents.items.read', 'documents.items.manage',
  'pmo.projects.read', 'pmo.projects.create', 'pmo.projects.manage', 'pmo.settings.manage',
  'pmo.tasks.read', 'pmo.tasks.create', 'pmo.tasks.write', 'pmo.tasks.approve',
  'settings.branding.manage', 'settings.company.read', 'settings.company.manage', 'ai.use', PAYMENTS_MANAGE,
  ...INBOX_CAPABILITIES,
]

// The HR area sub-features (`hr.<area>`) gate the recruitment, shifts, onboarding, offboarding and assets pages on top of their capabilities.
const HR_AREA_FEATURES = ['hr.assets', 'hr.offboarding', 'hr.onboarding', 'hr.payroll', 'hr.recruitment', 'hr.shifts']

const ME = {
  id: 2, name: 'Admin', login: 'admin', email: 'admin@example.com', lang: 'ar_001', tz: 'Asia/Riyadh',
  role: 'admin',
  roles: [{ id: 1, key: 'admin', name: { ar: 'مدير', en: 'Admin' }, type: 'built_in', protected: true, source: 'assignment' }],
  capabilities: CAPABILITIES, access_policy_version: 1,
  company: { id: 1, name: 'WebVue' },
  modules: ['webvue_chat', 'webvue_hr', 'webvue_documents', 'webvue_pmo'],
  entitlements: {
    'pmo.enabled': true, 'meetings.enabled': true, 'documents.enabled': true, 'hr.enabled': true, 'finance.enabled': true, 'chat.enabled': true, 'ai.enabled': true, 'payments.enabled': true,
    ...Object.fromEntries(INBOX_FEATURES.map(feature => [feature, true])),
    ...Object.fromEntries(HR_AREA_FEATURES.map(feature => [feature, true])),
    'users.limit': null, 'projects.max_projects': null, 'storage.limit_mb': null,
  },
  platform: {
    schema_version: 1, policy_revision: 1, state: 'active', valid_until: null, read_only: false,
    readable_features: ['ai.enabled', 'chat.enabled', 'documents.enabled', 'finance.enabled', 'hr.enabled', ...HR_AREA_FEATURES, ...INBOX_FEATURES, 'meetings.enabled', 'payments.enabled', 'pmo.enabled'],
    writable_features: ['ai.enabled', 'chat.enabled', 'documents.enabled', 'finance.enabled', 'hr.enabled', ...HR_AREA_FEATURES, ...INBOX_FEATURES, 'meetings.enabled', 'payments.enabled', 'pmo.enabled'],
  },
  terminology: { ar: {}, en: {} },
}

const BRANDING = {
  name: 'ويب فيو',
  logo_url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="6" fill="#13234a"/></svg>'),
  primary_color: process.env.PREVIEW_PRIMARY_COLOR || '#13234a',
  font: 'IBM Plex Sans Arabic',
}

// The company profile (/api/v1/admin/company): PATCH merges the sent fields, so the pages can be exercised end to end.
const COMPANY_COUNTRY = { id: 192, name: 'المملكة العربية السعودية', code: 'SA' }
const COMPANY_STATES = { 192: [{ id: 1, name: 'الرياض', code: 'RUH' }, { id: 2, name: 'مكة المكرمة', code: 'MAK' }], 229: [{ id: 3, name: 'دبي', code: 'DU' }] }
const COMPANY = {
  id: 1, name: 'ويب فيو', logo_url: null, report_header: 'منصة عربية موحّدة لتشغيل الشركات', company_registry: '1010000000', vat: '300000000000003',
  address: {
    street: 'طريق الملك فهد', street2: 'العليا', city: 'الرياض', zip: '12211', state: { id: 1, name: 'الرياض' },
    country: COMPANY_COUNTRY,
  },
  email: 'info@webvue.example', phone: '+966110000000', website: null,
  currency: { id: 5, name: 'SAR', symbol: 'ر.س' },
  // What an installed application adds to the profile (here: a text field and a select), flat by name on PATCH.
  extensions: [
    { name: 'building_code', section: 'address', kind: 'text', label: 'رقم المبنى', value: '1234' },
    { name: 'id_scheme', section: 'identity', kind: 'selection', label: 'نوع المعرّف الإضافي', value: 'CRN', options: [{ value: 'CRN', label: 'السجل التجاري' }, { value: 'MOM', label: 'رخصة البلدية' }] },
  ],
}
const COMPANY_ADDRESS_FIELDS = ['street', 'street2', 'city', 'zip']
const COMPANY_COMPLETENESS = [company => company.name, company => company.logo_url, company => company.address.country, ...['company_registry', 'vat', 'email', 'phone'].map(key => company => company[key]), ...['street', 'city', 'zip'].map(key => company => company.address[key])]

function companyProfile() {
  const done = COMPANY_COMPLETENESS.filter(filled => filled(COMPANY)).length
  return { ...COMPANY, completeness: { done, total: COMPANY_COMPLETENESS.length } }
}

function patchCompany(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'state_id') COMPANY.address.state = (COMPANY_STATES[COMPANY.address.country?.id] ?? []).find(state => state.id === value) ?? null
    else if (COMPANY_ADDRESS_FIELDS.includes(key)) COMPANY.address[key] = value
    else if (COMPANY.extensions.some(extension => extension.name === key)) COMPANY.extensions.find(extension => extension.name === key).value = value
    else COMPANY[key] = value
  }
}

const CHARTER = {
  code: 'P-1', state: 'approved', type: { id: 1, name: 'داخلي', charter_steps: [] }, owning_unit: { id: 1, name: 'مكتب المشاريع' },
  sponsor: { id: 2, name: 'Admin' }, authority: '', rationale: '', objectives: [], benefits: '',
  scope: '', exclusions: '', high_level_requirements: '', deliverables: [], success: '',
  budget_state: 'unknown', amount: null, currency: null, priority: 'normal',
  assumptions: '', constraints: '', closure: '',
  approval_required: false, can_review: false, submitted_by: null, submitted_at: null,
  approved_by: null, approved_at: null, return_note: '',
}

// Per-user appearance (PATCH /api/v1/me/appearance); /me carries it once saved.
const appearance = { mode: 'light', font_size: 'small' }

const STAGES = [
  { id: 11, name: 'جديد', sequence: 1, fold: false, task_count: 2 },
  { id: 12, name: 'جارٍ', sequence: 2, fold: false, task_count: 1 },
]

const PROJECTS = [
  {
    id: 1, name: 'مشروع ألفا', status: 'on_track', progress: 40, task_count: 3, closed_task_count: 1,
    active: true, can_manage: true, manager: { id: 2, name: 'Admin' }, date_end: '2035-12-31',
    allowed_actions: ['read', 'write', 'archive'], charter_state: 'approved',
  },
  {
    id: 2, name: 'مشروع بيتا', status: 'off_track', progress: 10, task_count: 1, closed_task_count: 0,
    active: true, can_manage: true, manager: { id: 2, name: 'Admin' }, date_end: '2035-06-30',
    allowed_actions: ['read', 'write', 'archive'], charter_state: 'approved',
  },
  {
    id: 3, name: 'مشروع جاما', status: 'at_risk', progress: 55, task_count: 2, closed_task_count: 0,
    active: true, can_manage: false, manager: { id: 2, name: 'Admin' }, date_end: '2035-03-01',
    allowed_actions: ['read'], charter_state: 'approved',
  },
]

const COPIES = []
// Rows the WebVue AI audit endpoint received; GET /__mock/ai-audit exposes them to specs.
const AI_AUDIT = []
// Provider usage rows (POST /api/v1/ai/usage); GET /__mock/ai-usage exposes them to specs.
const AI_USAGE = []
// The web gate for /ai checks this alias capability literally (apps/web/app/modules/ai/manifest.ts).
const AI_USE = 'ai.use'

// Charter approval fixtures. Their charters live in CHARTER_STATE (project id -> charter + write token) so the
// transition routes can mutate them; POST /api/v1/__mock/reset-charters restores the seeds between spec runs.
// They stay out of PROJECTS so list-based specs keep their three rows; only charter_review=1 lists them.
const MOCK_USER = { id: 2, name: 'Admin' }
const NOW = () => new Date().toISOString().slice(0, 19)
const PERSON_NAMES = { 2: 'Admin', 5: 'نورة الحربي', 6: 'سارة محمد' }
const REVIEW_BASE = {
  status: 'on_track', progress: 0, task_count: 0, closed_task_count: 0,
  active: true, can_manage: true, manager: { id: 5, name: 'نورة الحربي' }, date_end: '2035-12-31',
  allowed_actions: ['read', 'write', 'archive'],
}
const REVIEW_PROJECTS = [
  { ...REVIEW_BASE, id: 8001, name: 'ميثاق بانتظار الاعتماد' },
  { ...REVIEW_BASE, id: 8002, name: 'ميثاق أُعيد للتعديل' },
]
const CHARTER_STATE = new Map()
function seedReviewCharters() {
  CHARTER_STATE.clear()
  CHARTER_STATE.set(8001, {
    updated_at: 'v1',
    charter: {
      ...CHARTER, code: 'P-8001', state: 'submitted', approval_required: true, can_review: true,
      submitted_by: { id: 5, name: 'نورة الحربي' }, submitted_at: '2026-10-14T09:00:00',
    },
  })
  CHARTER_STATE.set(8002, {
    updated_at: 'v1',
    charter: {
      ...CHARTER, code: 'P-8002', state: 'draft', approval_required: true, can_review: false,
      return_note: 'أضف مؤشرات قياس واضحة للأهداف.',
    },
  })
}
seedReviewCharters()
const allProjects = () => [...PROJECTS, ...COPIES, ...REVIEW_PROJECTS]
const stateOf = p => CHARTER_STATE.get(p.id) ?? { charter: CHARTER, updated_at: 'v1' }
// Lifecycle phases (project id -> phase). The seeded workspace projects are already planning; review and
// created projects start at initiating like the server column default. The reset restores them.
const PHASES = ['initiating', 'planning', 'executing', 'closing', 'closed']
const PHASE_OF = new Map()
const phaseOf = p => PHASE_OF.get(p.id) ?? (PROJECTS.includes(p) ? 'planning' : 'initiating')
const listItem = p => ({ ...p, charter_state: stateOf(p).charter.state, phase: phaseOf(p) })

// Mirrors Project._webvue_phase_state: only the gate into planning has a check today.
function phaseState(p) {
  const index = PHASES.indexOf(phaseOf(p))
  const next = PHASES[index + 1] ?? null
  const nextChecks = next === 'planning' ? [{ key: 'charter_approved', ok: stateOf(p).charter.state === 'approved' }] : []
  return { current: PHASES[index], next, previous: PHASES[index - 1] ?? null, next_checks: nextChecks }
}

function projectDetail(p) {
  return {
    ...listItem(p),
    stages: STAGES,
    description_html: '<p>وصف</p>',
    privacy_visibility: 'employees',
    date_start: '2026-01-01',
    date_end: p.date_end,
    tags: [],
    followers_count: 1,
    milestone_count: 0,
    allow_task_dependencies: false,
    completion_approval: 'none',
    completion_approver: null,
    updated_at: stateOf(p).updated_at,
    charter: stateOf(p).charter,
    phase_state: phaseState(p),
  }
}

function task(id, name, state, extra = {}) {
  return {
    id, name, description_excerpt: '', subtask_count: 0, subtask_done_count: 0, attachment_count: 0, project: { id: 1, name: 'مشروع ألفا' }, state, priority: '1',
    date_deadline: extra.date_deadline ?? '2035-01-15',
    days_remaining: extra.days_remaining ?? 120,
    is_overdue: Boolean(extra.is_overdue), is_closed: state === 'done' || state === 'cancelled',
    personal_stage: null, stage: { id: 11, name: 'جديد' },
    assignees: [{ id: 2, name: 'Admin' }], tags: [],
    can_write: true, can_approve: true,
    allowed_transitions: ['in_progress', 'changes_requested', 'approved', 'waiting', 'done', 'cancelled'],
  }
}

// Scroll restoration can only be exercised against a list taller than the
// viewport, so MOCK_TASK_COUNT pads the fixture on demand. It defaults to the
// original four so every existing spec keeps the counts it asserts.
const EXTRA_TASKS = Math.max(0, Number(process.env.MOCK_TASK_COUNT ?? 0) - 4)
const TASKS = [
  task(101, 'مهمة جارية', 'in_progress'),
  task(102, 'مهمة تحتاج تعديلاً', 'changes_requested'),
  task(103, 'مهمة ملغاة', 'cancelled'),
  task(104, 'مهمة مكتملة', 'done'),
  ...Array.from({ length: EXTRA_TASKS }, (_, index) => task(105 + index, `مهمة ${index + 5}`, 'in_progress')),
]

const NOTIFICATIONS = {
  items: [
    { id: 501, kind: 'comment', task_id: 101, task_name: 'مهمة جارية', body: 'تعليق', created_at: '2026-09-07T10:00:00', is_read: false },
    { id: 502, kind: 'assignment', task_id: 102, task_name: 'مهمة تحتاج تعديلاً', body: 'إسناد', created_at: '2026-09-07T09:00:00', is_read: false },
    { id: 503, kind: 'deadline', task_id: 103, task_name: 'مهمة ملغاة', body: 'موعد', created_at: '2026-09-06T08:00:00', is_read: true },
  ],
  total: 3,
  unread_count: 2,
}

const CURRENCY = { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 }

// Use the winning people fixture's display refs, without changing ME's auth
// persona. Both providers receive the already-created canonical fixture data.
const peoplePath = '/api/v1/people'
const peopleUrl = new URL(`http://localhost${peoplePath}`)
const taskPeople = process.env.MODULE_UI_PREVIEW === '1'
  ? moduleUiPreviewData(peoplePath, peopleUrl)
  : process.env.PROJECTS_UI_PREVIEW === '1'
    ? projectsPreviewData(peoplePath, peopleUrl, { PROJECTS, TASKS, projectDetail, reportRow, CURRENCY })
    : undefined
if (Array.isArray(taskPeople)) {
  for (const item of TASKS) {
    item.assignees = item.assignees.map(assignee => ({
      ...assignee, name: taskPeople.find(person => person.id === assignee.id)?.name ?? assignee.name,
    }))
  }
}


function reportRow(p) {
  return {
    project: { id: p.id, name: p.name, status: p.status },
    finance: {
      project_id: p.id,
      currency: CURRENCY,
      charter_estimate: null,
      planned: 1000,
      actual: 300,
      remaining: 700,
      utilization_percent: 30,
      over_budget: false,
      budget_count: 1,
      expense_count: 1,
      actual_source: 'manual',
      actual_account: null,
      can_read_actual_lines: false,
      can_choose_actual_account: false,
    },
    task_count: p.task_count,
    closed_task_count: p.closed_task_count,
    overdue_task_count: 0,
    progress: p.progress,
  }
}

const SETTINGS = {
  project_creators: 'managers',
  default_stages: [{ name: 'جديد', fold: false }, { name: 'جارٍ', fold: false }],
  require_manager_on_create: false,
  require_end_date_on_create: false,
  default_completion_approval: 'none',
  deadline_reminders_enabled: false,
  deadline_reminders_days_before: 3,
  overdue_digest_enabled: false,
  require_charter_approval: false,
  extensions: [],
}

function json(res, status, body, extra = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...extra,
  })
  res.end(payload)
}

function fail(res, status, code, message) {
  json(res, status, { code, message })
}

function hasSession(req) {
  const cookie = req.headers.cookie || ''
  return cookie.split(';').some(part => part.trim() === `session_id=${SESSION}`)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function match(pathname, pattern) {
  const a = pathname.split('/').filter(Boolean)
  const b = pattern.split('/').filter(Boolean)
  if (a.length !== b.length) return null
  const params = {}
  for (let i = 0; i < a.length; i++) {
    if (b[i].startsWith(':')) params[b[i].slice(1)] = a[i]
    else if (a[i] !== b[i]) return null
  }
  return params
}

async function handle(req, res) {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const method = req.method || 'GET'
  process.stderr.write(`${method} ${path}${url.search}\n`)

  if (method === 'POST' && path === '/web/session/authenticate') {
    let body = {}
    try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
    const params = body.params || {}
    if (params.db !== 'webvue_ui_mock_only' || params.login !== 'admin' || params.password !== 'admin') {
      return json(res, 200, { jsonrpc: '2.0', id: body.id ?? null, error: { code: 100, message: 'Access Denied' } })
    }
    return json(res, 200, { jsonrpc: '2.0', id: body.id ?? null, result: { uid: 2, username: 'admin', is_admin: true } }, {
      'set-cookie': `session_id=${SESSION}; Path=/; HttpOnly; SameSite=Lax`,
    })
  }

  if (method === 'POST' && path === '/web/session/get_session_info') {
    return json(res, 200, { jsonrpc: '2.0', result: { uid: hasSession(req) ? 2 : false, websocket_worker_version: '19.0-2' } })
  }

  if (method === 'POST' && path === '/web/session/destroy') {
    return json(res, 200, { jsonrpc: '2.0', result: {} }, {
      'set-cookie': 'session_id=; Path=/; Max-Age=0',
    })
  }

  if (method === 'GET' && path === '/api/v1/branding') return json(res, 200, BRANDING)

  if (method === 'GET' && process.env.MODULE_UI_PREVIEW === '1' && /^\/web\/image\/hr\.employee\/(1|3)\/avatar_128$/.test(path)) {
    if (!hasSession(req)) return fail(res, 403, 'forbidden', 'not logged in')
    res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' })
    res.end(HR_FIXTURE_AVATAR)
    return
  }

  if (method === 'GET' && path === '/__mock/ai-audit') return json(res, 200, { items: AI_AUDIT })
  if (method === 'GET' && path === '/__mock/ai-usage') return json(res, 200, { items: AI_USAGE })

  if (!path.startsWith('/api/v1/')) return fail(res, 404, 'not_found', `unknown path ${method} ${path}`)

  if (!hasSession(req)) return fail(res, 403, 'forbidden', 'not logged in')

  if (await handlePayments(req, res, path, { json, readBody })) return
  // Customer Inbox: conversations, settings and channels (inbox-ui-preview-data.mjs). The state lives for the process;
  // POST /api/v1/__mock/reset-inbox restores the seed so a spec starts from a known inbox.
  if (method === 'POST' && path === '/api/v1/__mock/reset-inbox') {
    resetInboxPreview()
    return json(res, 200, { ok: true })
  }
  if (/^\/api\/v1\/(inbox\/|settings\/inbox(\/|$))/.test(path)) {
    let body = {}
    if (method !== 'GET') {
      try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
    }
    const answer = inboxPreviewData(method, path, url, body)
    if (answer?.file) {
      res.writeHead(200, { 'content-type': answer.file.mime ?? 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${answer.file.filename}"`, 'cache-control': 'no-store' })
      return res.end(answer.file.body)
    }
    if (answer?.status === 204) { res.writeHead(204); return res.end() }
    if (answer) return json(res, answer.status, answer.body)
  }

  // Meetings: the minutes download is an attachment and the series accepts a quick extra occurrence (series 1 / meeting 1 only).
  if (method === 'GET' && match(path, '/api/v1/meetings/:id/minutes.pdf')) {
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="MTG-001.pdf"', 'cache-control': 'no-store' })
    res.end('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
    return
  }
  if (method === 'POST' && match(path, '/api/v1/meeting-series/:id/occurrences')) {
    let body = {}
    try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
    const seed = moduleUiPreviewData('/api/v1/meetings/1', url)
    if (!seed || match(path, '/api/v1/meeting-series/:id/occurrences').id !== '1') return fail(res, 404, 'not_found', 'series not found')
    const wrote = body.start_datetime && body.end_datetime
    return json(res, 201, {
      ...seed,
      id: 2,
      reference: 'MTG-002',
      state: 'draft',
      name: body.name || seed.name,
      ...(wrote ? { start_datetime: body.start_datetime, end_datetime: body.end_datetime, meeting_date: body.start_datetime.slice(0, 10) } : {}),
    })
  }
  if (method === 'GET' && path === '/api/v1/ai/tools') {
    // A reader (cookie mock_caps=reader) may not create projects, so Odoo would not offer it the draft tool.
    const reader = /(?:^|;\s*)mock_caps=reader(?:;|$)/.test(req.headers.cookie ?? '')
    const canCreate = !reader && capabilitiesForRequest(req.headers.cookie, moduleUiCapabilities).includes('pmo.projects.create')
    const items = [
      { name: 'pmo.list_my_tasks', kind: 'read', description: { ar: 'يعرض مهامي', en: 'List my tasks' }, input_schema: { type: 'object', properties: { limit: { type: 'integer' } } }, route: { method: 'GET', path: '/api/v1/tasks' }, input_map: { query: { filter: 'mine', limit: '$limit' } }, result_summary: ['items[].id', 'items[].name', 'items[].state', 'total'], draft_target: null },
      ...(canCreate ? [{ name: 'pmo.draft_project', kind: 'draft', description: { ar: 'مسودة مشروع', en: 'Project draft' }, input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, route: null, input_map: {}, result_summary: [], draft_target: '/projects/new' }] : []),
    ]
    return json(res, 200, { items, total: items.length, limits: { tool_calls_per_run: 8, messages_monthly: 500, messages_used: AI_AUDIT.filter(a => a.kind === 'message').length } })
  }
  if (method === 'POST' && path === '/api/v1/ai/audit') {
    let entry = {}
    try { entry = JSON.parse(await readBody(req) || '{}') } catch { entry = {} }
    AI_AUDIT.push(entry)
    return json(res, 200, { id: AI_AUDIT.length, messages_used: AI_AUDIT.filter(a => a.kind === 'message').length, messages_limit: 500 })
  }
  if (method === 'POST' && path === '/api/v1/ai/usage') {
    let batch = {}
    try { batch = JSON.parse(await readBody(req) || '{}') } catch { batch = {} }
    if (!Array.isArray(batch.items) || !batch.items.length) return json(res, 422, { code: 'invalid', message: 'items are required' })
    const rows = batch.items.map((item, index) => ({ ...item, id: AI_USAGE.length + index + 1 }))
    AI_USAGE.push(...rows)
    return json(res, 200, { items: rows, total: rows.length })
  }

  if (process.env.MODULE_UI_PREVIEW === '1' && method !== 'GET' && /^\/api\/v1\/(hr\/payroll\/|__mock\/reset-payroll$)/.test(path)) {
    let body = {}
    try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
    const write = hrPayrollPreviewWrite(method, path, body)
    if (write?.status === 204) { res.writeHead(204); return res.end() }
    if (write?.file) {
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${write.file.filename}"` })
      return res.end(write.file.body)
    }
    if (write) return json(res, write.status, write.body)
  }

  if (process.env.MODULE_UI_PREVIEW === '1' && method === 'GET') {
    if (path === '/api/v1/me') {
      // mock_readonly=payroll leaves hr.payroll readable but not writable, like an expired tenant;
      // mock_readonly=no-policy drops the whole platform policy (the fail-closed case).
      const cookie = req.headers.cookie ?? ''
      const readOnlyPayroll = /(?:^|;\s*)mock_readonly=payroll(?:;|$)/.test(cookie)
      const noPolicy = /(?:^|;\s*)mock_readonly=no-policy(?:;|$)/.test(cookie)
      const base = { ...ME }
      if (noPolicy) delete base.platform
      const platform = readOnlyPayroll ? { ...ME.platform, writable_features: ME.platform.writable_features.filter(key => key !== 'hr.payroll') } : ME.platform
      return json(res, 200, { ...base, ...(noPolicy ? {} : { platform }), appearance, capabilities: [...capabilitiesForRequest(req.headers.cookie, [...moduleUiCapabilities, PAYMENTS_MANAGE, ...INBOX_CAPABILITIES]), AI_USE] })
    }
    const preview = moduleUiPreviewData(path, url)
    if (preview?.refusal) return json(res, preview.refusal.status, preview.refusal.body)
    if (preview?.file) {
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${preview.file.filename}"` })
      return res.end(preview.file.body)
    }
    if (preview !== undefined) return json(res, 200, preview)
  }

  if (process.env.PROJECTS_UI_PREVIEW === '1' && method === 'GET') {
    const taskRead = path.match(/^\/api\/v1\/tasks\/(\d+)\/(attachments|dependencies\/candidates)$/)
    if (taskRead) {
      const item = TASKS.find(task => task.id === Number(taskRead[1]))
      if (!item) return fail(res, 404, 'not_found', 'task not found')
      if (taskRead[2] === 'attachments') {
        const detail = projectsPreviewData(`/api/v1/tasks/${item.id}`, url, { PROJECTS, TASKS, projectDetail, reportRow, CURRENCY })
        return json(res, 200, { items: detail.attachments, total: detail.attachments.length })
      }
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      if (!Number.isInteger(limit) || limit < 0 || !Number.isInteger(offset) || offset < 0) return fail(res, 422, 'invalid', 'limit and offset must be nonnegative integers')
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
      const project = PROJECTS.find(project => project.id === item.project?.id)
      const candidates = (project?.active ? TASKS : [])
        .filter(task => task.id !== item.id && task.project?.id === item.project?.id && (!q || task.name.toLowerCase().includes(q)))
        .sort((a, b) => a.name.localeCompare(b.name, 'ar') || a.id - b.id)
        .map(({ id, name, state }) => ({ id, name, state }))
      return json(res, 200, { items: candidates.slice(offset, limit === 0 ? undefined : offset + limit), total: candidates.length })
    }
    const preview = pmoPreviewData(path, url, { PROJECTS, TASKS, CURRENCY })
      ?? projectsPreviewData(path, url, { PROJECTS, TASKS, projectDetail, reportRow, CURRENCY })
    if (preview !== undefined) return json(res, 200, path === '/api/v1/people' ? preview.map(person => ({ ...person, user_id: person.user_id ?? person.id })) : preview)
  }
  if (method === 'GET' && path === '/api/v1/me') return json(res, 200, { ...ME, appearance })
  if (method === 'PATCH' && path === '/api/v1/me/appearance') {
    let patch = {}
    try { patch = JSON.parse(await readBody(req) || '{}') } catch { patch = {} }
    Object.assign(appearance, patch)
    return json(res, 200, { ...ME, appearance })
  }
  if (method === 'GET' && path === '/api/v1/admin/branding') return json(res, 200, BRANDING)
  if (method === 'GET' && path === '/api/v1/admin/company') return json(res, 200, companyProfile())
  if (method === 'PATCH' && path === '/api/v1/admin/company') {
    let patch = {}
    try { patch = JSON.parse(await readBody(req) || '{}') } catch { patch = {} }
    if (Object.hasOwn(patch, 'name') && !String(patch.name ?? '').trim()) return json(res, 422, { code: 'invalid', message: 'name must not be empty', field: 'name' })
    if (Object.hasOwn(patch, 'country_id')) return json(res, 422, { code: 'invalid', message: "field 'country_id' is not writable", field: 'country_id' })
    patchCompany(patch)
    return json(res, 200, companyProfile())
  }
  if (method === 'POST' && path === '/api/v1/admin/company/logo') {
    COMPANY.logo_url = BRANDING.logo_url
    return json(res, 200, companyProfile())
  }
  const states = match(path, '/api/v1/admin/company/countries/:id/states')
  if (method === 'GET' && states) return json(res, 200, { items: COMPANY_STATES[states.id] ?? [], total: (COMPANY_STATES[states.id] ?? []).length })
  if (method === 'GET' && path === '/api/v1/notifications') return json(res, 200, NOTIFICATIONS)
  if (method === 'POST' && match(path, '/api/v1/notifications/:id/read')) return json(res, 200, { updated: 1 })
  if (method === 'POST' && path === '/api/v1/notifications/read-all') return json(res, 200, { updated: 2 })
  if (method === 'GET' && path === '/api/v1/tasks') return json(res, 200, { items: TASKS, total: TASKS.length })
  if (method === 'GET' && path === '/api/v1/tasks/summary') {
    const done = TASKS.filter(task => task.is_closed).length
    return json(res, 200, { total: TASKS.length, open: TASKS.length - done, overdue: TASKS.filter(task => !task.is_closed && task.is_overdue).length, done })
  }
  if (method === 'GET' && path === '/api/v1/projects') {
    if (url.searchParams.get('minimal') === '1') {
      return json(res, 200, PROJECTS.map(p => ({ id: p.id, name: p.name })))
    }
    // charter_review=1 is the sponsor's "waiting for me" list: charters submitted and reviewable by the caller.
    const items = url.searchParams.get('charter_review') === '1'
      ? allProjects().filter(p => stateOf(p).charter.state === 'submitted' && stateOf(p).charter.can_review).map(listItem)
      : PROJECTS.map(listItem)
    return json(res, 200, { items, total: items.length, can_create: true, can_list_archived: true })
  }
  if (method === 'POST' && path === '/api/v1/projects') {
    let body = {}
    try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return json(res, 422, { code: 'invalid', message: 'name is required', field: 'name' })
    const sponsorId = body.charter?.sponsor_id ?? null
    const id = 9000 + COPIES.length
    const created = { ...REVIEW_BASE, id, name, status: null, manager: { id: body.user_id ?? 2, name: PERSON_NAMES[body.user_id ?? 2] ?? 'Admin' } }
    COPIES.push(created)
    CHARTER_STATE.set(id, {
      updated_at: 'v1',
      charter: {
        ...CHARTER, code: `P-${id}`, state: 'draft', approval_required: SETTINGS.require_charter_approval,
        sponsor: sponsorId ? { id: sponsorId, name: PERSON_NAMES[sponsorId] ?? 'Admin' } : null,
      },
    })
    return json(res, 201, projectDetail(created))
  }
  // Charter transitions mirror the server: the write token must match, and each action has a required state.
  const transition = match(path, '/api/v1/projects/:id/charter/:action')
  if (method === 'POST' && transition && ['submit', 'approve', 'return', 'withdraw'].includes(transition.action)) {
    const p = allProjects().find(item => String(item.id) === transition.id)
    if (!p) return fail(res, 404, 'not_found', 'project not found')
    let body = {}
    try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
    const entry = stateOf(p)
    if (body.expected_updated_at !== entry.updated_at) return fail(res, 409, 'stale_write', 'the project changed since it was loaded')
    const charter = { ...entry.charter }
    const wrongState = () => fail(res, 409, 'charter_state', 'the charter is not in a state that allows this action')
    switch (transition.action) {
      case 'submit': {
        if (charter.state !== 'draft') return wrongState()
        const selfApproved = !charter.approval_required || charter.sponsor?.id === MOCK_USER.id
        charter.state = selfApproved ? 'approved' : 'submitted'
        if (selfApproved) Object.assign(charter, { approved_by: MOCK_USER, approved_at: NOW() })
        else Object.assign(charter, { submitted_by: MOCK_USER, submitted_at: NOW(), return_note: '' })
        break
      }
      case 'approve':
        if (charter.state !== 'submitted' || !charter.can_review) return wrongState()
        Object.assign(charter, { state: 'approved', can_review: false, approved_by: MOCK_USER, approved_at: NOW() })
        break
      case 'return': {
        if (charter.state !== 'submitted' || !charter.can_review) return wrongState()
        const note = typeof body.note === 'string' ? body.note.trim() : ''
        if (!note) return json(res, 422, { code: 'invalid', message: 'a return note is required', field: 'note' })
        Object.assign(charter, { state: 'draft', can_review: false, submitted_by: null, submitted_at: null, return_note: note })
        break
      }
      default:
        if (charter.state !== 'submitted') return wrongState()
        Object.assign(charter, { state: 'draft', can_review: false, submitted_by: null, submitted_at: null })
    }
    CHARTER_STATE.set(p.id, { charter, updated_at: `v${Number(entry.updated_at.slice(1)) + 1}` })
    return json(res, 200, projectDetail(p))
  }
  // Phase moves mirror the server's order: the body (phase, then write token), the project (404), the manager
  // check (403) before the token comparison (409), then one step at a time and every check for a forward move.
  const phaseMove = match(path, '/api/v1/projects/:id/phase')
  if (method === 'POST' && phaseMove) {
    let body = {}
    try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
    if (!PHASES.includes(body.phase)) return json(res, 422, { code: 'invalid', message: 'unknown phase', field: 'phase' })
    if (!/^v\d+$/.test(body.expected_updated_at ?? '')) return json(res, 422, { code: 'invalid', message: 'expected_updated_at is required', field: 'expected_updated_at' })
    const p = allProjects().find(item => String(item.id) === phaseMove.id)
    if (!p) return fail(res, 404, 'not_found', 'project not found')
    if (!p.can_manage) return fail(res, 403, 'forbidden', 'not allowed')
    const entry = stateOf(p)
    if (body.expected_updated_at !== entry.updated_at) return fail(res, 409, 'stale_write', 'the project changed since it was loaded')
    const state = phaseState(p)
    if (body.phase !== state.next && body.phase !== state.previous) return fail(res, 409, 'phase_step', 'a project moves one phase at a time')
    if (body.phase === state.next && !state.next_checks.every(check => check.ok)) {
      return json(res, 409, { code: 'phase_gate', message: 'the gate has unmet checks', details: { checks: state.next_checks } })
    }
    PHASE_OF.set(p.id, body.phase)
    CHARTER_STATE.set(p.id, { charter: entry.charter, updated_at: `v${Number(entry.updated_at.slice(1)) + 1}` })
    return json(res, 200, projectDetail(p))
  }
  if (method === 'POST' && path === '/api/v1/__mock/reset-charters') {
    seedReviewCharters()
    PHASE_OF.clear()
    COPIES.length = 0
    SETTINGS.require_charter_approval = false
    return json(res, 200, { ok: true })
  }
  if (method === 'PATCH' && path === '/api/v1/settings/projects') {
    let body = {}
    try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
    Object.assign(SETTINGS, body)
    return json(res, 200, SETTINGS)
  }
  const project = match(path, '/api/v1/projects/:id')
  if (method === 'GET' && project) {
    const p = allProjects().find(item => String(item.id) === project.id)
    if (!p) return fail(res, 404, 'not_found', 'project not found')
    return json(res, 200, projectDetail(p))
  }
  if (method === 'POST' && path === '/api/v1/projects') {
    let body = {}
    try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return fail(res, 422, 'invalid', 'name is required')
    const created = { ...PROJECTS[0], id: 900 + COPIES.length, name, status: null, progress: 0, closed_task_count: 0, active: true }
    COPIES.push(created)
    return json(res, 201, projectDetail(created))
  }
  const copy = match(path, '/api/v1/projects/:id/copy')
  if (method === 'POST' && copy) {
    const source = PROJECTS.find(item => String(item.id) === copy.id)
    if (!source) return fail(res, 404, 'not_found', 'project not found')
    let body = {}
    try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.start_date))) return fail(res, 422, 'invalid', 'name and start_date are required')
    // Copies live outside PROJECTS so list-based specs keep their three rows; only direct links reach them.
    const created = { ...source, id: 900 + COPIES.length, name, status: null, progress: 0, closed_task_count: 0, active: true }
    COPIES.push(created)
    return json(res, 201, { ...projectDetail(created), date_start: body.start_date })
  }
  if (method === 'GET' && match(path, '/api/v1/projects/:id/followers')) return json(res, 200, [{ id: 2, name: 'Admin' }])
  if (method === 'GET' && match(path, '/api/v1/projects/:id/milestones')) return json(res, 200, [])
  if (method === 'GET' && match(path, '/api/v1/projects/:id/updates')) return json(res, 200, [])
  if (method === 'GET' && path === '/api/v1/hr/employees') return json(res, 200, { items: [], total: 0 })
  if (method === 'GET' && path === '/api/v1/hr/departments') return json(res, 200, { items: [], total: 0 })
  if (method === 'GET' && path === '/api/v1/admin/users') return json(res, 200, { items: [], total: 0 })
  if (method === 'GET' && path === '/api/v1/admin/roles') return json(res, 200, { items: [], total: 0 })
  if (method === 'GET' && path === '/api/v1/chat/conversations') return json(res, 200, { items: [], total: 0 })
  if (method === 'GET' && path === '/api/v1/me/personal-stages') return json(res, 200, [])
  if (method === 'GET' && path === '/api/v1/people') return json(res, 200, [{ id: 5, name: 'نورة الحربي', user_id: 5 }, { id: 6, name: 'سارة محمد', user_id: 6 }])
  if (method === 'GET' && path === '/api/v1/tags') return json(res, 200, [])
  if (method === 'GET' && path === '/api/v1/settings/projects') return json(res, 200, SETTINGS)
  if (method === 'GET' && path === '/api/v1/settings/projects/create-defaults') {
    return json(res, 200, { require_manager_on_create: false, require_end_date_on_create: false, default_manager_id: 2 })
  }
  if (method === 'GET' && path === '/api/v1/project-charter/defaults') return json(res, 200, { currency: null })
  if (method === 'GET' && path === '/api/v1/project-charter/catalogs/types') {
    return json(res, 200, { items: [{ id: 1, name: 'داخلي', sequence: 1, active: true }], total: 1 })
  }
  if (method === 'GET' && path === '/api/v1/project-charter/catalogs/owning-units') {
    return json(res, 200, { items: [{ id: 1, name: 'مكتب المشاريع', sequence: 1, active: true }], total: 1 })
  }

  return fail(res, 404, 'not_found', `unknown path ${method} ${path}`)
}

const server = http.createServer((req, res) => {
  const commercialUrl = new URL(req.url, 'http://mock.local')
  if (commercialUrl.pathname.startsWith('/v1/') && handleCommercial(req, res, commercialUrl)) return
  handle(req, res).catch((err) => {
    fail(res, 500, 'server_error', String(err?.message || err))
  })
})

server.on('upgrade', (req, socket) => {
  // Browsers can reset the upgraded connection when a page closes. This
  // expected peer disconnect must not stop the shared HTTP fixture service.
  socket.on('error', (error) => {
    if (error.code !== 'ECONNRESET') throw error
    socket.destroy()
  })
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
  if (url.pathname !== '/websocket') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  const key = req.headers['sec-websocket-key']
  if (!key) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  const accept = crypto.createHash('sha1').update(String(key) + WS_MAGIC).digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
})

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`mock listening 127.0.0.1:${PORT}\n`)
})
