#!/usr/bin/env node
import http from 'node:http'
import { projectsPreviewData } from './projects-ui-preview-data.mjs'
import { moduleUiCapabilities, moduleUiPreviewData } from './module-ui-preview-data.mjs'
import crypto from 'node:crypto'
import { URL } from 'node:url'

const PORT = Number(process.env.MOCK_PORT || 4388)
const SESSION = 'nasq-ui-mock'
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

const CAPABILITIES = [
  'access.users.read', 'access.users.grant', 'access.users.assign_roles', 'access.users.disable',
  'access.users.reset_password', 'access.roles.read', 'access.roles.manage', 'access.audit.read',
  'hr.employees.read', 'hr.employees.manage', 'hr.employees.archive', 'hr.employees.access_status.read',
  'hr.departments.read', 'hr.departments.manage', 'hr.documents.read', 'hr.documents.manage',
  'pmo.projects.read', 'pmo.projects.create', 'pmo.projects.manage', 'pmo.settings.manage',
  'pmo.tasks.read', 'pmo.tasks.create', 'pmo.tasks.write', 'pmo.tasks.approve',
  'settings.branding.manage',
]

const ME = {
  id: 2, name: 'Admin', login: 'admin', email: 'admin@example.com', lang: 'ar_001', tz: 'Asia/Riyadh',
  role: 'admin',
  roles: [{ id: 1, key: 'admin', name: { ar: 'مدير', en: 'Admin' }, type: 'built_in', protected: true, source: 'assignment' }],
  capabilities: CAPABILITIES, access_policy_version: 1,
  company: { id: 1, name: 'Nasq' },
}

const BRANDING = {
  name: 'نَسَق',
  logo_url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="6" fill="#18181b"/></svg>'),
  primary_color: process.env.PREVIEW_PRIMARY_COLOR || '#18181b',
  font: 'IBM Plex Sans Arabic',
}

const CHARTER = {
  code: 'P-1', type: { id: 1, name: 'داخلي' }, owning_unit: { id: 1, name: 'مكتب المشاريع' },
  sponsor: { id: 2, name: 'Admin' }, authority: '', rationale: '', objectives: [], benefits: '',
  scope: '', exclusions: '', high_level_requirements: '', deliverables: [], success: '',
  budget_state: 'unknown', amount: null, currency: null, priority: 'normal',
  assumptions: '', constraints: '', closure: '',
}

const STAGES = [
  { id: 11, name: 'جديد', sequence: 1, fold: false, task_count: 2 },
  { id: 12, name: 'جارٍ', sequence: 2, fold: false, task_count: 1 },
]

const PROJECTS = [
  {
    id: 1, name: 'مشروع ألفا', status: 'on_track', progress: 40, task_count: 3, closed_task_count: 1,
    active: true, can_manage: true, manager: { id: 2, name: 'Admin' }, date_end: '2035-12-31',
    allowed_actions: ['read', 'write', 'archive'],
  },
  {
    id: 2, name: 'مشروع بيتا', status: 'off_track', progress: 10, task_count: 1, closed_task_count: 0,
    active: true, can_manage: true, manager: { id: 2, name: 'Admin' }, date_end: '2035-06-30',
    allowed_actions: ['read', 'write', 'archive'],
  },
  {
    id: 3, name: 'مشروع جاما', status: 'at_risk', progress: 55, task_count: 2, closed_task_count: 0,
    active: true, can_manage: false, manager: { id: 2, name: 'Admin' }, date_end: '2035-03-01',
    allowed_actions: ['read'],
  },
]

function projectDetail(p) {
  return {
    ...p,
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
    updated_at: 'v1',
    charter: CHARTER,
  }
}

