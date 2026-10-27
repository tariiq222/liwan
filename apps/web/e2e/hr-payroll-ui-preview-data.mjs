// Synthetic payroll for the isolated mock (MODULE_UI_PREVIEW=1): runs with their payslips, the payroll settings and the
// GOSI rates. Shapes follow packages/contracts/src/hr/payroll.ts. Unlike the other HR previews it keeps state, so the
// run page can compute, approve, cancel and edit inputs against it; POST /api/v1/__mock/reset-payroll restores the
// seeds between spec runs (its body {finance: false} seeds a company without the finance bridge: the finance routes
// then answer 404, and a run offers no post or payment; {previewError: true} makes the posting preview refuse with
// missing_cost_center, returned as `{refusal: {status, body}}` for the mock server to send; {ibansComplete: true} gives every
// employee an IBAN, so the salary files download; a file comes back as `{file: {filename, body}}`). The figures are a small deterministic stand-in for the payroll engine (not its rules).
const ADMIN = { id: 2, name: 'Admin' }
const INPUT_KEYS = ['overtime_amount', 'absence_days', 'bonus_amount', 'deduction_amount', 'advance_recovery_amount']
const PEOPLE = [
  { employee: { id: 3, name: 'ليلى الحربي' }, department: { id: 1, name: 'المالية' }, base: 10500, ibanMissing: false },
  { employee: { id: 4, name: 'خالد الشمري' }, department: { id: 2, name: 'الموارد البشرية' }, base: 9200, ibanMissing: true },
  { employee: { id: 5, name: 'منى القحطاني' }, department: null, base: 8300, ibanMissing: false },
]
const GOSI_EMPLOYEE = 0.0975
const GOSI_EMPLOYER = 0.1175
// End of service: the leavers of the offboarding preview (hr-areas-ui-preview-data.mjs) with their departure reason and
// date. Employee 3 is the signed-in employee (the own-settlement refusal), and has no reason, so her case is chosen by
// hand. The award is a small stand-in for the engine's formulas, not their rules.
const EOS_LEAVERS = {
  2: { employee: { id: 2, name: 'خالد الشمري' }, reasonId: 1, date: '2026-11-30' },
  3: { employee: { id: 3, name: 'منى القحطاني' }, reasonId: null, date: '2026-12-15' },
  4: { employee: { id: 4, name: 'ليلى الدوسري' }, reasonId: 2, date: '2026-08-15' },
}
const OWN_EMPLOYEE_ID = 3
const EOS_CASES = ['termination', 'contract_expiry', 'resignation', 'force_majeure', 'marriage_childbirth', 'no_award']
const EOS_WAGE = 10500
const EOS_YEARS = 2.99
const EOS_LEAVE_DAYS = 12.5
const money = value => Math.round(value * 100) / 100
const noInputs = () => Object.fromEntries(INPUT_KEYS.map(key => [key, 0]))

const ROLES = ['basic_expense', 'allowance_expense', 'variable_expense', 'gosi_expense', 'gosi_payable', 'salaries_payable', 'deduction', 'advance', 'eos_expense', 'eos_provision']
const ACCOUNT_REFS = { basic_expense: { id: 11, name: '510101 مصروف الأجور الأساسية' }, salaries_payable: { id: 13, name: '210101 الرواتب المستحقة' } }

