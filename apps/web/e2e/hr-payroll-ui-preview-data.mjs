// Synthetic payroll for the isolated mock (MODULE_UI_PREVIEW=1): runs with their payslips, the payroll settings and the
// GOSI rates. Shapes follow packages/contracts/src/hr/payroll.ts. Unlike the other HR previews it keeps state, so the
// run page can compute, approve, cancel and edit inputs against it; POST /api/v1/__mock/reset-payroll restores the
// seeds between spec runs. The figures are a small deterministic stand-in for the payroll engine (not its rules).
const ADMIN = { id: 2, name: 'Admin' }
const INPUT_KEYS = ['overtime_amount', 'absence_days', 'bonus_amount', 'deduction_amount', 'advance_recovery_amount']
const PEOPLE = [
  { employee: { id: 3, name: 'ليلى الحربي' }, department: { id: 1, name: 'المالية' }, base: 10500, ibanMissing: false },
  { employee: { id: 4, name: 'خالد الشمري' }, department: { id: 2, name: 'الموارد البشرية' }, base: 9200, ibanMissing: true },
  { employee: { id: 5, name: 'منى القحطاني' }, department: null, base: 8300, ibanMissing: false },
]
const GOSI_EMPLOYEE = 0.0975
const GOSI_EMPLOYER = 0.1175
const money = value => Math.round(value * 100) / 100
const noInputs = () => Object.fromEntries(INPUT_KEYS.map(key => [key, 0]))

let state
function seed() {
  const slips = (runId, bonusOfFirst = 0) => PEOPLE.map((person, index) => ({
    id: runId * 10 + index + 1,
    person,
    state: 'draft',
    inputs: { ...noInputs(), ...(index === 0 ? { bonus_amount: bonusOfFirst } : {}) },
  }))
  state = {
    nextRunId: 4,
    runs: [
      { id: 3, month: '2026-12', state: 'draft', approvedAt: null, slips: [] },
      { id: 2, month: '2026-11', state: 'computed', approvedAt: null, slips: slips(2, 500) },
      { id: 1, month: '2026-10', state: 'approved', approvedAt: '2026-10-28T09:30:00Z', slips: slips(1) },
    ],
    settings: { day_divisor: 30, structure: { id: 1, name: 'هيكل الرواتب السعودي' }, unpaid_leave_types: [{ id: 3, name: 'إجازة بدون راتب' }], annual_leave_type: { id: 1, name: 'إجازة سنوية' } },
    rates: [
      { id: 1, branch: 'annuities', nationality_class: 'saudi_from_2024', date_from: '2024-07-03', employee_rate: 9.5, employer_rate: 11.5, wage_min: 400, wage_max: 45000, shared: true },
      { id: 2, branch: 'hazards', nationality_class: 'non_saudi', date_from: '2026-01-01', employee_rate: 0, employer_rate: 2, wage_min: 0, wage_max: 45000, shared: false },
    ],
    nextRateId: 3,
  }
}
seed()

function figures(slip) {
  const { base } = slip.person
  const { overtime_amount, absence_days, bonus_amount, deduction_amount, advance_recovery_amount } = slip.inputs
  const gross = money(base + overtime_amount + bonus_amount - absence_days * (base / state.settings.day_divisor))
  const gosi = money(base * GOSI_EMPLOYEE)
  const deductions = money(gosi + deduction_amount + advance_recovery_amount)
  return { gross, deductions, gosi, net: money(gross - deductions), employer: money(base * GOSI_EMPLOYER) }
}

function totals(run) {
  const sums = { gross: 0, deductions: 0, gosi_employee: 0, gosi_employer: 0, net: 0 }
  for (const slip of run.slips) {
    const f = figures(slip)
    sums.gross += f.gross
    sums.deductions += f.deductions
    sums.gosi_employee += f.gosi
    sums.gosi_employer += f.employer
    sums.net += f.net
  }
  return Object.fromEntries(Object.entries(sums).map(([key, value]) => [key, money(value)]))
}

const ACTIONS = { draft: ['compute', 'cancel', 'edit_inputs'], computed: ['compute', 'approve', 'cancel', 'edit_inputs'], approved: [] }

function summary(run) {
  return { id: run.id, month: run.month, state: run.state, employee_count: run.slips.length, totals: totals(run), approved_at: run.approvedAt }
}
function detail(run) {
  return {
    ...summary(run),
    warnings: run.slips.filter(slip => slip.person.ibanMissing).map(slip => ({ code: 'missing_iban', employee: slip.person.employee })),
    allowed_actions: ACTIONS[run.state],
    approved_by: run.state === 'approved' ? ADMIN : null,
    finance: null,
  }
}
function row(slip) {
  const f = figures(slip)
  return {
    id: slip.id, employee: slip.person.employee, department: slip.person.department, state: slip.state, paid_days: 30,
    inputs: slip.inputs, gross: f.gross, deductions: f.deductions, net: f.net, iban_missing: slip.person.ibanMissing,
  }
}
function payslip(run, slip) {
  const f = figures(slip)
  const lines = [{ code: 'BASIC', name: 'الأجر الأساسي', category: 'BASIC', amount: slip.person.base }]
  if (slip.inputs.bonus_amount) lines.push({ code: 'WV_BONUS', name: 'مكافأة', category: 'ALW', amount: slip.inputs.bonus_amount })
  lines.push({ code: 'GOSI_EMP', name: 'تأمينات الموظف', category: 'DED', amount: -f.gosi })
  return {
    id: slip.id, number: `SLIP/${run.month.replace('-', '/')}/${slip.id}`, month: run.month, state: 'done',
    employee: slip.person.employee, department: slip.person.department, paid_days: 30, lines,
    gross: f.gross, deductions: f.deductions, net: f.net, gosi_employer: f.employer,
    company: { name: 'شركة النماء للتقنية', vat: '300012345600003' },
  }
}