function task(id, name, state, extra = {}) {
  return {
    id, name, project: { id: 1, name: 'مشروع ألفا' }, state, priority: '1',
    date_deadline: extra.date_deadline ?? '2035-01-15',
    days_remaining: extra.days_remaining ?? 120,
    is_overdue: Boolean(extra.is_overdue), is_closed: state === 'done' || state === 'cancelled',
    personal_stage: null, stage: { id: 11, name: 'جديد' },
    assignees: [{ id: 2, name: 'Admin' }], tags: [],
    can_write: true, can_approve: true,
    allowed_transitions: ['in_progress', 'changes_requested', 'approved', 'waiting', 'done', 'cancelled'],
  }
}

const TASKS = [
  task(101, 'مهمة جارية', 'in_progress'),
  task(102, 'مهمة تحتاج تعديلاً', 'changes_requested'),
  task(103, 'مهمة ملغاة', 'cancelled'),
  task(104, 'مهمة مكتملة', 'done'),
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
    if (params.db !== 'nasq_ui_mock_only' || params.login !== 'admin' || params.password !== 'admin') {
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

  if (!path.startsWith('/api/v1/')) return fail(res, 404, 'not_found', `unknown path ${method} ${path}`)

  if (!hasSession(req)) return fail(res, 403, 'forbidden', 'not logged in')

  if (process.env.MODULE_UI_PREVIEW === '1' && method === 'GET') {
    if (path === '/api/v1/me') return json(res, 200, { ...ME, capabilities: moduleUiCapabilities })
    const preview = moduleUiPreviewData(path, url)
    if (preview !== undefined) return json(res, 200, preview)
  }

  if (process.env.PROJECTS_UI_PREVIEW === '1' && method === 'GET') {
    const preview = projectsPreviewData(path, url, { PROJECTS, TASKS, projectDetail, reportRow, CURRENCY })
    if (preview !== undefined) return json(res, 200, preview)
  }
  if (method === 'GET' && path === '/api/v1/me') return json(res, 200, ME)
  if (method === 'GET' && path === '/api/v1/admin/branding') return json(res, 200, BRANDING)
  if (method === 'GET' && path === '/api/v1/notifications') return json(res, 200, NOTIFICATIONS)
  if (method === 'POST' && match(path, '/api/v1/notifications/:id/read')) return json(res, 200, { updated: 1 })
  if (method === 'POST' && path === '/api/v1/notifications/read-all') return json(res, 200, { updated: 2 })
  if (method === 'GET' && path === '/api/v1/tasks') return json(res, 200, { items: TASKS, total: TASKS.length })
  if (method === 'GET' && path === '/api/v1/projects') {
    if (url.searchParams.get('minimal') === '1') {
      return json(res, 200, PROJECTS.map(p => ({ id: p.id, name: p.name })))
    }
    return json(res, 200, { items: PROJECTS, total: PROJECTS.length, can_create: true, can_list_archived: true })
  }
  const project = match(path, '/api/v1/projects/:id')
  if (method === 'GET' && project) {
    const p = PROJECTS.find(item => String(item.id) === project.id)
    if (!p) return fail(res, 404, 'not_found', 'project not found')
    return json(res, 200, projectDetail(p))
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
  if (method === 'GET' && path === '/api/v1/people') return json(res, 200, [])
  if (method === 'GET' && path === '/api/v1/tags') return json(res, 200, [])
  if (method === 'GET' && path === '/api/v1/settings/projects') return json(res, 200, SETTINGS)
  if (method === 'GET' && path === '/api/v1/settings/projects/create-defaults') {
    return json(res, 200, { require_manager_on_create: false, require_end_date_on_create: false, default_manager_id: 2 })
  }
  if (method === 'GET' && path === '/api/v1/reports/projects') {
    const items = PROJECTS.map(reportRow)
    return json(res, 200, {
      items,
      total: items.length,
      totals: [{
        currency: CURRENCY,
        project_count: items.length,
        budgeted_project_count: items.length,
        planned: 3000,
        actual: 900,
        remaining: 2100,
        over_budget_count: 0,
      }],
    })
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
  handle(req, res).catch((err) => {
    fail(res, 500, 'server_error', String(err?.message || err))
  })
})

server.on('upgrade', (req, socket) => {
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
