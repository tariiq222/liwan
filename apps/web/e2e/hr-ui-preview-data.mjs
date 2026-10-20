// HR rows for the isolated mock (MODULE_UI_PREVIEW=1). Row 1 of each list is the row the single-row
// preview always served; rows 2+ exist so lists, filters, J/K, an archived scope and a record with
// missing data can be tested. Reads only: the mock has no HR write routes. The report and leave rows below
// feed /hr/reports and /hr/leave/:id; dates are relative to today so the overdue and due-soon tones always show.
import { hrAreasPreviewData } from './hr-areas-ui-preview-data.mjs'

const OPS = { id: 1, name: 'إدارة العمليات' }
const PEOPLE = { id: 2, name: 'الموارد البشرية' }
const SARA = { id: 1, name: 'سارة محمد' }
const KHALID = { id: 2, name: 'خالد الشمري' }
const AHMAD = { id: 1, name: 'أحمد العتيبي' }

const employees = [
  { id: 1, name: SARA.name, job_title: 'مديرة العمليات', department: OPS, work_email: 'sara@example.test', work_phone: '+966500000001', user_id: 1, manager: AHMAD, active: true, access: { user_id: 1, login: 'sara', role: 'admin', active: true }, contract: null },
  { id: 2, name: KHALID.name, job_title: 'محلل موارد بشرية', department: PEOPLE, work_email: 'khalid@example.test', work_phone: '+966500000002', user_id: null, manager: SARA, active: true, access: null, contract: null },
  { id: 3, name: 'منى القحطاني', job_title: '', department: null, work_email: '', work_phone: '', user_id: null, manager: null, active: true, access: null, contract: null },
  { id: 4, name: 'ليلى الدوسري', job_title: 'منسقة', department: OPS, work_email: 'laila@example.test', work_phone: '', user_id: 4, manager: SARA, active: false, access: { user_id: 4, login: 'laila', role: 'employee', active: false }, contract: null },
]
const departments = [
  { id: 1, name: OPS.name, parent_id: null, manager: SARA, child_ids: [3], employee_count: 4 },
  { id: 2, name: PEOPLE.name, parent_id: null, manager: KHALID, child_ids: [], employee_count: 2 },
  { id: 3, name: 'العمليات الميدانية', parent_id: 1, manager: null, child_ids: [], employee_count: 0 },
]

const DAY_MS = 86_400_000
const isoDay = (daysFromToday) => new Date(Date.now() + daysFromToday * DAY_MS).toISOString().slice(0, 10)
const expiring = [
  { kind: 'identity', employee: KHALID, document: null, days_left: -3 },
  { kind: 'contract_end', employee: SARA, document: null, days_left: 5 },
  { kind: 'document', employee: SARA, document: { id: 1, name: 'إقامة سارة محمد' }, days_left: 12 },
  { kind: 'probation_end', employee: { id: 3, name: 'منى القحطاني' }, document: null, days_left: 25 },
  { kind: 'contract_end', employee: KHALID, document: null, days_left: 47 },
  { kind: 'identity', employee: SARA, document: null, days_left: 80 },
].map(({ days_left, ...item }) => ({ ...item, due_date: isoDay(days_left), days_left }))
const saudization = {
  overall: { total: 10, saudi: 5, non_saudi: 3, unknown: 2, saudi_percent: 62.5 },
  items: [
    { department: OPS, total: 5, saudi: 3, non_saudi: 2, unknown: 0, saudi_percent: 60 },
    { department: PEOPLE, total: 3, saudi: 2, non_saudi: 1, unknown: 0, saudi_percent: 66.7 },
    { department: null, total: 2, saudi: 0, non_saudi: 0, unknown: 2, saudi_percent: null },
  ],
  total: 3,
}
const ANNUAL = { id: 1, name: 'إجازة سنوية' }
const SICK = { id: 2, name: 'إجازة مرضية' }
const leaves = [
  { id: 1, employee: SARA, leave_type: ANNUAL, date_from: '2026-11-01', date_to: '2026-11-05', number_of_days: 5, state: 'confirm', notes: 'سفر عائلي مخطط له منذ فترة.', can_approve: true, can_refuse: true, can_cancel: false, can_withdraw: false },
  { id: 2, employee: KHALID, leave_type: SICK, date_from: '2026-10-12', date_to: '2026-10-12', number_of_days: 1, state: 'validate', notes: '', can_approve: false, can_refuse: false, can_cancel: true, can_withdraw: false },
  { id: 3, employee: SARA, leave_type: ANNUAL, date_from: '2026-09-01', date_to: '2026-09-03', number_of_days: 3, state: 'refuse', notes: '', can_approve: false, can_refuse: false, can_cancel: false, can_withdraw: false },
]
const leaveBalances = [{ leave_type: ANNUAL, allocated: 21, taken: 3, pending: 5, remaining: 13 }]

const page = (items, url) => {
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Number(url.searchParams.get('limit') ?? 50)
  return { items: items.slice(offset, offset + (Number.isFinite(limit) && limit > 0 ? limit : 50)), total: items.length }
}
const matches = (name, q) => !q || name.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase())
const byId = (rows, path, base) => {
  const id = /^\d+$/.test(path.slice(base.length + 1)) ? Number(path.slice(base.length + 1)) : NaN
  return rows.find(row => row.id === id)
}

export function hrPreviewData(path, url) {
  const route = String(path || '/').replace(/\/+$/, '') || '/'
  const q = url.searchParams.get('q') ?? ''
  const department = Number(url.searchParams.get('department_id') ?? 0)
  if (route === '/api/v1/hr/employees') {
    const archived = ['1', 'true'].includes(url.searchParams.get('archived') ?? '')
    return page(employees.filter(row => row.active !== archived && matches(row.name, q) && (!department || row.department?.id === department)), url)
  }
  if (route.startsWith('/api/v1/hr/employees/')) return byId(employees, route, '/api/v1/hr/employees')
  if (route === '/api/v1/hr/saudization') return saudization
  if (route === '/api/v1/hr/expiring') {
    const within = Number(url.searchParams.get('within_days') ?? 60)
    const items = expiring.filter(item => item.days_left <= within)
    return { items, total: items.length }
  }
  if (route === '/api/v1/hr/leave/balances') return { items: leaveBalances, total: leaveBalances.length }
  if (route === '/api/v1/hr/leave/requests') {
    const state = url.searchParams.get('state')
    return page(leaves.filter(leave => !state || leave.state === state), url)
  }
  if (route.startsWith('/api/v1/hr/leave/requests/')) return byId(leaves, route, '/api/v1/hr/leave/requests')
  if (route === '/api/v1/hr/departments') return page(departments, url)
  if (route.startsWith('/api/v1/hr/departments/')) return byId(departments, route, '/api/v1/hr/departments')
  return hrAreasPreviewData(route, url)
}
