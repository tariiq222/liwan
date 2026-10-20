// Finance bank for the isolated mock (MODULE_UI_PREVIEW=1): statements of the bank journal with reconciled and open
// lines, and the open items proposed for each open line. Reads only: the mock has no finance write routes. The statements
// list honours the filters the Odoo controller supports (journal_id, date_from, date_to, limit, offset), and `total` is
// the filtered count, so the KPI strip's limit=1 requests report real totals.
const CURRENCY = 'SAR'
const BANK = { id: 3, name: 'البنك الأهلي' }
const ACME = { id: 1, name: 'شركة الأفق للتجارة' }
const NOOR = { id: 2, name: 'مؤسسة نور للخدمات' }
const SUPPLY = { id: 3, name: 'مورّد المكاتب المتحدة' }
const PRINT = { id: 4, name: 'مطبعة الرياض' }
const RECEIVABLE = { id: 11, name: 'ذمم العملاء' }
const PAYABLE = { id: 21, name: 'ذمم الموردين' }

// [date, label, partner, amount, reconciled]
const statementSpecs = [
  { date: '2026-09-30', start: 120000, lines: [
    ['2026-09-03', 'تحويل وارد من شركة الأفق', ACME, 14375, true],
    ['2026-09-07', 'سداد مورّد المكاتب', SUPPLY, -16000, true],
    ['2026-09-12', 'تحويل وارد غير محدد المصدر', null, 8625, false],
    ['2026-09-19', 'سداد مطبعة الرياض', PRINT, -2000, false],
    ['2026-09-26', 'رسوم بنكية', null, -45.5, false],
  ] },
  { date: '2026-08-31', start: 96500, lines: [
    ['2026-08-02', 'تحويل وارد من مؤسسة نور', NOOR, 4000, true],
    ['2026-08-10', 'سداد مطبعة الرياض', PRINT, -1000, true],
    ['2026-08-18', 'إيداع نقدي', null, 12000, true],
    ['2026-08-27', 'رسوم تحويل', null, -15, true],
  ] },
  { date: '2026-07-31', start: 80000, lines: [
    ['2026-07-05', 'تحويل وارد من شركة الأفق', ACME, 23000, true],
    ['2026-07-14', 'دفعة إيجار المكتب', null, -9500, true],
    ['2026-07-21', 'سداد مورّد المكاتب', SUPPLY, -3200, true],
    ['2026-07-29', 'تحويل وارد من مؤسسة نور', NOOR, 7000, true],
    ['2026-07-30', 'فوائد بنكية', null, 12.75, true],
    ['2026-07-30', 'رسوم الحساب الشهرية', null, -25, true],
  ] },
  { date: '2026-06-30', start: 65000, realEndOffset: 30, lines: [
    ['2026-06-04', 'تحويل وارد من شركة الأفق', ACME, 18000, true],
    ['2026-06-11', 'سداد مطبعة الرياض', PRINT, -1800, false],
    ['2026-06-20', 'تحويل وارد من مؤسسة نور', NOOR, 6500, false],
  ] },
  { date: '2026-05-31', start: 51000, lines: [
    ['2026-05-06', 'تحويل وارد من شركة الأفق', ACME, 9000, true],
    ['2026-05-13', 'سداد مورّد المكاتب', SUPPLY, -4800, true],
    ['2026-05-22', 'تحويل وارد من مؤسسة نور', NOOR, 3200, true],
    ['2026-05-28', 'رسوم بنكية', null, -30, true],
    ['2026-05-29', 'سداد مطبعة الرياض', PRINT, -2400, true],
    ['2026-05-30', 'إيداع نقدي', null, 5000, true],
    ['2026-05-30', 'تحويل صادر إلى الصندوق', null, -1000, true],
  ] },
  { date: '2026-04-30', start: 42000, lines: [
    ['2026-04-08', 'تحويل وارد من شركة الأفق', ACME, 7600, true],
    ['2026-04-15', 'سداد مورّد المكاتب', SUPPLY, -2100, false],
    ['2026-04-24', 'رسوم بنكية', null, -35, true],
  ] },
]

