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
const partners = [{ id: 1, name: 'شركة النخبة للتجارة' }, { id: 2, name: 'مؤسسة الأفق للتوريدات' }]

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

// The MIS reports: every figure is a {code, label, value} line (`label` is the server's English description). Subtotals are
// computed from their parts so the sums always agree.
const line = (code, label, value) => ({ code, label, value })
const targetMoveOf = url => url.searchParams.get('target_move') ?? 'posted'
const dateToOf = url => url.searchParams.get('date_to') ?? DEFAULT_DAY

function profitLoss(url) {
  const [revenue, costOfRevenue, operatingExpenses, depreciation, otherIncome, otherExpenses] = [480000, 210000, 120000, 15000, 8000, 3000]
  const grossProfit = revenue - costOfRevenue
  const operatingProfit = grossProfit - operatingExpenses - depreciation
  return {
    ...periodOf(url),
    target_move: targetMoveOf(url),
    currency: CURRENCY,
    statutory: false,
    status: 'management_information',
    lines: [
      line('revenue', 'Revenue', revenue),
      line('cost_of_revenue', 'Cost of revenue', costOfRevenue),
      line('gross_profit', 'Gross profit', grossProfit),
      line('operating_expenses', 'Operating expenses', operatingExpenses),
      line('depreciation', 'Depreciation', depreciation),
      line('operating_profit', 'Operating profit', operatingProfit),
      line('other_income', 'Other income', otherIncome),
      line('other_expenses', 'Other expenses', otherExpenses),
      line('net_profit', 'Net profit', operatingProfit + otherIncome - otherExpenses),
    ],
  }
}

function balanceSheet(url) {
  const [cash, receivables, prepayments, fixedAssets, payables, creditCards, nonCurrentLiabilities, equity, retained, currentYear] = [185000, 96000, 24000, 150000, 70000, 12000, 60000, 200000, 80000, 33000]
  const currentAssets = cash + receivables + prepayments
  const totalAssets = currentAssets + fixedAssets
  const currentLiabilities = payables + creditCards
  const totalLiabilities = currentLiabilities + nonCurrentLiabilities
  const totalEquity = equity + retained + currentYear
  return {
    date_to: dateToOf(url),
    target_move: targetMoveOf(url),
    currency: CURRENCY,
    statutory: false,
    status: 'management_information',
    lines: [
      line('cash', 'Bank and cash', cash),
      line('receivables', 'Receivables', receivables),
      line('current_assets', 'Current assets', currentAssets),
      line('prepayments', 'Prepayments', prepayments),
      line('fixed_assets', 'Fixed assets, net of depreciation', fixedAssets),
      line('non_current_assets', 'Non-current assets', fixedAssets),
      line('total_assets', 'Total assets', totalAssets),
      line('payables', 'Payables', payables),
      line('credit_cards', 'Credit cards', creditCards),
      line('current_liabilities', 'Current liabilities', currentLiabilities),
      line('non_current_liabilities', 'Non-current liabilities', nonCurrentLiabilities),
      line('total_liabilities', 'Total liabilities', totalLiabilities),
      line('equity', 'Equity', equity),
      line('retained_earnings', 'Retained earnings of previous years', retained),
      line('current_year_earnings', 'Current year earnings', currentYear),
      line('total_equity', 'Total equity', totalEquity),
      line('total_liabilities_and_equity', 'Total liabilities and equity', totalLiabilities + totalEquity),
      line('difference', 'Assets less liabilities and equity (zero when balanced)', totalAssets - totalLiabilities - totalEquity),
    ],
  }
}

const ZAKAT_RATE = 0.0257768
const ZAKAT_DISCLAIMER = 'وعاء الزكاة المعروض مبسّط ويعتمد على أرصدة الدفاتر، ولا يغني عن الإقرار الزكوي؛ يجب أن يراجعه محاسب قانوني سعودي قبل الاعتماد عليه.'

function zakatBase(url) {
  const [equity, retained, longTermLiabilities, provisions, netProfit, addbacks, netFixedAssets, investments] = [200000, 80000, 60000, 12000, 140000, 5000, 150000, 20000]
  const adjustedProfit = netProfit + addbacks
  const additions = equity + retained + longTermLiabilities + provisions + adjustedProfit
  const deductions = netFixedAssets + investments
  const base = additions - deductions
  const due = Math.round(base * ZAKAT_RATE * 100) / 100
  return {
    date_to: dateToOf(url),
    target_move: targetMoveOf(url),
    currency: CURRENCY,
    lines: [
      line('equity', 'Equity (capital, reserves and other equity accounts)', equity),
      line('retained_earnings', 'Retained earnings of previous years', retained),
      line('long_term_liabilities', 'Long-term liabilities', longTermLiabilities),
      line('provisions', 'Provisions (leave days and leave tickets)', provisions),
      line('net_profit', 'Net profit of the fiscal year to date', netProfit),
      line('profit_addbacks', 'Zakat and income tax expense added back', addbacks),
      line('adjusted_net_profit', 'Adjusted net profit', adjustedProfit),
      line('net_fixed_assets', 'Net fixed assets', netFixedAssets),
      line('long_term_investments', 'Long-term investments and non-current assets', investments),
      line('total_additions', 'Total additions', additions),
      line('total_deductions', 'Total deductions', deductions),
      line('zakat_base', 'Zakat base', base),
      line('zakat_rate', 'Zakat rate: 2.5% of the lunar year scaled to the Gregorian year (x 365/354)', ZAKAT_RATE),
      line('zakat_due', 'Zakat due on the positive base', due),
    ],
    template_base: base,
    adjustments: [],
    adjustments_total: 0,
    base,
    rate: ZAKAT_RATE,
    zakat_due: due,
    status: 'management_information',
    filed: false,
    review: null,
    disclaimer: ZAKAT_DISCLAIMER,
  }
}

// The statement of cash flows by the indirect method. Net change 15000 = operating 21000 - investing 4000 - financing 2000; the cash
// accounts moved by the same amount, so the check difference is zero.
function cashFlow(url) {
  const period = periodOf(url)
  return {
    date_from: period.date_from,
    date_to: period.date_to,
    currency: CURRENCY,
    basis: 'indirect',
    statutory: false,
    opening_cash: 50000,
    closing_cash: 65000,
    net_change: 15000,
    operating: {
      net_income: 18000,
      adjustments: [{ key: 'depreciation', amount: 1500 }],
      items: [{ account: accounts[1], amount: 2000 }, { account: accounts[2], amount: -500 }],
      total: 21000,
    },
    investing: { items: [{ account: accounts[4], amount: -3000 }], depreciation_reclass: -1000, total: -4000 },
    financing: { items: [{ account: accounts[3], amount: -2000 }], total: -2000 },
    total_change: 15000,
    difference: 0,
  }
}

const reports = {
  'cash-flow': cashFlow,
  'trial-balance': trialBalance,
  'general-ledger': generalLedger,
  'partner-statement': partnerStatement,
  vat,
  withholding,
  'profit-loss': profitLoss,
  'balance-sheet': balanceSheet,
  'zakat-base': zakatBase,
}

export function financeReportsPreviewData(path, url) {
  return reports[String(path).split('/').pop()]?.(url)
}
