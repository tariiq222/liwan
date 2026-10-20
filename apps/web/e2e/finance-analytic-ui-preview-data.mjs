// Finance analytic (plans, cost centers and the cost center report) for the isolated mock (MODULE_UI_PREVIEW=1). Reads only:
// the mock has no finance write routes. Lists honour the filters the Odoo controllers support (accounts: q, plan_id, archived,
// limit, offset; report: date_from, date_to, plan_id; lines: account_id, date_from, date_to, limit, offset) and `total` is
// the filtered count. The report is computed from the same items the lines endpoint lists, so both always agree.
const CURRENCY = 'SAR'

export const financeAnalyticPlans = [
  { id: 1, name: 'المشاريع', parent: null },
  { id: 2, name: 'الفروع', parent: null },
  { id: 3, name: 'الأقسام', parent: null },
]

const planRef = id => {
  const { name } = financeAnalyticPlans.find(plan => plan.id === id)
  return { id, name }
}

// [id, code, name, plan id, active]
export const financeAnalyticAccounts = [
  [1, 'PRJ-001', 'مشروع برج الرياض', 1, true],
  [2, 'PRJ-002', 'مشروع واجهة جدة', 1, true],
  [3, 'PRJ-003', 'مشروع المنطقة اللوجستية', 1, true],
  [4, 'PRJ-004', 'مشروع الشرقية القديم', 1, false],
  [5, 'BR-RUH', 'فرع الرياض', 2, true],
  [6, 'BR-JED', 'فرع جدة', 2, true],
  [7, 'BR-DMM', 'فرع الدمام', 2, true],
  [8, 'BR-MED', 'فرع المدينة (مغلق)', 2, false],
  [9, 'DEP-FIN', 'قسم المالية', 3, true],
  [10, 'DEP-HR', 'قسم الموارد البشرية', 3, true],
  [11, 'DEP-OPS', 'قسم العمليات', 3, true],
  [12, '', 'مركز بلا رمز', 3, true],
].map(([id, code, name, plan, active]) => ({ id, name, code, plan: planRef(plan), active }))

const GENERAL = {
  sales: { id: 17, name: 'إيرادات المبيعات' },
  services: { id: 18, name: 'إيرادات الخدمات' },
  payroll: { id: 21, name: 'الرواتب والأجور' },
  rent: { id: 22, name: 'الإيجارات' },
  marketing: { id: 24, name: 'مصروفات التسويق' },
  utilities: { id: 23, name: 'الكهرباء والاتصالات' },
}
const ACME = { id: 1, name: 'شركة الأفق للتجارة' }
const SUPPLY = { id: 3, name: 'مورّد المكاتب المتحدة' }

// [account id, date, name, ref, move, general account, partner, amount]: income is positive, expense negative.
const items = [
  [1, '2026-10-12', 'دفعة العميل الأولى', 'INV/2026/0042', { id: 42, name: 'INV/2026/0042' }, GENERAL.services, ACME, 90000],
  [1, '2026-10-05', 'مقاولو الباطن', 'BILL/2026/0031', { id: 31, name: 'BILL/2026/0031' }, GENERAL.payroll, SUPPLY, -35000],
  [1, '2026-09-18', 'معدات الموقع', 'BILL/2026/0027', { id: 27, name: 'BILL/2026/0027' }, GENERAL.rent, SUPPLY, -12000],
  [2, '2026-10-09', 'دفعة المرحلة الثانية', 'INV/2026/0040', { id: 40, name: 'INV/2026/0040' }, GENERAL.services, ACME, 65000],
  [2, '2026-10-03', 'تصاميم خارجية', 'BILL/2026/0030', { id: 30, name: 'BILL/2026/0030' }, GENERAL.marketing, SUPPLY, -18000],
  [3, '2026-10-14', 'إيرادات التشغيل', 'INV/2026/0044', { id: 44, name: 'INV/2026/0044' }, GENERAL.sales, ACME, 48000],
  [3, '2026-09-25', 'نقل وتخزين', 'BILL/2026/0025', { id: 25, name: 'BILL/2026/0025' }, GENERAL.utilities, SUPPLY, -9000],
  [4, '2026-09-02', 'تسوية إغلاق المشروع', '', null, GENERAL.services, null, 15000],
  [5, '2026-10-16', 'مبيعات الفرع', 'INV/2026/0046', { id: 46, name: 'INV/2026/0046' }, GENERAL.sales, ACME, 120000],
  [5, '2026-10-01', 'رواتب الفرع', 'MISC/2026/0002', { id: 2, name: 'MISC/2026/0002' }, GENERAL.payroll, null, -45000],
  [5, '2026-09-20', 'إيجار الفرع', 'BILL/2026/0022', { id: 22, name: 'BILL/2026/0022' }, GENERAL.rent, SUPPLY, -22000],
  [6, '2026-10-15', 'مبيعات الفرع', 'INV/2026/0045', { id: 45, name: 'INV/2026/0045' }, GENERAL.sales, ACME, 87000],
  [6, '2026-10-01', 'رواتب الفرع', 'MISC/2026/0002', { id: 2, name: 'MISC/2026/0002' }, GENERAL.payroll, null, -38000],
  [7, '2026-10-10', 'مبيعات الفرع', 'INV/2026/0041', { id: 41, name: 'INV/2026/0041' }, GENERAL.sales, ACME, 54000],
  [7, '2026-10-04', 'كهرباء واتصالات', 'BILL/2026/0032', { id: 32, name: 'BILL/2026/0032' }, GENERAL.utilities, SUPPLY, -4200],
  [9, '2026-10-01', 'رواتب القسم', 'MISC/2026/0002', { id: 2, name: 'MISC/2026/0002' }, GENERAL.payroll, null, -28000],
  [10, '2026-10-01', 'رواتب القسم', 'MISC/2026/0002', { id: 2, name: 'MISC/2026/0002' }, GENERAL.payroll, null, -21000],
  [10, '2026-09-22', 'حملة توظيف', 'BILL/2026/0023', { id: 23, name: 'BILL/2026/0023' }, GENERAL.marketing, SUPPLY, -6500],
  [11, '2026-10-11', 'عمليات مُعاد فوترتها', 'INV/2026/0043', { id: 43, name: 'INV/2026/0043' }, GENERAL.services, ACME, 12000],
  [11, '2026-10-02', 'مصروفات تشغيل', 'BILL/2026/0033', { id: 33, name: 'BILL/2026/0033' }, GENERAL.utilities, SUPPLY, -7300],
].map(([account, date, name, ref, move, general, partner, amount], index) => ({
  account, id: index + 1, date, name, ref, move, general_account: general, partner, kind: amount > 0 ? 'income' : 'expense', amount,
}))

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

