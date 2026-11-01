// Synthetic rows for the five employee-lifecycle HR areas (shifts, assets, recruitment, onboarding,
// offboarding) of the isolated mock (MODULE_UI_PREVIEW=1). Shapes follow packages/contracts/src/hr.
// Reads only, except the administrative warnings (below), which keep state like the payroll preview. Row 1 of each list is the row the specs open.
const OPS = { id: 1, name: 'إدارة العمليات' }
const PEOPLE = { id: 2, name: 'الموارد البشرية' }
const SARA = { id: 1, name: 'سارة محمد' }
const KHALID = { id: 2, name: 'خالد الشمري' }
const MONA = { id: 3, name: 'منى القحطاني' }
const LAILA = { id: 4, name: 'ليلى الدوسري' }
const AHMAD = { id: 1, name: 'أحمد العتيبي' }

const page = (items, url) => {
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Number(url.searchParams.get('limit') ?? 50)
  return { items: items.slice(offset, offset + (Number.isFinite(limit) && limit > 0 ? limit : 50)), total: items.length }
}
const matches = (text, q) => !q || text.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase())
const rowOf = (rows, route, base) => {
  const raw = route.slice(base.length + 1)
  return /^\d+$/.test(raw) ? rows.find(row => row.id === Number(raw)) : undefined
}
const numberParam = (url, key) => Number(url.searchParams.get(key) ?? 0)
const activeScope = (url, row) => {
  const scope = url.searchParams.get('active') ?? 'true'
  return scope === 'all' || row.active === (scope === 'true')
}

// ---- Shifts ----
const workDays = ['6', '0', '1', '2', '3']
const attendances = (from, to) => workDays.map(dayofweek => ({ dayofweek, day_period: 'full_day', hour_from: from, hour_to: to, week_type: null }))
const schedules = [
  { id: 1, name: 'دوام صباحي', tz: 'Asia/Riyadh', two_weeks: false, hours_per_week: 40, active: true, attendances: attendances(8, 16) },
  { id: 2, name: 'دوام مسائي', tz: 'Asia/Riyadh', two_weeks: false, hours_per_week: 40, active: true, attendances: attendances(14, 22) },
  { id: 3, name: 'دوام رمضان', tz: 'Asia/Riyadh', two_weeks: false, hours_per_week: 30, active: false, attendances: attendances(10, 16) },
]
const shiftAssignments = [
  { id: 1, employee: SARA, schedule: { id: 1, name: schedules[0].name }, date_start: '2026-01-01', date_end: null },
  { id: 2, employee: KHALID, schedule: { id: 2, name: schedules[1].name }, date_start: '2026-03-01', date_end: '2026-12-31' },
  { id: 3, employee: MONA, schedule: { id: 1, name: schedules[0].name }, date_start: null, date_end: null },
]
const onDate = (row, day) => (!row.date_start || row.date_start <= day) && (!row.date_end || row.date_end >= day)
function shiftsData(route, url) {
  // The current mock company's calendar and signed-in user's timezone are Asia/Riyadh.
  // Match the server's unsaved default policy, including its company-local calendar day.
  if (route === '/api/v1/hr/shifts/settings') return {
    day_reference: 'company', company_timezone: 'Asia/Riyadh', effective_timezone: 'Asia/Riyadh',
    today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
    default_schedule: { id: 7, name: 'دوام الأحد إلى الخميس' },
    revision: 0,
  }
  if (route === '/api/v1/hr/shifts/schedules') {
    const scope = url.searchParams.get('active') ?? 'true'
    return page(schedules.filter(row => scope === 'all' || row.active === (scope === 'true')), url)
  }
  if (route.startsWith('/api/v1/hr/shifts/schedules/')) return rowOf(schedules, route, '/api/v1/hr/shifts/schedules')
  if (route === '/api/v1/hr/shifts/assignments') {
    const employee = numberParam(url, 'employee_id')
    const schedule = numberParam(url, 'schedule_id')
    const day = url.searchParams.get('on_date')
    return page(shiftAssignments.filter(row => (!employee || row.employee.id === employee)
      && (!schedule || row.schedule.id === schedule) && (!day || onDate(row, day))), url)
  }
  if (route === '/api/v1/hr/shifts/me') return page(shiftAssignments.filter(row => row.employee.id === SARA.id), url)
  return undefined
}

