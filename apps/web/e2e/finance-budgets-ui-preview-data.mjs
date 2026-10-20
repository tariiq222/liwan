// Finance budgets for the isolated mock (MODULE_UI_PREVIEW=1): budgets in every state with their lines (accounts of the
// accounting mock's chart) and the budget-versus-actual comparison of each. Reads only: the mock has no finance write
// routes. The list honours the filters the Odoo controller supports (q, state, limit, offset), and `total` is the
// filtered count, so the KPI strip's limit=1 requests report real totals. Variance is budget less actual; debit lines
// (expenses) are favorable at or under the budget, credit lines (income) at or over it, as the server computes them.
import { financeAccounts } from './finance-accounting-ui-preview-data.mjs'

const CURRENCY = 'SAR'
const NATURE_OF = { income: 'credit', income_other: 'credit' }
const analytics = { 1: { id: 1, name: 'المقر الرئيسي' }, 2: { id: 2, name: 'فرع جدة' } }

const accountRef = id => {
  const { name } = financeAccounts.find(item => item.id === id)
  return { id, name }
}
const natureOf = id => NATURE_OF[financeAccounts.find(item => item.id === id).account_type] ?? 'debit'

// A line is [account id, label, amount, actual, analytic id or null]; its period is the budget's.
function budget(id, name, description, state, date_from, date_to, lines) {
  return {
    id,
    name,
    description,
    state,
    date_from,
    date_to,
    currency: CURRENCY,
    lines: lines.map(([account, label, amount, actual, analytic], index) => ({
      id: id * 100 + index + 1,
      account: accountRef(account),
      nature: natureOf(account),
      analytic_account: analytic ? analytics[analytic] : null,
      label,
      date_from,
      date_to,
      amount,
      actual,
    })),
  }
}

const sources = [
  budget(1, 'ميزانية 2026 التشغيلية', 'الميزانية السنوية للمصروفات والإيرادات.', 'confirmed', '2026-01-01', '2026-12-31', [
    [21, 'رواتب الموظفين', 540000, 495000, 1],
    [22, 'إيجار المقر', 144000, 144000, 1],
    [23, 'الكهرباء والاتصالات', 36000, 41200, null],
    [24, 'الحملات التسويقية', 90000, 67500, null],
    [17, 'مبيعات المنتجات', 1800000, 1650000, null],
    [18, 'إيرادات الخدمات', 600000, 702000, 2],
  ]),
  budget(2, 'ميزانية الربع الرابع 2026', 'خطة الربع الأخير.', 'confirmed', '2026-10-01', '2026-12-31', [
    [21, 'رواتب أكتوبر إلى ديسمبر', 135000, 45000, null],
    [22, 'إيجار الربع', 36000, 12000, null],
    [25, 'رسوم حكومية', 8000, 9500, null],
    [26, 'إهلاك الأجهزة', 7200, 2400, null],
    [18, 'إيرادات الخدمات', 210000, 96000, null],
  ]),
  budget(3, 'ميزانية فرع جدة 2027', 'مسودة قيد المراجعة.', 'draft', '2027-01-01', '2027-12-31', [
    [21, 'رواتب فريق الفرع', 300000, 0, 2],
    [22, 'إيجار الفرع', 96000, 0, 2],
    [23, 'الكهرباء والاتصالات', 24000, 0, 2],
    [24, 'تسويق الافتتاح', 50000, 0, 2],
    [17, 'مبيعات الفرع', 900000, 0, 2],
  ]),
  budget(4, 'ميزانية التسويق 2027', '', 'draft', '2027-01-01', '2027-06-30', [
    [24, 'إعلانات رقمية', 120000, 0, null],
    [24, 'فعاليات ومعارض', 60000, 0, null],
    [27, 'مصروفات أخرى', 15000, 0, null],
    [19, 'عوائد الشراكات', 40000, 0, null],
  ]),
  budget(5, 'ميزانية مشروع التوسع', 'أُلغيت بعد تغيير الخطة.', 'cancelled', '2026-03-01', '2026-08-31', [
    [20, 'تكلفة الخدمات المباعة', 180000, 120000, null],
    [21, 'رواتب فريق المشروع', 220000, 150000, 1],
    [22, 'إيجار موقع إضافي', 60000, 60000, null],
    [18, 'إيرادات الخدمات', 300000, 180000, null],
  ]),
  budget(6, 'ميزانية 2025', 'السنة المالية السابقة.', 'confirmed', '2025-01-01', '2025-12-31', [
    [21, 'الرواتب والأجور', 480000, 471000, null],
    [22, 'الإيجارات', 132000, 132000, null],
    [23, 'الكهرباء والاتصالات', 30000, 28100, null],
    [25, 'الرسوم الحكومية', 14000, 15400, null],
    [26, 'مصروف الإهلاك', 28800, 28800, null],
    [27, 'مصروفات أخرى', 12000, 9800, null],
    [17, 'إيرادات المبيعات', 1500000, 1580000, null],
    [18, 'إيرادات الخدمات', 450000, 421000, null],
  ]),
]

