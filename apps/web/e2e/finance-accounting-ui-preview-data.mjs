// Finance accounting for the isolated mock (MODULE_UI_PREVIEW=1): manual journal entries in every state and a Saudi-style
// chart of accounts (journals come from finance-documents-ui-preview-data.mjs). Reads only: the mock has no finance
// write routes. Lists honour the filters the Odoo controllers support (entries: q, state, journal_id, date_from,
// date_to, limit, offset; accounts: q, account_type, limit, offset), and `total` is the filtered count, so the KPI
// strip's limit=1 requests report real totals.
const CURRENCY = 'SAR'
const MISC = { id: 5, name: 'العمليات المتنوعة' }
const ACME = { id: 1, name: 'شركة الأفق للتجارة' }
const SUPPLY = { id: 3, name: 'مورّد المكاتب المتحدة' }

export const financeAccounts = [
  [1, '110101', 'الصندوق', 'asset_cash', false],
  [2, '110201', 'البنك الأهلي', 'asset_cash', true],
  [3, '110301', 'العملاء', 'asset_receivable', true],
  [4, '110401', 'مصروفات مدفوعة مقدمًا', 'asset_prepayments', false],
  [5, '110501', 'ضريبة القيمة المضافة - مدخلات', 'asset_current', false],
  [6, '120101', 'الأثاث والتجهيزات', 'asset_fixed', false],
  [7, '120201', 'الأجهزة والمعدات', 'asset_fixed', false],
  [8, '130101', 'تأمينات مدفوعة', 'asset_non_current', false],
  [9, '210101', 'الموردون', 'liability_payable', true],
  [10, '210201', 'ضريبة القيمة المضافة - مخرجات', 'liability_current', false],
  [11, '210301', 'رواتب مستحقة', 'liability_current', false],
  [12, '210401', 'بطاقة ائتمان الشركة', 'liability_credit_card', true],
  [13, '220101', 'قرض طويل الأجل', 'liability_non_current', false],
  [14, '220201', 'مكافأة نهاية الخدمة', 'liability_non_current', false],
  [15, '310101', 'رأس المال', 'equity', false],
  [16, '320101', 'الأرباح المبقاة', 'equity_unaffected', false],
  [17, '410101', 'إيرادات المبيعات', 'income', false],
  [18, '410201', 'إيرادات الخدمات', 'income', false],
  [19, '420101', 'إيرادات أخرى', 'income_other', false],
  [20, '510101', 'تكلفة الخدمات المباعة', 'expense_direct_cost', false],
  [21, '520101', 'الرواتب والأجور', 'expense', false],
  [22, '520201', 'الإيجارات', 'expense', false],
  [23, '520301', 'الكهرباء والاتصالات', 'expense', false],
  [24, '520401', 'مصروفات التسويق', 'expense', false],
  [25, '520501', 'الرسوم الحكومية', 'expense', false],
  [26, '530101', 'مصروف الإهلاك', 'expense_depreciation', false],
  [27, '540101', 'مصروفات أخرى', 'expense_other', false],
  [28, '990101', 'حساب نظامي', 'off_balance', false],
].map(([id, code, name, account_type, reconcile]) => ({ id, code, name, account_type, reconcile, currency: id === 2 ? CURRENCY : null, active: true }))

const accountRef = id => {
  const { name } = financeAccounts.find(item => item.id === id)
  return { id, name }
}

// A line is [account id, partner or null, label, debit, credit].
const line = (id, [account, partner, name, debit, credit]) => ({ id, account: accountRef(account), partner, name, debit, credit, analytic_distribution: [] })

function entry(id, state, date, ref, lines, name = undefined) {
  return {
    id,
    name: name !== undefined ? name : state === 'draft' ? null : `MISC/2026/${String(id).padStart(4, '0')}`,
    state,
    date,
    ref,
    journal: MISC,
    currency: CURRENCY,
    amount_total: lines.reduce((sum, item) => sum + item[3], 0),
    lines: lines.map((item, index) => line(id * 10 + index + 1, item)),
  }
}