// ---- Assets ----
const assetCategories = [{ id: 1, name: 'حواسيب محمولة' }, { id: 2, name: 'هواتف' }, { id: 3, name: 'شاشات' }]
const equipment = [
  { id: 1, name: 'حاسوب محمول ديل', category: assetCategories[0], serial_no: 'DL-1001', model: 'Latitude 5440', employee: SARA, assign_date: '2026-02-01', warranty_date: '2028-02-01', scrap_date: null, active: true },
  { id: 2, name: 'شاشة إل جي 27', category: assetCategories[2], serial_no: 'LG-2002', model: '27UP850', employee: null, assign_date: null, warranty_date: null, scrap_date: null, active: true },
  { id: 3, name: 'هاتف آيفون 15', category: assetCategories[1], serial_no: '', model: 'iPhone 15', employee: KHALID, assign_date: '2026-04-10', warranty_date: '2027-04-10', scrap_date: null, active: true },
  { id: 4, name: 'طابعة مكتبية قديمة', category: null, serial_no: 'PR-0004', model: '', employee: null, assign_date: null, warranty_date: null, scrap_date: '2026-06-30', active: false },
]
function assetsData(route, url) {
  if (route === '/api/v1/hr/assets/categories') return { items: assetCategories, total: assetCategories.length }
  if (route === '/api/v1/hr/assets/equipment') {
    const q = url.searchParams.get('q') ?? ''
    const category = numberParam(url, 'category_id')
    const employee = numberParam(url, 'employee_id')
    const assigned = url.searchParams.get('assigned')
    return page(equipment.filter(row => activeScope(url, row)
      && matches(`${row.name} ${row.serial_no}`, q)
      && (!category || row.category?.id === category)
      && (!employee || row.employee?.id === employee)
      && (!assigned || (assigned === 'true') === Boolean(row.employee))), url)
  }
  if (route.startsWith('/api/v1/hr/assets/equipment/')) return rowOf(equipment, route, '/api/v1/hr/assets/equipment')
  if (route === '/api/v1/hr/assets/me') return page(equipment.filter(row => row.employee?.id === SARA.id), url)
  return undefined
}

// ---- Recruitment ----
const jobs = [
  { id: 1, name: 'مطور واجهات', department: OPS, no_of_recruitment: 2, application_count: 2, description: 'تطوير واجهات المنصة.', active: true },
  { id: 2, name: 'محلل موارد بشرية', department: PEOPLE, no_of_recruitment: 1, application_count: 0, description: '', active: true },
  { id: 3, name: 'مساعد إداري', department: null, no_of_recruitment: 0, application_count: 0, description: '', active: false },
]
const stages = [
  { id: 1, name: 'جديد', sequence: 1, hired_stage: false, fold: false },
  { id: 2, name: 'مقابلة أولى', sequence: 2, hired_stage: false, fold: false },
  { id: 3, name: 'مقابلة نهائية', sequence: 3, hired_stage: false, fold: false },
  { id: 4, name: 'تم التعيين', sequence: 4, hired_stage: true, fold: true },
]
const refuseReasons = [{ id: 1, name: 'عدم ملاءمة الخبرة' }, { id: 2, name: 'رفض العرض' }]
const ref = ({ id, name }) => ({ id, name })
const applicant = (id, name, job, stage, status, extra = {}) => ({
  id, partner_name: name, email_from: `applicant${id}@example.test`, partner_phone: `+96655000000${id}`,
  job: ref(job), department: job.department, stage: ref(stage), status, priority: '1', availability: '2026-12-01',
  refuse_reason: null, employee: null, applied_on: `2026-10-0${id}T08:00:00+03:00`, active: status !== 'archived', ...extra,
})
const applicants = [
  applicant(1, 'عبدالله الغامدي', jobs[0], stages[1], 'ongoing', { priority: '2' }),
  applicant(2, 'ريم السبيعي', jobs[0], stages[0], 'ongoing'),
  applicant(3, 'فهد المطيري', jobs[1], stages[3], 'hired', { priority: '3', employee: { id: 5, name: 'فهد المطيري' } }),
  applicant(4, 'هند الزهراني', jobs[1], stages[0], 'refused', { priority: '0', refuse_reason: refuseReasons[0] }),
]
function recruitmentData(route, url) {
  const q = url.searchParams.get('q') ?? ''
  if (route === '/api/v1/hr/recruitment/jobs') {
    const department = numberParam(url, 'department_id')
    return page(jobs.filter(row => activeScope(url, row) && matches(row.name, q) && (!department || row.department?.id === department)), url)
  }
  if (route.startsWith('/api/v1/hr/recruitment/jobs/')) return rowOf(jobs, route, '/api/v1/hr/recruitment/jobs')
  if (route === '/api/v1/hr/recruitment/stages') return { items: stages, total: stages.length }
  if (route === '/api/v1/hr/recruitment/refuse-reasons') return { items: refuseReasons, total: refuseReasons.length }
  if (route === '/api/v1/hr/recruitment/applicants') {
    const job = numberParam(url, 'job_id')
    const stage = numberParam(url, 'stage_id')
    const status = url.searchParams.get('status')
    return page(applicants.filter(row => matches(row.partner_name, q)
      && (!job || row.job?.id === job) && (!stage || row.stage?.id === stage) && (!status || row.status === status)), url)
  }
  if (route.startsWith('/api/v1/hr/recruitment/applicants/')) return rowOf(applicants, route, '/api/v1/hr/recruitment/applicants')
  return undefined
}

