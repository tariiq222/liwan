// Synthetic payroll for the isolated mock (MODULE_UI_PREVIEW=1): runs with their payslips, the payroll settings and the
// GOSI rates. Shapes follow packages/contracts/src/hr/payroll.ts. Unlike the other HR previews it keeps state, so the
// run page can compute, approve, cancel and edit inputs against it; POST /api/v1/__mock/reset-payroll restores the
// seeds between spec runs (its body {finance: false} seeds a company without the finance bridge: the finance routes
// then answer 404, and a run offers no post or payment). The figures are a small deterministic stand-in for the payroll engine (not its rules).
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

const ROLES = ['basic_expense', 'allowance_expense', 'variable_expense', 'gosi_expense', 'gosi_payable', 'salaries_payable', 'deduction', 'advance', 'eos_expense', 'eos_provision']
const ACCOUNT_REFS = { basic_expense: { id: 11, name: '510101 مصروف الأجور الأساسية' }, salaries_payable: { id: 13, name: '210101 الرواتب المستحقة' } }

let state
function seed(finance = true) {
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
    finance: finance
      ? {
          settings: {
            journal: { id: 7, name: 'قيود الرواتب' },
            accounts: Object.fromEntries(ROLES.map(role => [role, ACCOUNT_REFS[role] ?? null])),
            default_analytic_account: null,
            entry_detail: 'aggregated',
          },
          // Department 1 has a cost center; department 2 has none (so its employee is flagged in the preview).
          centers: [
            { department: { id: 1, name: 'المالية' }, analytic_account: { id: 5, name: 'فرع الرياض' } },
            { department: { id: 2, name: 'الموارد البشرية' }, analytic_account: null },
          ],
        }
      : null,
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

const BASE_ACTIONS = { draft: ['compute', 'cancel', 'edit_inputs'], computed: ['compute', 'approve', 'cancel', 'edit_inputs'], approved: [], posted: [], paid: [] }
const FINANCE_ACTIONS = { approved: ['post'], posted: ['record_payment'] }
const actionsOf = run => state.finance ? FINANCE_ACTIONS[run.state] ?? BASE_ACTIONS[run.state] : BASE_ACTIONS[run.state]

function summary(run) {
  return { id: run.id, month: run.month, state: run.state, employee_count: run.slips.length, totals: totals(run), approved_at: run.approvedAt }
}
function detail(run) {
  return {
    ...summary(run),
    warnings: run.slips.filter(slip => slip.person.ibanMissing).map(slip => ({ code: 'missing_iban', employee: slip.person.employee })),
    allowed_actions: actionsOf(run),
    approved_by: run.approvedAt ? ADMIN : null,
    finance: state.finance ? { entry_id: run.entry ? 91 : null, entry_name: run.entry ?? null, payment_id: run.payment ? 92 : null, payment_name: run.payment ?? null } : null,
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

const debitCredit = (account, debit, credit) => ({ account, analytic_account: null, employee: null, debit: money(debit), credit: money(credit) })
function postingPreview(run) {
  const sums = totals(run)
  const rows = [
    debitCredit({ id: 11, code: '510101', name: 'مصروف الأجور الأساسية' }, sums.gross, 0),
    debitCredit({ id: 14, code: '510401', name: 'مصروف التأمينات' }, sums.gosi_employer, 0),
    debitCredit({ id: 13, code: '210101', name: 'الرواتب المستحقة' }, 0, sums.net),
    debitCredit({ id: 15, code: '210201', name: 'التأمينات المستحقة' }, 0, sums.gosi_employee + sums.gosi_employer),
    debitCredit({ id: 16, code: '210301', name: 'الاستقطاعات' }, 0, sums.deductions - sums.gosi_employee),
  ].filter(line => line.debit || line.credit)
  const mapped = new Set(state.finance.centers.filter(center => center.analytic_account).map(center => center.department.id))
  return {
    entry_detail: state.finance.settings.entry_detail,
    date: `${run.month}-28`,
    journal: state.finance.settings.journal,
    lines: rows,
    debit: money(rows.reduce((sum, line) => sum + line.debit, 0)),
    credit: money(rows.reduce((sum, line) => sum + line.credit, 0)),
    warnings: run.slips.filter(slip => !slip.person.department || !mapped.has(slip.person.department.id)).map(slip => ({ code: 'unmapped_department', employee: slip.person.employee })),
  }
}

const page = (items, url) => {
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Number(url.searchParams.get('limit') ?? 50)
  return { items: items.slice(offset, offset + (Number.isFinite(limit) && limit > 0 ? limit : 50)), total: items.length }
}
// The signed-in employee is the first person of each approved run: their own approved payslips, newest month first.
const mineRoute = /^\/api\/v1\/hr\/payroll\/payslips\/mine(?:\/(\d+))?$/
const ownSlips = () => state.runs.filter(run => ['approved', 'posted', 'paid'].includes(run.state)).map(run => ({ run, slip: run.slips[0] })).filter(entry => entry.slip)
const runRoute = /^\/api\/v1\/hr\/payroll\/runs\/(\d+)(?:\/(compute|approve|payslips|posting-preview|post|payment))?(?:\/(\d+))?(?:\/(inputs))?$/
const findRun = id => state.runs.find(run => run.id === Number(id))

export function hrPayrollPreviewData(route, url) {
  if (route === '/api/v1/hr/payroll/settings') return state.settings
  if (route === '/api/v1/hr/payroll/gosi-rates') return { items: state.rates, total: state.rates.length }
  if (route === '/api/v1/hr/payroll/finance-settings') return state.finance?.settings
  if (route === '/api/v1/hr/payroll/cost-centers') return state.finance && { items: state.finance.centers, total: state.finance.centers.length }
  if (route === '/api/v1/hr/payroll/runs') {
    const year = url.searchParams.get('year')
    const stateFilter = url.searchParams.get('state')
    return page(state.runs.filter(run => (!year || run.month.startsWith(year)) && (!stateFilter || run.state === stateFilter)).map(summary), url)
  }
  const own = mineRoute.exec(route)
  if (own) {
    const entries = ownSlips().sort((a, b) => b.run.month.localeCompare(a.run.month))
    if (!own[1]) return { items: entries.map(({ run, slip }) => ({ id: slip.id, number: payslip(run, slip).number, month: run.month, net: figures(slip).net })), total: entries.length }
    const entry = entries.find(({ slip }) => slip.id === Number(own[1]))
    return entry ? payslip(entry.run, entry.slip) : undefined
  }
  const match = runRoute.exec(route)
  if (!match) return undefined
  const [, id, section, slipId] = match
  const run = findRun(id)
  if (!run) return undefined
  if (!section) return detail(run)
  if (section === 'posting-preview') return state.finance && run.state === 'approved' ? postingPreview(run) : undefined
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
  if (method === 'POST' && route === '/api/v1/__mock/reset-payroll') { seed(body.finance !== false); return ok({ ok: true }) }
  if (method === 'PATCH' && route === '/api/v1/hr/payroll/settings') {
    // Like the server: an empty patch, a divisor outside 28-31 and a null annual leave type are refused.
    if (!Object.keys(body).length) return invalid('no fields to update')
    if (body.day_divisor !== undefined && !(Number.isInteger(body.day_divisor) && body.day_divisor >= 28 && body.day_divisor <= 31)) return invalid('day_divisor must be a whole number from 28 to 31', 'day_divisor')
    if ('annual_leave_type_id' in body && !(Number.isInteger(body.annual_leave_type_id) && body.annual_leave_type_id > 0)) return invalid('annual_leave_type_id does not reference an existing record', 'annual_leave_type_id')
    if (body.day_divisor !== undefined) state.settings.day_divisor = body.day_divisor
    if (body.annual_leave_type_id !== undefined) state.settings.annual_leave_type = { id: body.annual_leave_type_id, name: 'إجازة' }
    if (body.unpaid_leave_type_ids !== undefined) state.settings.unpaid_leave_types = body.unpaid_leave_type_ids.map(id => ({ id, name: 'إجازة' }))
    return ok(state.settings)
  }
  if (method === 'PATCH' && route === '/api/v1/hr/payroll/finance-settings') {
    if (!state.finance) return notFound
    if (!Object.keys(body).length) return invalid('no fields to update')
    if (body.entry_detail !== undefined && !['aggregated', 'per_employee'].includes(body.entry_detail)) return invalid('entry_detail must be aggregated or per_employee', 'entry_detail')
    const { settings } = state.finance
    if (body.entry_detail !== undefined) settings.entry_detail = body.entry_detail
    if ('journal_id' in body) settings.journal = body.journal_id === null ? null : { id: body.journal_id, name: 'دفتر' }
    if ('default_analytic_account_id' in body) settings.default_analytic_account = body.default_analytic_account_id === null ? null : { id: body.default_analytic_account_id, name: 'مركز تكلفة' }
    for (const [role, id] of Object.entries(body.accounts ?? {})) settings.accounts[role] = id === null ? null : { id, name: 'حساب' }
    return ok(settings)
  }
  const centerMatch = /^\/api\/v1\/hr\/payroll\/cost-centers\/(\d+)$/.exec(route)
  if (centerMatch && method === 'PUT') {
    const center = state.finance?.centers.find(item => item.department.id === Number(centerMatch[1]))
    if (!center) return notFound
    if (!('analytic_account_id' in body)) return invalid('analytic_account_id is required', 'analytic_account_id')
    center.analytic_account = body.analytic_account_id === null ? null : { id: body.analytic_account_id, name: 'مركز تكلفة' }
    return ok(center)
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
    if (!actionsOf(run).includes('cancel')) return { status: 403, body: { code: 'transition_forbidden', message: 'the run cannot be cancelled' } }
    state.runs = state.runs.filter(item => item !== run)
    return { status: 204, body: '' }
  }
  if (method === 'POST' && section === 'compute') {
    if (!actionsOf(run).includes('compute')) return { status: 403, body: { code: 'transition_forbidden', message: 'the run cannot be computed' } }
    run.slips = PEOPLE.map((person, index) => run.slips[index] ?? { id: run.id * 10 + index + 1, person, state: 'draft', inputs: noInputs() })
    run.state = 'computed'
    return ok(detail(run))
  }
  if (method === 'POST' && section === 'approve') {
    if (!actionsOf(run).includes('approve')) return { status: 403, body: { code: 'transition_forbidden', message: 'the run cannot be approved' } }
    run.state = 'approved'
    run.approvedAt = '2026-11-28T09:30:00Z'
    return ok(detail(run))
  }
  if (method === 'POST' && section === 'post') {
    if (!actionsOf(run).includes('post')) return { status: 403, body: { code: 'transition_forbidden', message: 'the run cannot be posted' } }
    run.state = 'posted'
    run.entry = `JE/${run.month.replace('-', '/')}/0001`
    return ok(detail(run))
  }
  if (method === 'POST' && section === 'payment') {
    if (!actionsOf(run).includes('record_payment')) return { status: 403, body: { code: 'transition_forbidden', message: 'the run cannot be paid' } }
    if (!Number.isInteger(body.journal_id) || body.journal_id < 1) return invalid('journal_id is required', 'journal_id')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) return invalid('date must be a YYYY-MM-DD day', 'date')
    if (body.date < `${run.month}-01`) return { status: 422, body: { code: 'period_locked', message: 'the accounting period is locked', field: 'date' } }
    run.state = 'paid'
    run.payment = `PAY/${run.month.replace('-', '/')}/0001`
    return ok(detail(run))
  }
  if (method === 'PATCH' && section === 'payslips' && inputs) {
    const slip = run.slips.find(item => item.id === Number(slipId))
    if (!slip) return notFound
    if (!actionsOf(run).includes('edit_inputs')) return { status: 422, body: { code: 'invalid', message: 'the inputs are locked', field: 'state', details: { reason: 'not_editable' } } }
    const keys = Object.keys(body)
    const bad = keys.find(key => !INPUT_KEYS.includes(key) || typeof body[key] !== 'number' || body[key] < 0)
    if (!keys.length || bad) return invalid('inputs must be numbers, zero or more', bad)
    Object.assign(slip.inputs, body)
    return ok(row(slip))
  }
  return undefined
}
