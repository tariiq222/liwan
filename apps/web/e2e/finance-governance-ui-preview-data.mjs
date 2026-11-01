// Finance governance for the isolated mock (MODULE_UI_PREVIEW=1): fiscal years with closing previews, the ZATCA
// readiness and backlog, and the finance audit log. Reads only: the mock has no finance write routes. The audit list
// honours action, date_from, date_to, limit and offset, and `total` is the filtered count.
const account = (id, code, name) => ({ id, code, name })
const INCOME = [account(17, '410101', 'إيرادات المبيعات'), account(18, '410201', 'إيرادات الخدمات')]
const EXPENSE = [account(21, '520101', 'الرواتب والأجور'), account(22, '520201', 'الإيجارات'), account(23, '520301', 'الكهرباء والاتصالات')]
const RETAINED = account(16, '320101', 'الأرباح المبقاة')
const MISC = { id: 5, name: 'العمليات المتنوعة' }

export const fiscalYears = [
  { year: 2024, date_from: '2024-01-01', date_to: '2024-12-31', state: 'closed', result: 205000, closing_entry: { id: 1, name: 'MISC/2024/0001' } },
  { year: 2025, date_from: '2025-01-01', date_to: '2025-12-31', state: 'open', result: 312000, closing_entry: null },
  { year: 2026, date_from: '2026-01-01', date_to: '2026-12-31', state: 'open', result: 148500, closing_entry: null },
]

// Income balances are reversed with a debit, expenses with a credit, and the net lands on retained earnings.
function previewOf(year, income, expense, blockers) {
  const lines = [
    ...income.map(([item, amount]) => ({ account: item, debit: amount, credit: 0 })),
    ...expense.map(([item, amount]) => ({ account: item, debit: 0, credit: amount })),
  ]
  const net = income.reduce((sum, [, amount]) => sum + amount, 0) - expense.reduce((sum, [, amount]) => sum + amount, 0)
  lines.push({ account: RETAINED, debit: 0, credit: net })
  const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0)
  const found = fiscalYears.find(item => item.year === year)
  return {
    year,
    date_from: found.date_from,
    date_to: found.date_to,
    journal: MISC,
    retained_earnings_account: RETAINED,
    lines,
    total_debit: totalDebit,
    total_credit: totalDebit,
    result: net,
    blockers,
  }
}

const previews = {
  2025: previewOf(2025, [[INCOME[0], 480000], [INCOME[1], 120000]], [[EXPENSE[0], 210000], [EXPENSE[1], 60000], [EXPENSE[2], 18000]], []),
  2026: previewOf(2026, [[INCOME[0], 310000], [INCOME[1], 55000]], [[EXPENSE[0], 175000], [EXPENSE[1], 30000], [EXPENSE[2], 11500]], [
    { code: 'year_not_ended', message: 'fiscal year 2026 has not ended yet', details: {} },
  ]),
}

const zatcaStatus = {
  api_mode: 'sandbox',
  private_key_present: true,
  onboarded: false,
  journals: [
    { journal: { id: 21, name: 'مبيعات الرياض' }, onboarded: true, state: 'onboarded' },
    { journal: { id: 22, name: 'مبيعات جدة' }, onboarded: false, state: 'not_started' },
    { journal: { id: 23, name: 'مبيعات الدمام' }, onboarded: false, state: 'compliance_checked' },
  ],
  backlog: { to_send: 4, retry: 2, rejected: 1, blocked: 0 },
}

// The e-invoices ZATCA has not accepted, oldest first, one per waiting state; the backlog counts above are the page's headline numbers.
const waitingStates = [['pending', null], ['retry', 'reporting'], ['rejected', 'clearance'], ['blocked', null]]
const waiting = waitingStates.map(([state, mode], index) => ({
  invoice: { id: 300 + index, name: `INV/2026/${String(index + 1).padStart(4, '0')}` },
  partner: { id: 1 + (index % 2), name: index % 2 ? 'مؤسسة الأفق للتوريدات' : 'شركة النخبة للتجارة' },
  date: `2026-09-${String(10 + index).padStart(2, '0')}`,
  amount_total: 1150 * (index + 1),
  move_type: 'out_invoice',
  submission: {
    state,
    mode,
    errors: state === 'rejected' ? [{ code: 'BR-KSA-17', message: 'the buyer name is missing' }] : [],
    warnings: state === 'retry' ? [{ code: 'W-01', message: 'ZATCA did not answer; it is retried' }] : [],
    qr_present: false,
  },
}))
function waitingDocuments(url) {
  const state = url.searchParams.get('state')
  return state ? waiting.filter(row => row.submission.state === state) : waiting
}

const ACTORS = [{ id: 2, name: 'سارة القحطاني' }, { id: 3, name: 'خالد العتيبي' }, { id: 4, name: 'نورة الشمري' }]
const AUDIT_KINDS = [
  ['payment_posted', 'account.payment', 14, [], null],
  ['company_written', 'res.company', 1, ['vat', 'company_registry', 'street'], null],
  ['fiscal_year_closed', 'account.move', 1, [], '2024:closed'],
  ['zatca_onboarded', 'account.journal', 21, [], null],
  ['zatca_submitted', 'account.move', 6, [], 'rejected'],
  ['company_written', 'res.company', 1, ['fiscalyear_lock_date'], null],
]

// 30 rows, newest first, one every ~40 hours: every action appears several times.
export const auditEvents = Array.from({ length: 30 }, (_, index) => {
  const [action, res_model, res_id, fields_written, outcome] = AUDIT_KINDS[index % AUDIT_KINDS.length]
  const created = new Date(Date.UTC(2026, 9, 19, 9, 30) - index * 40 * 3600 * 1000)
  return {
    id: 100 - index,
    action,
    actor: ACTORS[index % ACTORS.length],
    created_at: created.toISOString().replace('.000Z', 'Z'),
    res_model,
    res_id: res_id + (action === 'zatca_submitted' ? index : 0),
    fields_written,
    outcome,
  }
})

function filterAudit(url) {
  const { searchParams } = url
  const action = searchParams.get('action')
  const from = searchParams.get('date_from')
  const to = searchParams.get('date_to')
  return auditEvents.filter(item => (!action || item.action === action)
    && (!from || item.created_at.slice(0, 10) >= from)
    && (!to || item.created_at.slice(0, 10) <= to))
}

function page(rows, url) {
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Number(url.searchParams.get('limit') ?? 50)
  const size = Number.isFinite(limit) && limit > 0 ? limit : 50
  return { items: rows.slice(offset, offset + size), total: rows.length }
}

export function financeGovernancePreviewData(path, url) {
  const route = String(path || '/').replace(/\/+$/, '') || '/'
  if (route === '/api/v1/finance/fiscal-years') return { items: fiscalYears, total: fiscalYears.length }
  const preview = route.match(/^\/api\/v1\/finance\/fiscal-years\/(\d+)\/closing-preview$/)
  if (preview) return previews[Number(preview[1])]
  if (route === '/api/v1/finance/zatca/status') return zatcaStatus
  if (route === '/api/v1/finance/zatca/documents') return page(waitingDocuments(url), url)
  if (route === '/api/v1/finance/audit-events') return page(filterAudit(url), url)
  return undefined
}