// ---- Onboarding and offboarding: the same plans and runs with the purpose fixed ----
const planStep = (id, summary, responsible_type, delay_count, delay_unit = 'days', delay_from = 'after_plan_date') => ({
  id, summary, responsible_type, responsible: null, delay_count, delay_unit, delay_from,
})
const runStep = (id, summary, assignee, date_deadline, state, can_complete) => ({
  id, summary, assignee, date_deadline, state, date_done: state === 'done' ? date_deadline : null, can_complete,
})
const planRun = (id, employee, plan, plan_date, steps) => {
  const done = steps.filter(step => step.state === 'done').length
  return { id, employee, plan: { id: plan.id, name: plan.name }, plan_date, launched_by: AHMAD, done, total: steps.length, state: done === steps.length ? 'done' : 'open', cancellation: null, can_cancel: done !== steps.length, steps }
}
const runSummary = ({ steps: _steps, can_cancel: _canCancel, ...run }) => run

const onboardingPlans = [
  { id: 1, name: 'تهيئة الموظفين الجدد', department: OPS, active: true, steps: [planStep(1, 'تجهيز الحساب والبريد', 'manager', 0), planStep(2, 'جولة تعريفية بالفريق', 'employee', 2), planStep(3, 'مراجعة الأسبوع الأول', 'manager', 1, 'weeks')] },
  { id: 2, name: 'تهيئة فريق التقنية', department: null, active: true, steps: [planStep(4, 'منح صلاحيات المستودع', 'coach', 1)] },
]
const onboardingRuns = [
  planRun(1, MONA, onboardingPlans[0], '2026-10-01', [
    runStep(1, 'تجهيز الحساب والبريد', AHMAD, '2026-10-01', 'done', false),
    runStep(2, 'جولة تعريفية بالفريق', MONA, '2026-10-03', 'overdue', true),
    runStep(3, 'مراجعة الأسبوع الأول', AHMAD, '2026-10-08', 'planned', true),
  ]),
  planRun(2, KHALID, onboardingPlans[1], '2026-09-01', [runStep(4, 'منح صلاحيات المستودع', AHMAD, '2026-09-02', 'done', false)]),
]

const offboardingPlans = [
  { id: 3, name: 'خطة إخلاء الطرف', department: null, active: true, steps: [planStep(5, 'استلام العهد', 'manager', 0, 'days', 'before_plan_date'), planStep(6, 'إغلاق الحسابات', 'manager', 1)] },
]
const offboardingRuns = [
  planRun(21, KHALID, offboardingPlans[0], '2026-11-30', [
    runStep(11, 'استلام العهد', AHMAD, '2026-11-29', 'done', false),
    runStep(12, 'إغلاق الحسابات', AHMAD, '2026-12-01', 'planned', true),
  ]),
  planRun(22, LAILA, offboardingPlans[0], '2026-08-15', [
    runStep(13, 'استلام العهد', AHMAD, '2026-08-14', 'done', false),
    runStep(14, 'إغلاق الحسابات', AHMAD, '2026-08-16', 'done', false),
  ]),
]
const departureReasons = [{ id: 1, name: 'استقالة' }, { id: 2, name: 'انتهاء العقد' }]
const clearanceOf = run => ({ run_id: run?.id ?? null, done: run?.done ?? 0, total: run?.total ?? 0 })
const departures = [
  { employee: KHALID, active: true, departure_date: '2026-11-30', reason: departureReasons[0], description: 'انتقال إلى جهة أخرى.', clearance: clearanceOf(offboardingRuns[0]) },
  { employee: LAILA, active: false, departure_date: '2026-08-15', reason: departureReasons[1], description: '', clearance: clearanceOf(offboardingRuns[1]) },
  { employee: MONA, active: true, departure_date: '2026-12-15', reason: null, description: '', clearance: clearanceOf(null) },
]
const isCleared = row => row.clearance.total > 0 && row.clearance.done === row.clearance.total