const page = (items, url) => {
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Number(url.searchParams.get('limit') ?? 50)
  return { items: items.slice(offset, offset + (Number.isFinite(limit) && limit > 0 ? limit : 50)), total: items.length }
}
const runRoute = /^\/api\/v1\/hr\/payroll\/runs\/(\d+)(?:\/(compute|approve|payslips))?(?:\/(\d+))?(?:\/(inputs))?$/
const findRun = id => state.runs.find(run => run.id === Number(id))

export function hrPayrollPreviewData(route, url) {
  if (route === '/api/v1/hr/payroll/settings') return state.settings
  if (route === '/api/v1/hr/payroll/gosi-rates') return { items: state.rates, total: state.rates.length }
  if (route === '/api/v1/hr/payroll/runs') {
    const year = url.searchParams.get('year')
    const stateFilter = url.searchParams.get('state')
    return page(state.runs.filter(run => (!year || run.month.startsWith(year)) && (!stateFilter || run.state === stateFilter)).map(summary), url)
  }
  const match = runRoute.exec(route)
  if (!match) return undefined
  const [, id, section, slipId] = match
  const run = findRun(id)
  if (!run) return undefined
  if (!section) return detail(run)
  if (section !== 'payslips') return undefined
  if (slipId) {
    const slip = run.slips.find(item => item.id === Number(slipId))
    return slip ? payslip(run, slip) : undefined
  }
  const q = (url.searchParams.get('q') ?? '').trim()
  return page(run.slips.filter(slip => !q || slip.person.employee.name.includes(q)).map(row), url)
}

const ok = body => ({ status: 200, body })
const notFound = { status: 404, body: { code: 'not_found', message: 'not found' } }
const invalid = (message, field) => ({ status: 422, body: { code: 'invalid', message, field } })

/** The writes: `{status, body}`, or undefined for a route this preview does not own. */
export function hrPayrollPreviewWrite(method, route, body) {
  if (method === 'POST' && route === '/api/v1/__mock/reset-payroll') { seed(); return ok({ ok: true }) }
  if (method === 'PATCH' && route === '/api/v1/hr/payroll/settings') {
    state.settings = { ...state.settings, ...(body.day_divisor !== undefined ? { day_divisor: body.day_divisor } : {}) }
    return ok(state.settings)
  }
  if (method === 'POST' && route === '/api/v1/hr/payroll/gosi-rates') {
    const rate = { id: state.nextRateId++, ...body, shared: false }
    state.rates.push(rate)
    return { status: 201, body: rate }
  }
  const rateMatch = /^\/api\/v1\/hr\/payroll\/gosi-rates\/(\d+)$/.exec(route)
  if (rateMatch) {
    const rate = state.rates.find(item => item.id === Number(rateMatch[1]))
    if (!rate) return notFound
    if (method === 'PATCH') return ok(Object.assign(rate, body))
    if (method === 'DELETE') { state.rates = state.rates.filter(item => item !== rate); return { status: 204, body: '' } }
  }
  if (method === 'POST' && route === '/api/v1/hr/payroll/runs') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(body.month))) return invalid('month must be a YYYY-MM month', 'month')
    if (state.runs.some(run => run.month === body.month)) return { status: 422, body: { code: 'duplicate', message: 'a run exists for this month', field: 'month' } }
    const run = { id: state.nextRunId++, month: body.month, state: 'draft', approvedAt: null, slips: [] }
    state.runs.unshift(run)
    return { status: 201, body: detail(run) }
  }
  const match = runRoute.exec(route)
  if (!match) return undefined
  const [, id, section, slipId, inputs] = match
  const run = findRun(id)
  if (!run) return notFound
  if (method === 'DELETE' && !section) {
    if (!ACTIONS[run.state].includes('cancel')) return { status: 403, body: { code: 'transition_forbidden', message: 'the run cannot be cancelled' } }
    state.runs = state.runs.filter(item => item !== run)
    return { status: 204, body: '' }
  }
  if (method === 'POST' && section === 'compute') {
    if (!ACTIONS[run.state].includes('compute')) return { status: 403, body: { code: 'transition_forbidden', message: 'the run cannot be computed' } }
    run.slips = PEOPLE.map((person, index) => run.slips[index] ?? { id: run.id * 10 + index + 1, person, state: 'draft', inputs: noInputs() })
    run.state = 'computed'
    return ok(detail(run))
  }
  if (method === 'POST' && section === 'approve') {
    if (!ACTIONS[run.state].includes('approve')) return { status: 403, body: { code: 'transition_forbidden', message: 'the run cannot be approved' } }
    run.state = 'approved'
    run.approvedAt = '2026-11-28T09:30:00Z'
    return ok(detail(run))
  }
  if (method === 'PATCH' && section === 'payslips' && inputs) {
    const slip = run.slips.find(item => item.id === Number(slipId))
    if (!slip) return notFound
    if (!ACTIONS[run.state].includes('edit_inputs')) return { status: 422, body: { code: 'invalid', message: 'the inputs are locked', field: 'state', details: { reason: 'not_editable' } } }
    const keys = Object.keys(body)
    const bad = keys.find(key => !INPUT_KEYS.includes(key) || typeof body[key] !== 'number' || body[key] < 0)
    if (!keys.length || bad) return invalid('inputs must be numbers, zero or more', bad)
    Object.assign(slip.inputs, body)
    return ok(row(slip))
  }
  return undefined
}
