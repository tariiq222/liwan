// Finance reports for the isolated mock (MODULE_UI_PREVIEW=1). Reads only; each answer echoes the requested period and options.
const CURRENCY = 'SAR'
const DEFAULT_DAY = new Date().toISOString().slice(0, 10)
const LEDGER_PAGE_SIZE = 50

const accounts = [
  { id: 1, code: '110101', name: 'البنك الرئيسي' },
  { id: 2, code: '120101', name: 'العملاء' },
  { id: 3, code: '210101', name: 'الموردون' },
  { id: 4, code: '410101', name: 'إيرادات المبيعات' },
  { id: 5, code: '510101', name: 'تكلفة المبيعات' },
]
const partners = [{ id: 1, name: 'شركة الأفق للتجارة' }, { id: 2, name: 'مؤسسة النخبة' }]

const trialRows = [
  { account: accounts[0], initial_balance: 50000, debit: 40000, credit: 25000, balance: 15000, ending_balance: 65000 },
  { account: accounts[1], initial_balance: 12000, debit: 30000, credit: 28000, balance: 2000, ending_balance: 14000 },
  { account: accounts[2], initial_balance: -3000, debit: 5000, credit: 5450, balance: -450, ending_balance: -3450 },
  { account: accounts[3], initial_balance: -40000, debit: 0, credit: 30000, balance: -30000, ending_balance: -70000 },
  { account: accounts[4], initial_balance: 0, debit: 13450, credit: 0, balance: 13450, ending_balance: 13450 },
]
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0)

function trialBalance(url) {
  const period = periodOf(url)
  return {
    ...period,
    target_move: url.searchParams.get('target_move') ?? 'posted',
    currency: CURRENCY,
    accounts: trialRows,
    totals: Object.fromEntries(['initial_balance', 'debit', 'credit', 'balance', 'ending_balance'].map(key => [key, sum(trialRows, key)])),
  }
}

const ledgerLines = Array.from({ length: 120 }, (_, index) => ({
  id: index + 1,
  date: `2026-10-${String((index % 28) + 1).padStart(2, '0')}`,
  entry: `BNK1/2026/${String(index + 1).padStart(5, '0')}`,
  journal: 'BNK1',
  partner: index % 3 === 0 ? null : partners[index % 2],
  label: `سداد دفعة رقم ${index + 1}`,
  debit: index % 2 === 0 ? 100 + index : 0,
  credit: index % 2 === 0 ? 0 : 50 + index,
  balance: 50000 + index * 10,
}))

function generalLedger(url) {
  const accountId = Number(url.searchParams.get('account_id') ?? 0)
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Number(url.searchParams.get('limit') ?? LEDGER_PAGE_SIZE) || LEDGER_PAGE_SIZE
  return {
    ...periodOf(url),
    target_move: url.searchParams.get('target_move') ?? 'posted',
    currency: CURRENCY,
    accounts: trialRows.map(row => ({
      account: row.account,
      initial_balance: row.initial_balance,
      debit: row.debit,
      credit: row.credit,
      ending_balance: row.ending_balance,
      lines: { items: row.account.id === accountId ? ledgerLines.slice(offset, offset + limit) : [], total: ledgerLines.length },
    })),
  }
}

function periodOf(url) {
  return {
    date_from: url.searchParams.get('date_from') ?? `${DEFAULT_DAY.slice(0, 8)}01`,
    date_to: url.searchParams.get('date_to') ?? DEFAULT_DAY,
  }
}

const statementLines = [
  { date: '2026-10-02', date_due: '2026-10-30', entry: 'INV/2026/00007', ref: 'PO-1182', label: 'فاتورة مبيعات', debit: 5750, credit: 0, open_amount: 5750, balance: 5750 },
  { date: '2026-10-09', date_due: '2026-10-09', entry: 'BNK1/2026/00031', ref: '', label: 'دفعة من العميل', debit: 0, credit: 2000, open_amount: -2000, balance: 3750 },
  { date: '2026-10-15', date_due: '2026-11-14', entry: 'INV/2026/00011', ref: '', label: 'فاتورة مبيعات', debit: 3000, credit: 0, open_amount: 3000, balance: 6750 },
]

function partnerStatement(url) {
  const type = url.searchParams.get('type') ?? 'activity'
  const activity = type === 'activity'
  const partner = partners.find(item => item.id === Number(url.searchParams.get('partner_id'))) ?? partners[0]
  return {
    type,
    kind: url.searchParams.get('kind') ?? 'receivable',
    partner,
    date_from: activity ? periodOf(url).date_from : null,
    date_to: periodOf(url).date_to,
    currencies: [{
      currency: CURRENCY,
      balance_forward: activity ? 1000 : 0,
      amount_due: 6750,
      ending_balance: activity ? 7750 : 6750,
      lines: activity ? statementLines : statementLines.map(line => ({ ...line, balance: null })),
      buckets: activity ? null : { current: 3000, days_1_30: 3750, days_31_60: 0, days_61_90: 0, days_91_120: 0, days_over_120: 0, total: 6750 },
    }],
  }
}

const vatTax = (id, name, rate, base) => ({ tax: { id, name }, rate, base, tax_amount: Math.round(base * rate) / 100 })

function vat(url) {
  const sales = [vatTax(1, 'ضريبة القيمة المضافة 15% على المبيعات', 15, 40000), vatTax(2, 'مبيعات بنسبة صفر', 0, 8000)]
  const purchases = [vatTax(3, 'ضريبة القيمة المضافة 15% على المشتريات', 15, 52000)]
  const section = taxes => ({ taxes, base: sum(taxes, 'base'), tax_amount: sum(taxes, 'tax_amount') })
  const salesSection = section(sales)
  const purchasesSection = section(purchases)
  return { ...periodOf(url), currency: CURRENCY, sales: salesSection, purchases: purchasesSection, net_payable: salesSection.tax_amount - purchasesSection.tax_amount }
}

function withholding(url) {
  const taxes = [
    { tax: { id: 7, name: 'استقطاع خدمات 5%' }, rate: 5, base: 20000, withheld: 1000 },
    { tax: { id: 8, name: 'استقطاع إيجارات 5%' }, rate: 5, base: 12000, withheld: 600 },
    { tax: { id: 9, name: 'استقطاع أتعاب استشارية 20%' }, rate: 20, base: 4000, withheld: 800 },
  ]
  return { ...periodOf(url), currency: CURRENCY, taxes, base: sum(taxes, 'base'), withheld: sum(taxes, 'withheld') }
}

const reports = {
  'trial-balance': trialBalance,
  'general-ledger': generalLedger,
  'partner-statement': partnerStatement,
  vat,
  withholding,
}

export function financeReportsPreviewData(path, url) {
  return reports[String(path).split('/').pop()]?.(url)
}