function lifecycleData(area, plans, runs, route, url) {
  const base = `/api/v1/hr/${area}`
  if (route === `${base}/plans`) return page(plans.filter(row => activeScope(url, row)), url)
  if (route.startsWith(`${base}/plans/`)) return rowOf(plans, route, `${base}/plans`)
  if (route === `${base}/runs`) {
    const employee = numberParam(url, 'employee_id')
    const state = url.searchParams.get('state')
    return page(runs.filter(row => (!employee || row.employee.id === employee) && (!state || row.state === state)).map(runSummary), url)
  }
  if (route.startsWith(`${base}/runs/`)) return rowOf(runs, route, `${base}/runs`)
  return undefined
}

function offboardingData(route, url) {
  if (route === '/api/v1/hr/offboarding/reasons') return { items: departureReasons, total: departureReasons.length }
  if (route === '/api/v1/hr/offboarding/departures') {
    const q = url.searchParams.get('q') ?? ''
    const cleared = url.searchParams.get('cleared')
    return page(departures.filter(row => matches(row.employee.name, q) && (!cleared || (cleared === 'true') === isCleared(row))), url)
  }
  if (route.startsWith('/api/v1/hr/offboarding/departures/')) {
    const raw = route.slice('/api/v1/hr/offboarding/departures/'.length)
    return departures.find(row => String(row.employee.id) === raw)
  }
  // Offboarding has no runs list: the departures register carries each employee's clearance.
  if (route === '/api/v1/hr/offboarding/runs') return undefined
  return lifecycleData('offboarding', offboardingPlans, offboardingRuns, route, url)
}


// ---- Administrative warnings ----
// Stateful, like the payroll preview: hrWarningsPreviewWrite() changes these rows and POST /api/v1/__mock/reset-warnings
// restores the seeds. The signed-in employee is SARA (the `/me` rows); the mock admin is the issuer (HR), so `can_issue` is true.
const ADMIN = { id: 2, name: 'Admin' }
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const daysAgo = days => new Date(Date.now() - days * 86400000).toISOString()
const dayOf = iso => iso.slice(0, 10)
const WARNING_COUNTED = ['issued', 'acknowledged', 'contested']
let warnings
let warningTypes
let warningSettings
let nextWarningId
let nextTypeId

function seedWarnings() {
  warningTypes = [
    { id: 1, name: 'إنذار شفهي', severity: 1, active: true, revision: 1 },
    { id: 2, name: 'إنذار كتابي', severity: 2, active: true, revision: 1 },
    { id: 3, name: 'إنذار نهائي', severity: 3, active: true, revision: 1 },
    { id: 4, name: 'لفت نظر', severity: 1, active: false, revision: 2 },
  ]
  const typeOf = id => { const { name, severity } = warningTypes.find(row => row.id === id); return { id, name, severity } }
  const base = (id, employee, typeId, state, over = {}) => ({
    id, employee, type: typeOf(typeId), date_issued: dayOf(daysAgo(10 + id)), reason: 'تأخر عن الدوام ثلاث مرات خلال أسبوع واحد دون إشعار مسبق.',
    corrective_action: null, state, acknowledgement: 'required', ack_pending: false, issued_by: ADMIN, issued_at: daysAgo(10 + id),
    acknowledged_at: null, contested_at: null, contest_note: null, withdrawn_by: null, withdrawn_at: null, withdraw_reason: null, revision: 2, ...over,
  })
  warnings = [
    base(1, SARA, 2, 'issued', { ack_pending: true, corrective_action: 'الالتزام بساعات الدوام وإشعار المدير قبل أي تأخر.' }),
    base(2, KHALID, 1, 'acknowledged', { acknowledged_at: daysAgo(8) }),
    base(3, MONA, 2, 'contested', { contested_at: daysAgo(5), contest_note: 'لم أتلقَّ إشعارًا بتغيير ساعات الدوام.' }),
    base(4, SARA, 1, 'withdrawn', { withdrawn_by: ADMIN, withdrawn_at: daysAgo(20), withdraw_reason: 'صدر بالخطأ.' }),
    base(5, LAILA, 1, 'draft', { issued_by: null, issued_at: null, revision: 1 }),
    base(6, KHALID, 3, 'issued', { acknowledgement: 'off', date_issued: dayOf(daysAgo(2)), issued_at: daysAgo(2) }),
  ]
  warningSettings = { warnings_issued_by: 'hr_only', warnings_employee_acknowledgement: 'required', warnings_escalation_window_months: 12, revision: 1 }
  nextWarningId = 7
  nextTypeId = 5
}
seedWarnings()