const lineOf = ({ actual: _actual, ...rest }) => rest
const detail = source => ({ ...summary(source), lines: source.lines.map(lineOf) })
function summary({ lines, ...rest }) {
  return { ...rest, line_count: lines.length, cost_center_split: false }
}

const round = value => Math.round(value * 100) / 100
const percent = (variance, budgeted) => (budgeted === 0 ? null : round((variance / budgeted) * 100))
const figures = (budgeted, actual) => ({ budget: budgeted, actual, variance: round(budgeted - actual), variance_percent: percent(budgeted - actual, budgeted) })

function side(lines, nature) {
  const rows = lines.filter(item => item.nature === nature)
  const sum = pick => rows.reduce((total, item) => total + pick(item), 0)
  return figures(sum(item => item.amount), sum(item => item.actual))
}

function budgetVsActual(source, dateTo) {
  const lines = source.lines.map(item => {
    const variance = figures(item.amount, item.actual)
    const favorable = item.nature === 'debit' ? item.actual <= item.amount : item.actual >= item.amount
    return {
      id: item.id,
      account: item.account,
      nature: item.nature,
      analytic_account: item.analytic_account,
      label: item.label,
      date_from: item.date_from,
      date_to: item.date_to,
      ...variance,
      favorable,
    }
  })
  const debit = side(source.lines, 'debit')
  const credit = side(source.lines, 'credit')
  return {
    budget: { id: source.id, name: source.name, state: source.state },
    date_from: source.date_from,
    date_to: dateTo ?? source.date_to,
    currency: CURRENCY,
    target_move: 'posted',
    lines,
    totals: { debit, credit, net: { budget: round(credit.budget - debit.budget), actual: round(credit.actual - debit.actual) } },
  }
}

const matches = (text, q) => !q || String(text ?? '').toLocaleLowerCase().includes(q.trim().toLocaleLowerCase())

function page(rows, url) {
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Number(url.searchParams.get('limit') ?? 50)
  const size = Number.isFinite(limit) && limit > 0 ? limit : 50
  return { items: rows.slice(offset, offset + size), total: rows.length }
}

function filterBudgets(url) {
  const { searchParams } = url
  return sources.filter(item => (!searchParams.get('state') || item.state === searchParams.get('state')) && matches(item.name, searchParams.get('q')))
}

export function financeBudgetsPreviewData(path, url) {
  const route = String(path || '/').replace(/\/+$/, '') || '/'
  if (route === '/api/v1/finance/budgets') return page(filterBudgets(url).map(summary), url)
  if (route === '/api/v1/finance/reports/budget-vs-actual') {
    const source = sources.find(item => item.id === Number(url.searchParams.get('budget_id')))
    return source ? budgetVsActual(source, url.searchParams.get('date_to')) : undefined
  }
  const match = /^\/api\/v1\/finance\/budgets\/(\d+)$/.exec(route)
  const found = match && sources.find(item => item.id === Number(match[1]))
  return found ? detail(found) : undefined
}
