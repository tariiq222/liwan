// Synthetic rows for the five employee-lifecycle HR areas (shifts, assets, recruitment, onboarding,
// offboarding) of the isolated mock (MODULE_UI_PREVIEW=1). Shapes follow packages/contracts/src/hr.
// Reads only: the mock has no HR write routes. Row 1 of each list is the row the specs open.
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
  return { id, employee, plan: { id: plan.id, name: plan.name }, plan_date, launched_by: AHMAD, done, total: steps.length, state: done === steps.length ? 'done' : 'open', steps }
}
const runSummary = ({ steps: _steps, ...run }) => run

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
  return lifecycleData('offboarding', offboardingPlans, offboardingRuns, route, url)
}

export function hrAreasPreviewData(route, url) {
  if (route.startsWith('/api/v1/hr/shifts')) return shiftsData(route, url)
  if (route.startsWith('/api/v1/hr/assets')) return assetsData(route, url)
  if (route.startsWith('/api/v1/hr/recruitment')) return recruitmentData(route, url)
  if (route.startsWith('/api/v1/hr/onboarding')) return lifecycleData('onboarding', onboardingPlans, onboardingRuns, route, url)
  if (route.startsWith('/api/v1/hr/offboarding')) return offboardingData(route, url)
  return undefined
}