const warningRefusal = (status, code, message, field) => ({ status, body: field ? { code, message, field } : { code, message } })
const warningStanding = employeeId => {
  const counted = warnings.filter(row => row.employee.id === employeeId && WARNING_COUNTED.includes(row.state))
  return { employee_id: employeeId, window_months: warningSettings.warnings_escalation_window_months, active_count: counted.length, highest_severity: counted.length ? Math.max(...counted.map(row => row.type.severity)) : null }
}
const warningSettingsView = () => ({ ...warningSettings, can_issue: true })

function warningsData(route, url) {
  if (route === '/api/v1/hr/warning-types') {
    const all = url.searchParams.get('active') === 'all'
    return page([...warningTypes].filter(row => all || row.active), url)
  }
  if (route === '/api/v1/hr/warnings/settings') return warningSettingsView()
  if (route === '/api/v1/hr/warnings/candidates') return page([SARA, KHALID, MONA, LAILA], url)
  if (route === '/api/v1/hr/warnings/me') return page(warnings.filter(row => row.employee.id === SARA.id && WARNING_COUNTED.includes(row.state)), url)
  const standing = /^\/api\/v1\/hr\/warnings\/standing\/(\d+)$/.exec(route)
  if (standing) return warningStanding(Number(standing[1]))
  if (route === '/api/v1/hr/warnings') {
    const employee = numberParam(url, 'employee_id')
    const type = numberParam(url, 'type_id')
    const state = url.searchParams.get('state')
    return page(warnings.filter(row => (!employee || row.employee.id === employee) && (!type || row.type.id === type) && (!state || row.state === state)), url)
  }
  return rowOf(warnings, route, '/api/v1/hr/warnings')
}