function filterAccounts(url) {
  const { searchParams } = url
  const plan = Number(searchParams.get('plan_id') ?? 0)
  const archived = searchParams.get('archived') === 'true'
  return financeAnalyticAccounts.filter(item => item.active === !archived
    && (!plan || item.plan.id === plan)
    && (matches(item.name, searchParams.get('q')) || matches(item.code, searchParams.get('q'))))
}

const sumKind = (rows, kind) => rows.filter(item => item.kind === kind).reduce((total, item) => total + Math.abs(item.amount), 0)

function report(url) {
  const plan = Number(url.searchParams.get('plan_id') ?? 0)
  const rows = financeAnalyticAccounts
    .filter(account => !plan || account.plan.id === plan)
    .map(({ active: _active, ...account }) => ({ account, own: items.filter(item => item.account === account.id && inPeriod(item.date, url)) }))
    .filter(({ account, own }) => own.length > 0 || financeAnalyticAccounts.find(item => item.id === account.id).active)
    .map(({ account, own }) => {
      const income = sumKind(own, 'income')
      const expense = sumKind(own, 'expense')
      return { account: { id: account.id, name: account.name, code: account.code }, plan: account.plan, income, expense, net: income - expense }
    })
  const income = rows.reduce((total, row) => total + row.income, 0)
  const expense = rows.reduce((total, row) => total + row.expense, 0)
  return {
    date_from: url.searchParams.get('date_from') ?? '2026-10-01',
    date_to: url.searchParams.get('date_to') ?? '2026-10-31',
    currency: CURRENCY,
    plan: plan ? planRef(plan) : null,
    accounts: rows,
    totals: { income, expense, net: income - expense },
  }
}

function lines(url) {
  const account = Number(url.searchParams.get('account_id') ?? 0)
  const rows = items
    .filter(item => item.account === account && inPeriod(item.date, url))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .map(({ account: _account, ...rest }) => rest)
  return page(rows, url)
}

const recordId = (route, base) => {
  const rest = route.slice(base.length + 1)
  return /^\d+$/.test(rest) ? Number(rest) : NaN
}

export function financeAnalyticPreviewData(path, url) {
  const route = String(path || '/').replace(/\/+$/, '') || '/'
  if (route === '/api/v1/finance/analytic-plans') return page(financeAnalyticPlans.filter(plan => matches(plan.name, url.searchParams.get('q'))), url)
  if (route.startsWith('/api/v1/finance/analytic-plans/')) return financeAnalyticPlans.find(plan => plan.id === recordId(route, '/api/v1/finance/analytic-plans'))
  if (route === '/api/v1/finance/analytic-accounts') return page(filterAccounts(url), url)
  if (route.startsWith('/api/v1/finance/analytic-accounts/')) return financeAnalyticAccounts.find(item => item.id === recordId(route, '/api/v1/finance/analytic-accounts'))
  if (route === '/api/v1/finance/reports/analytic') return report(url)
  if (route === '/api/v1/finance/reports/analytic/lines') return lines(url)
  return undefined
}