export const financeEntries = [
  entry(1, 'draft', '2026-10-05', 'تسوية الإيجار', [[22, null, 'إيجار أكتوبر', 12000, 0], [2, null, 'سداد من البنك', 0, 12000]]),
  entry(2, 'posted', '2026-10-01', 'رواتب سبتمبر', [[21, null, 'رواتب الموظفين', 45000, 0], [11, null, 'رواتب مستحقة', 0, 45000]]),
  entry(3, 'posted', '2026-09-30', 'إهلاك الربع الثالث', [[26, null, 'إهلاك الأجهزة', 2400, 0], [7, null, 'مجمع الإهلاك', 0, 2400]]),
  entry(4, 'draft', '2026-10-08', 'مصروفات تسويق', [[24, SUPPLY, 'حملة إعلانية', 6500, 0], [5, null, 'ضريبة مدخلات', 975, 0], [9, SUPPLY, 'مستحق للمورد', 0, 7475]]),
  entry(5, 'posted', '2026-09-15', 'رأس المال الإضافي', [[2, null, 'إيداع الشريك', 100000, 0], [15, null, 'زيادة رأس المال', 0, 100000]]),
  entry(6, 'posted', '2026-09-10', 'قرض البنك', [[2, null, 'صرف القرض', 250000, 0], [13, null, 'قرض طويل الأجل', 0, 250000]]),
  entry(7, 'cancel', '2026-09-05', 'قيد مكرر', [[27, null, 'مصروف مكرر', 800, 0], [1, null, 'من الصندوق', 0, 800]]),
  entry(8, 'posted', '2026-08-31', 'إيراد مستحق', [[3, ACME, 'مبيعات غير مفوترة', 18000, 0], [18, null, 'إيرادات الخدمات', 0, 18000]]),
  entry(9, 'draft', '2026-10-12', 'تأمين طبي', [[4, null, 'تأمين مدفوع مقدمًا', 9000, 0], [2, null, 'سداد من البنك', 0, 9000]]),
  entry(10, 'posted', '2026-08-15', 'تأمين مسترد', [[1, null, 'استرداد نقدي', 1500, 0], [8, null, 'تأمينات مدفوعة', 0, 1500]]),
  entry(11, 'cancel', '2026-07-20', 'قيد خاطئ', [[23, null, 'كهرباء', 1200, 0], [12, null, 'بطاقة الشركة', 0, 1200]]),
  entry(12, 'posted', '2026-07-01', 'مكافأة نهاية الخدمة', [[21, null, 'مخصص المكافأة', 7000, 0], [14, null, 'مكافأة نهاية الخدمة', 0, 7000]]),
]

const matches = (text, q) => !q || String(text ?? '').toLocaleLowerCase().includes(q.trim().toLocaleLowerCase())

function page(rows, url) {
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Number(url.searchParams.get('limit') ?? 50)
  const size = Number.isFinite(limit) && limit > 0 ? limit : 50
  return { items: rows.slice(offset, offset + size), total: rows.length }
}

function inPeriod(day, url) {
  const from = url.searchParams.get('date_from')
  const to = url.searchParams.get('date_to')
  return (!from || day >= from) && (!to || day <= to)
}

function filterEntries(url) {
  const { searchParams } = url
  const journal = Number(searchParams.get('journal_id') ?? 0)
  return financeEntries.filter(item => (!searchParams.get('state') || item.state === searchParams.get('state'))
    && (!journal || item.journal.id === journal)
    && inPeriod(item.date, url)
    && (matches(item.name, searchParams.get('q')) || matches(item.ref, searchParams.get('q'))))
}

function filterAccounts(url) {
  const { searchParams } = url
  return financeAccounts.filter(item => (!searchParams.get('account_type') || item.account_type === searchParams.get('account_type'))
    && (matches(item.code, searchParams.get('q')) || matches(item.name, searchParams.get('q'))))
}

const summary = ({ lines: _lines, ...rest }) => rest

const recordId = (route, base) => {
  const rest = route.slice(base.length + 1)
  return /^\d+$/.test(rest) ? Number(rest) : NaN
}

export function financeAccountingPreviewData(path, url) {
  const route = String(path || '/').replace(/\/+$/, '') || '/'
  if (route === '/api/v1/finance/entries') return page(filterEntries(url).map(summary), url)
  if (route.startsWith('/api/v1/finance/entries/')) return financeEntries.find(item => item.id === recordId(route, '/api/v1/finance/entries'))
  if (route === '/api/v1/finance/accounts') return page(filterAccounts(url), url)
  return undefined
}