/** The write routes of the warnings preview: `{status, body}`, or undefined for a route this preview does not own. */
export function hrWarningsPreviewWrite(method, route, body) {
  if (method === 'POST' && route === '/api/v1/__mock/reset-warnings') { seedWarnings(); return { status: 200, body: { ok: true } } }
  const stale = (row, revision) => revision !== row.revision && warningRefusal(409, 'conflict', 'تغيّر السجل؛ أعد التحميل قبل الحفظ.')
  if (method === 'PATCH' && route === '/api/v1/hr/warnings/settings') {
    if (body.revision !== warningSettings.revision) return warningRefusal(409, 'conflict', 'تغيّرت الإعدادات؛ أعد التحميل قبل الحفظ.')
    const months = body.warnings_escalation_window_months
    if (!Number.isInteger(months) || months < 1 || months > 60) return warningRefusal(422, 'invalid', 'مدة التصعيد من شهر إلى 60 شهرًا.', 'warnings_escalation_window_months')
    warningSettings = { warnings_issued_by: body.warnings_issued_by, warnings_employee_acknowledgement: body.warnings_employee_acknowledgement, warnings_escalation_window_months: months, revision: warningSettings.revision + 1 }
    return { status: 200, body: warningSettingsView() }
  }
  if (method === 'POST' && route === '/api/v1/hr/warning-types') {
    if (!String(body.name ?? '').trim()) return warningRefusal(422, 'invalid', 'اسم النوع مطلوب.', 'name')
    const type = { id: nextTypeId++, name: body.name.trim(), severity: body.severity, active: true, revision: 1 }
    warningTypes.push(type)
    return { status: 201, body: type }
  }
  const typeRoute = /^\/api\/v1\/hr\/warning-types\/(\d+)$/.exec(route)
  if (method === 'PATCH' && typeRoute) {
    const type = warningTypes.find(row => row.id === Number(typeRoute[1]))
    if (!type) return warningRefusal(404, 'not_found', 'النوع غير موجود.')
    const refusal = stale(type, body.revision)
    if (refusal) return refusal
    Object.assign(type, { ...(body.name !== undefined && { name: body.name.trim() }), ...(body.severity !== undefined && { severity: body.severity }), ...(body.active !== undefined && { active: body.active }), revision: type.revision + 1 })
    return { status: 200, body: type }
  }
  if (method === 'POST' && route === '/api/v1/hr/warnings') {
    const employee = [SARA, KHALID, MONA, LAILA].find(row => row.id === body.employee_id)
    const type = warningTypes.find(row => row.id === body.type_id && row.active)
    if (!employee) return warningRefusal(422, 'invalid', 'اختر موظفًا.', 'employee_id')
    if (!type) return warningRefusal(422, 'invalid', 'اختر نوع إنذار فعّالًا.', 'type_id')
    if (!String(body.reason ?? '').trim()) return warningRefusal(422, 'invalid', 'السبب مطلوب.', 'reason')
    const row = {
      id: nextWarningId++, employee, type: { id: type.id, name: type.name, severity: type.severity }, date_issued: body.date_issued ?? today, reason: body.reason.trim(),
      corrective_action: body.corrective_action?.trim() || null, state: 'draft', acknowledgement: warningSettings.warnings_employee_acknowledgement, ack_pending: false,
      issued_by: null, issued_at: null, acknowledged_at: null, contested_at: null, contest_note: null, withdrawn_by: null, withdrawn_at: null, withdraw_reason: null, revision: 1,
    }
    warnings.push(row)
    return { status: 201, body: row }
  }
  const action = /^\/api\/v1\/hr\/warnings\/(me\/)?(\d+)\/(issue|withdraw|acknowledge|contest)$/.exec(route)
  if (method !== 'POST' || !action) return undefined
  const row = warnings.find(item => item.id === Number(action[2]) && (!action[1] || item.employee.id === SARA.id))
  if (!row) return warningRefusal(404, 'not_found', 'الإنذار غير موجود.')
  const refusal = stale(row, body.revision)
  if (refusal) return refusal
  const wrongState = () => warningRefusal(409, 'conflict', 'لا يمكن تنفيذ هذا الإجراء في حالة الإنذار الحالية.')
  const now = new Date().toISOString()
  const step = {
    issue: () => row.state === 'draft' && Object.assign(row, { state: 'issued', issued_by: ADMIN, issued_at: now, acknowledgement: warningSettings.warnings_employee_acknowledgement, ack_pending: warningSettings.warnings_employee_acknowledgement === 'required' }),
    withdraw: () => row.state !== 'withdrawn' && (String(body.reason ?? '').trim() ? Object.assign(row, { state: 'withdrawn', ack_pending: false, withdrawn_by: ADMIN, withdrawn_at: now, withdraw_reason: body.reason.trim() }) : 'invalid'),
    acknowledge: () => row.state === 'issued' && row.acknowledgement !== 'off' && Object.assign(row, { state: 'acknowledged', ack_pending: false, acknowledged_at: now }),
    contest: () => row.state === 'issued' && row.acknowledgement !== 'off' && (String(body.note ?? '').trim() ? Object.assign(row, { state: 'contested', ack_pending: false, contested_at: now, contest_note: body.note.trim() }) : 'invalid'),
  }[action[3]]()
  if (step === 'invalid') return warningRefusal(422, 'invalid', 'الحقل المطلوب فارغ.', action[3] === 'withdraw' ? 'reason' : 'note')
  if (!step) return wrongState()
  row.revision += 1
  return { status: 200, body: row }
}

export function hrAreasPreviewData(route, url) {
  if (route.startsWith('/api/v1/hr/shifts')) return shiftsData(route, url)
  if (route.startsWith('/api/v1/hr/assets')) return assetsData(route, url)
  if (route.startsWith('/api/v1/hr/warning')) return warningsData(route, url)
  if (route.startsWith('/api/v1/hr/recruitment')) return recruitmentData(route, url)
  if (route.startsWith('/api/v1/hr/onboarding')) return lifecycleData('onboarding', onboardingPlans, onboardingRuns, route, url)
  if (route.startsWith('/api/v1/hr/offboarding')) return offboardingData(route, url)
  return undefined
}