let state
function seed(finance = true, previewError = false, ibansComplete = false) {
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
    settings: { revision: 1, day_divisor: 30, structure: { id: 1, name: 'هيكل الرواتب السعودي' }, unpaid_leave_types: [{ id: 3, name: 'إجازة بدون راتب' }], annual_leave_type: { id: 1, name: 'إجازة سنوية' } },
    rates: [
      { id: 1, branch: 'annuities', nationality_class: 'saudi_from_2024', date_from: '2024-07-03', employee_rate: 9.5, employer_rate: 11.5, wage_min: 400, wage_max: 45000, shared: true, revision: 1 },
      { id: 2, branch: 'hazards', nationality_class: 'non_saudi', date_from: '2026-01-01', employee_rate: 0, employer_rate: 2, wage_min: 0, wage_max: 45000, shared: false, revision: 1 },
    ],
    nextRateId: 3,
    eosCases: [{ reasonId: 1, name: 'استقالة', case: 'resignation', revision: 1 }, { reasonId: 2, name: 'انتهاء العقد', case: null, revision: 0 }],
    settlements: {},
    provisions: [],
    previewError,
    ibansComplete,
    profiles: [
      { id: 1, name: 'ملف بنكي عام', kind: 'bank', delimiter: ',', encoding: 'utf-8', include_header: true, footer: 'none', columns: [{ source: 'iban', label: 'IBAN', constant_value: '' }, { source: 'net', label: 'Amount', constant_value: '' }], shared: true, revision: 1 },
      { id: 2, name: 'مدد - حماية الأجور', kind: 'wps', delimiter: ',', encoding: 'utf-8', include_header: true, footer: 'none', columns: [{ source: 'identification', label: 'ID', constant_value: '' }, { source: 'net', label: 'Amount', constant_value: '' }], shared: true, revision: 1 },
    ],
    nextProfileId: 3,
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

/** Whether the employee has no IBAN on file; a reset with {ibansComplete: true} gives everyone one. */
const ibanMissing = slip => !state.ibansComplete && slip.person.ibanMissing

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
/** Like the server: only a positive net is to be paid, so a zero-net payslip without an IBAN is not flagged. */
const unpaidIban = slip => ibanMissing(slip) && figures(slip).net > 0

const BASE_ACTIONS = { draft: ['compute', 'cancel', 'edit_inputs'], computed: ['compute', 'approve', 'cancel', 'edit_inputs'], approved: [], posted: [], paid: [] }
const FINANCE_ACTIONS = { approved: ['post'], posted: ['record_payment'] }
const provisioned = run => state.provisions.some(item => item.month === run.month)
// The end-of-service provision is offered once per month, for a run whose figures are fixed.
const provisionActions = run => state.finance && ['approved', 'posted', 'paid'].includes(run.state) && !provisioned(run) ? ['eos_provision'] : []
const actionsOf = run => [...(state.finance ? FINANCE_ACTIONS[run.state] ?? BASE_ACTIONS[run.state] : BASE_ACTIONS[run.state]), ...provisionActions(run)]

function summary(run) {
  return { id: run.id, month: run.month, state: run.state, employee_count: run.slips.length, totals: totals(run), approved_at: run.approvedAt }
}
function detail(run) {
  return {
    ...summary(run),
    warnings: run.slips.filter(unpaidIban).map(slip => ({ code: 'missing_iban', employee: slip.person.employee })),
    allowed_actions: actionsOf(run),
    approved_by: run.approvedAt ? ADMIN : null,
    finance: state.finance ? { entry_id: run.entry ? 91 : null, entry_name: run.entry ?? null, payment_id: run.payment ? 92 : null, payment_name: run.payment ?? null } : null,
  }
}
function row(slip) {
  const f = figures(slip)
  return {
    id: slip.id, employee: slip.person.employee, department: slip.person.department, state: slip.state, paid_days: 30,
    inputs: slip.inputs, gross: f.gross, deductions: f.deductions, net: f.net, iban_missing: unpaidIban(slip),
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
const runRoute = /^\/api\/v1\/hr\/payroll\/runs\/(\d+)(?:\/(compute|approve|payslips|posting-preview|post|payment|bank-file|wps-file|gosi-statement))?(?:\/(\d+))?(?:\/(inputs))?$/
const findRun = id => state.runs.find(run => run.id === Number(id))

const eosRoute = /^\/api\/v1\/hr\/payroll\/eos\/(\d+)\/(estimate|settlement)$/

/** The case a leaver is awarded under: the one asked for, otherwise the one its departure reason maps to. */
function caseOf(leaver, asked) {
  if (asked) return asked
  return state.eosCases.find(mapping => mapping.reasonId === leaver.reasonId)?.case ?? null
}

function eosFigures(leaver, awardCase, openDeductions = 0) {
  const award = awardCase === 'no_award' ? 0 : money(EOS_WAGE * 0.5 * EOS_YEARS * (awardCase === 'resignation' ? 1 / 3 : 1))
  const leaveAmount = money(EOS_WAGE / state.settings.day_divisor * EOS_LEAVE_DAYS)
  return { service_years: EOS_YEARS, eos_wage: EOS_WAGE, case: awardCase, award, leave_days: EOS_LEAVE_DAYS, leave_amount: leaveAmount, open_deductions: openDeductions, total: money(award + leaveAmount - openDeductions) }
}

function eosEstimate(leaver, url) {
  const awardCase = caseOf(leaver, url.searchParams.get('case'))
  if (!awardCase) return { refusal: { status: 422, body: { code: 'eos_case_missing', message: 'the departure reason has no award case', field: 'case' } } }
  const { open_deductions: _open, total: _total, ...figuresOfCase } = eosFigures(leaver, awardCase)
  return { employee: leaver.employee, start_date: '2023-12-01', end_date: url.searchParams.get('date') ?? leaver.date, ...figuresOfCase }
}

const settlementOf = (leaver, saved) => ({ id: leaver.employee.id + 50, employee: leaver.employee, departure_date: saved.state === 'confirmed' ? leaver.date : null, departure_mismatch: false, state: saved.state, ...eosFigures(leaver, saved.case, saved.openDeductions) })

export function hrPayrollPreviewData(route, url) {
  const eos = eosRoute.exec(route)
  if (eos) {
    const leaver = EOS_LEAVERS[eos[1]]
    if (!leaver) return undefined
    if (eos[2] === 'estimate') return eosEstimate(leaver, url)
    return state.settlements[eos[1]] ? settlementOf(leaver, state.settlements[eos[1]]) : { refusal: { status: 404, body: { code: 'not_found', message: 'no settlement yet' } } }
  }
  if (route === '/api/v1/hr/payroll/eos-cases') return { items: state.eosCases.map(caseItem), total: state.eosCases.length }
  if (route === '/api/v1/hr/payroll/eos-provisions') return state.finance && { items: state.provisions, total: state.provisions.length }
  if (route === '/api/v1/hr/payroll/settings') return state.settings
  if (route === '/api/v1/hr/payroll/gosi-rates') return { items: state.rates, total: state.rates.length }
  if (route === '/api/v1/hr/payroll/bank-profiles') return { items: state.profiles, total: state.profiles.length }
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
  if (section === 'posting-preview' && state.previewError) return { refusal: { status: 422, body: { code: 'missing_cost_center', message: 'a department has no cost center' } } }
  if (section === 'posting-preview') return state.finance && run.state === 'approved' ? postingPreview(run) : undefined
  if (section === 'gosi-statement') return fixedRun(run) ?? gosiStatement(run)
  if (section !== 'payslips') return undefined
  if (slipId) {
    const slip = run.slips.find(item => item.id === Number(slipId))
    return slip ? payslip(run, slip) : undefined
  }
  const q = (url.searchParams.get('q') ?? '').trim()
  return page(run.slips.filter(slip => !q || slip.person.employee.name.includes(q)).map(row), url)
}

/** The salary files and the GOSI statement need a run whose figures are fixed. */
const fixedRun = run => ['approved', 'posted', 'paid'].includes(run.state) ? undefined : { refusal: { status: 403, body: { code: 'transition_forbidden', message: 'the salary files need an approved payroll run' } } }

function gosiStatement(run) {
  const lines = run.slips.map((slip) => {
    const f = figures(slip)
    const annuities = { employee: money(slip.person.base * 0.095), employer: money(slip.person.base * 0.115) }
    const saned = { employee: money(f.gosi - annuities.employee), employer: money(f.employer - annuities.employer) }
    return {
      employee: slip.person.employee, gosi_number: `1000${slip.person.employee.id}`, nationality_class: 'saudi_from_2024', contributory_wage: slip.person.base,
      branches: { annuities, saned, hazards: { employee: 0, employer: 0 } }, employee_amount: f.gosi, employer_amount: f.employer,
    }
  })
  const sum = key => money(lines.reduce((total, line) => total + line[key], 0))
  return { month: run.month, lines, totals: { contributory_wage: sum('contributory_wage'), employee_amount: sum('employee_amount'), employer_amount: sum('employer_amount') } }
}

/** The `missing_iban` refusal naming the employees of ``slips``. */
const missingIban = (slips, message) => ({ status: 422, body: { code: 'missing_iban', message, field: 'iban', details: { employee_ids: slips.map(slip => slip.person.employee.id) } } })

/** A file answers like the server: a refusal while an employee has no IBAN, otherwise a small CSV. */
function salaryFile(run, section) {
  const missing = run.slips.filter(unpaidIban)
  if (missing.length) return { refusal: missingIban(missing, 'an employee to be paid has no IBAN') }
  const prefix = section === 'bank-file' ? 'salaries' : 'wps'
  return { file: { filename: `${prefix}-${run.month}.csv`, body: ['IBAN,Amount', ...run.slips.map(slip => `SA0000000000000000000000,${figures(slip).net}`)].join('\n') } }
}

const ok = body => ({ status: 200, body })
const notFound = { status: 404, body: { code: 'not_found', message: 'not found' } }
const invalid = (message, field) => ({ status: 422, body: { code: 'invalid', message, field } })
const conflict = message => ({ status: 409, body: { code: 'conflict', message } })
const caseItem = mapping => ({ departure_reason: { id: mapping.reasonId, name: mapping.name }, case: mapping.case, revision: mapping.revision })
/** Like the server's `split_revision`: a missing or too small revision is a 422, the rest of the body comes back. */
function splitRevision(body, minimum = 1) {
  const { revision, ...rest } = body ?? {}
  if (!Number.isInteger(revision) || revision < minimum) return { refusal: invalid(`revision must be an integer of at least ${minimum}`, 'revision') }
  return { revision, rest }
}
/** A revision-checked write of `record`: 409 when the client read an older revision, else the write and revision + 1. */
function revised(record, revision, message, apply) {
  if (revision !== record.revision) return conflict(message)
  apply()
  record.revision += 1
  return ok(record)
}

/** The writes: `{status, body}`, or undefined for a route this preview does not own. */
export function hrPayrollPreviewWrite(method, route, body) {
  if (method === 'POST' && route === '/api/v1/__mock/reset-payroll') { seed(body.finance !== false, body.previewError === true, body.ibansComplete === true); return ok({ ok: true }) }
  if (method === 'PATCH' && route === '/api/v1/hr/payroll/settings') {
    // Like the server: the revision read, then an empty patch, a divisor outside 28-31 and a null annual leave type are refused.
    const split = splitRevision(body, 0)
    if (split.refusal) return split.refusal
    if (split.revision !== state.settings.revision) return conflict('payroll settings changed; reload before saving')
    body = split.rest
    if (!Object.keys(body).length) return invalid('no fields to update')
    if (body.day_divisor !== undefined && !(Number.isInteger(body.day_divisor) && body.day_divisor >= 28 && body.day_divisor <= 31)) return invalid('day_divisor must be a whole number from 28 to 31', 'day_divisor')
    if ('annual_leave_type_id' in body && !(Number.isInteger(body.annual_leave_type_id) && body.annual_leave_type_id > 0)) return invalid('annual_leave_type_id does not reference an existing record', 'annual_leave_type_id')
    if (body.day_divisor !== undefined) state.settings.day_divisor = body.day_divisor
    if (body.annual_leave_type_id !== undefined) state.settings.annual_leave_type = { id: body.annual_leave_type_id, name: 'إجازة' }
    if (body.unpaid_leave_type_ids !== undefined) state.settings.unpaid_leave_types = body.unpaid_leave_type_ids.map(id => ({ id, name: 'إجازة' }))
    state.settings.revision += 1
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
  const eosWrite = /^\/api\/v1\/hr\/payroll\/eos\/(\d+)\/settlement(\/confirm)?$/.exec(route)
  if (eosWrite) {
    const leaver = EOS_LEAVERS[eosWrite[1]]
    if (!leaver) return notFound
    const saved = state.settlements[eosWrite[1]]
    if (eosWrite[2] && method === 'POST') {
      if (!saved) return notFound
      if (leaver.employee.id === OWN_EMPLOYEE_ID) return { status: 403, body: { code: 'transition_forbidden', message: 'you cannot confirm your own settlement', field: 'employee_id', details: { employee_id: leaver.employee.id } } }
      if (saved.state === 'confirmed') return { status: 403, body: { code: 'transition_forbidden', message: 'the settlement is already confirmed' } }
      saved.state = 'confirmed'
      return ok(settlementOf(leaver, saved))
    }
    if (method === 'PUT') {
      if (!EOS_CASES.includes(body.case)) return invalid('case is not an award case', 'case')
      if (typeof body.open_deductions !== 'number' || body.open_deductions < 0) return invalid('open_deductions must be zero or more', 'open_deductions')
      if (saved?.state === 'confirmed') return { status: 403, body: { code: 'transition_forbidden', message: 'a confirmed settlement cannot be changed' } }
      state.settlements[eosWrite[1]] = { state: 'draft', case: body.case, openDeductions: body.open_deductions }
      return ok(settlementOf(leaver, state.settlements[eosWrite[1]]))
    }
  }
  if (method === 'PUT' && route === '/api/v1/hr/payroll/eos-cases') {
    const mapping = state.eosCases.find(item => item.reasonId === body.departure_reason_id)
    if (!mapping) return notFound
    const split = splitRevision(body, 0)
    if (split.refusal) return split.refusal
    if (!EOS_CASES.includes(body.case)) return invalid('case is not an award case', 'case')
    if (split.revision !== mapping.revision) return conflict('the end-of-service case changed; reload before saving')
    mapping.case = body.case
    mapping.revision += 1
    return ok(caseItem(mapping))
  }
  if (method === 'POST' && route === '/api/v1/hr/payroll/eos-provisions') {
    if (!state.finance) return notFound
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(body.month))) return invalid('month must be a YYYY-MM month', 'month')
    if (state.provisions.some(item => item.month === body.month)) return { status: 422, body: { code: 'duplicate', message: 'a provision exists for this month', field: 'month' } }
    const item = { month: body.month, entry_id: 100 + state.provisions.length, entry_name: `JE/${body.month.replace('-', '/')}/EOS`, amount: 1500 }
    state.provisions.push(item)
    return { status: 201, body: item }
  }
  if (method === 'POST' && route === '/api/v1/hr/payroll/gosi-rates') {
    const rate = { id: state.nextRateId++, ...body, shared: false, revision: 1 }
    state.rates.push(rate)
    return { status: 201, body: rate }
  }
  if (method === 'POST' && route === '/api/v1/hr/payroll/bank-profiles') {
    const profile = { id: state.nextProfileId++, ...body, shared: false, revision: 1 }
    state.profiles.push(profile)
    return { status: 201, body: profile }
  }
  const profileMatch = /^\/api\/v1\/hr\/payroll\/bank-profiles\/(\d+)$/.exec(route)
  if (profileMatch) {
    const profile = state.profiles.find(item => item.id === Number(profileMatch[1]))
    if (!profile) return notFound
    if (profile.shared) return { status: 403, body: { code: 'forbidden', message: 'a shared profile is read-only' } }
    const split = splitRevision(body)
    if (split.refusal) return split.refusal
    if (method === 'DELETE' && Object.keys(split.rest).length) return invalid('a delete carries only its revision')
    if (method === 'PATCH') return revised(profile, split.revision, 'the salary file profile changed; reload before saving', () => Object.assign(profile, split.rest))
    if (method === 'DELETE') {
      if (split.revision !== profile.revision) return conflict('the salary file profile changed; reload before deleting')
      state.profiles = state.profiles.filter(item => item !== profile)
      return { status: 204, body: '' }
    }
  }
  const rateMatch = /^\/api\/v1\/hr\/payroll\/gosi-rates\/(\d+)$/.exec(route)
  if (rateMatch) {
    const rate = state.rates.find(item => item.id === Number(rateMatch[1]))
    if (!rate) return notFound
    const split = splitRevision(body)
    if (split.refusal) return split.refusal
    if (method === 'DELETE' && Object.keys(split.rest).length) return invalid('a delete carries only its revision')
    if (method === 'PATCH') return revised(rate, split.revision, 'the GOSI rate changed; reload before saving', () => Object.assign(rate, split.rest))
    if (method === 'DELETE') {
      if (split.revision !== rate.revision) return conflict('the GOSI rate changed; reload before deleting')
      state.rates = state.rates.filter(item => item !== rate)
      return { status: 204, body: '' }
    }
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
  if (method === 'POST' && (section === 'bank-file' || section === 'wps-file')) {
    const answer = fixedRun(run) ?? salaryFile(run, section)
    return answer.refusal ?? answer
  }
  if (method === 'POST' && section === 'compute') {
    if (!actionsOf(run).includes('compute')) return { status: 403, body: { code: 'transition_forbidden', message: 'the run cannot be computed' } }
    run.slips = PEOPLE.map((person, index) => run.slips[index] ?? { id: run.id * 10 + index + 1, person, state: 'draft', inputs: noInputs() })
    run.state = 'computed'
    return ok(detail(run))
  }
  if (method === 'POST' && section === 'approve') {
    if (!actionsOf(run).includes('approve')) return { status: 403, body: { code: 'transition_forbidden', message: 'the run cannot be approved' } }
    // Like the server (owner decision D-10): a net to pay without an IBAN blocks the approval; a zero net does not.
    const unpaid = run.slips.filter(unpaidIban)
    if (unpaid.length) return missingIban(unpaid, 'record the IBAN of every employee with a net to pay before approving the run')
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
    if (!actionsOf(run).includes('edit_inputs')) return { status: 403, body: { code: 'transition_forbidden', message: 'the inputs are locked', details: { reason: 'not_editable' } } }
    const keys = Object.keys(body)
    const bad = keys.find(key => !INPUT_KEYS.includes(key) || typeof body[key] !== 'number' || body[key] < 0)
    if (!keys.length || bad) return invalid('inputs must be numbers, zero or more', bad)
    Object.assign(slip.inputs, body)
    return ok(row(slip))
  }
  return undefined
}