let nextLineId = 100
const statements = statementSpecs.map((spec, index) => {
  const lines = spec.lines.map(([date, paymentRef, partner, amount, reconciled]) => ({
    id: nextLineId++, date, payment_ref: paymentRef, partner, amount, is_reconciled: reconciled, amount_residual: reconciled ? 0 : amount,
  }))
  const end = Math.round((spec.start + lines.reduce((sum, line) => sum + line.amount, 0)) * 100) / 100
  return {
    id: index + 1,
    name: `BNK1/2026/${String(index + 1).padStart(4, '0')}`,
    date: spec.date,
    journal: BANK,
    currency: CURRENCY,
    balance_start: spec.start,
    balance_end: end,
    balance_end_real: end + (spec.realEndOffset ?? 0),
    lines_count: lines.length,
    lines,
  }
})

const summary = ({ lines: _lines, ...rest }) => rest

const item = (id, date, entry, label, partner, account, amount, exact) => ({ id, date, entry, label, partner, account, amount_residual: amount, exact })

// Open items by the direction of the line: money in clears receivables, money out clears payables.
const openIn = [
  item(901, '2026-09-10', 'INV/2026/0002', 'فاتورة اشتراك سنوي', ACME, RECEIVABLE, 8625, true),
  item(902, '2026-08-01', 'INV/2026/0003', 'فاتورة تصميم هوية', NOOR, RECEIVABLE, 4000, false),
  item(903, '2026-09-02', 'INV/2026/0006', 'فاتورة ترخيص برنامج', ACME, RECEIVABLE, 6900, false),
  item(904, '2026-06-18', 'INV/2026/0001', 'فاتورة استشارات', NOOR, RECEIVABLE, 6500, true),
]
const openOut = [
  item(911, '2026-09-18', 'BILL/2026/0013', 'فاتورة لوحات إعلانية', PRINT, PAYABLE, -2000, true),
  item(912, '2026-09-10', 'BILL/2026/0011', 'فاتورة أجهزة حاسب', SUPPLY, PAYABLE, -16000, false),
  item(913, '2026-06-09', 'BILL/2026/0008', 'فاتورة مطبوعات', PRINT, PAYABLE, -1800, true),
  item(914, '2026-04-12', 'BILL/2026/0004', 'فاتورة أثاث مكتبي', SUPPLY, PAYABLE, -2100, true),
]

const proposalsFor = line => (line.amount > 0 ? openIn : openOut)
  .filter(entry => !line.partner || entry.partner.id === line.partner.id)
  .map(entry => ({ ...entry, exact: entry.amount_residual === line.amount_residual }))
  .sort((a, b) => Number(b.exact) - Number(a.exact))

function page(rows, url) {
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Number(url.searchParams.get('limit') ?? 50)
  const size = Number.isFinite(limit) && limit > 0 ? limit : 50
  return { items: rows.slice(offset, offset + size), total: rows.length }
}

function filterStatements(url) {
  const { searchParams } = url
  const journal = Number(searchParams.get('journal_id') ?? 0)
  const from = searchParams.get('date_from')
  const to = searchParams.get('date_to')
  return statements.filter(item => (!journal || item.journal.id === journal)
    && (!from || item.date >= from)
    && (!to || item.date <= to))
}

const recordId = (route, base) => {
  const rest = route.slice(base.length + 1)
  return /^\d+$/.test(rest) ? Number(rest) : NaN
}

export function financeBankPreviewData(path, url) {
  const route = String(path || '/').replace(/\/+$/, '') || '/'
  if (route === '/api/v1/finance/bank-statements') return page(filterStatements(url).map(summary), url)
  if (route.startsWith('/api/v1/finance/bank-statements/')) return statements.find(item => item.id === recordId(route, '/api/v1/finance/bank-statements'))
  const proposals = route.match(/^\/api\/v1\/finance\/bank-statement-lines\/(\d+)\/reconcile-proposals$/)
  if (proposals) {
    const line = statements.flatMap(item => item.lines).find(item => item.id === Number(proposals[1]))
    return line && !line.is_reconciled ? page(proposalsFor(line), url) : { items: [], total: 0 }
  }
  return undefined
}
