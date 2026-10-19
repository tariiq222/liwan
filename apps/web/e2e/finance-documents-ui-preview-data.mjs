// Finance documents for the isolated mock (MODULE_UI_PREVIEW=1): invoices, credit notes, vendor bills and
// refunds in every state, their payments, the payment journals and the partners the pickers offer. Reads only:
// the mock has no finance write routes. Lists honour the filters the Odoo controller supports (move_type, state,
// partner_id, q, date_from, date_to, limit, offset), and `total` is the filtered count, so the KPI strip's
// limit=1 requests report real totals.
const CURRENCY = 'SAR'
const ACME = { id: 1, name: 'شركة الأفق للتجارة' }
const NOOR = { id: 2, name: 'مؤسسة نور للخدمات' }
const SUPPLY = { id: 3, name: 'مورّد المكاتب المتحدة' }
const PRINT = { id: 4, name: 'مطبعة الرياض' }
const SALES = { id: 1, name: 'مبيعات' }
const PURCHASES = { id: 2, name: 'مشتريات' }
const BANK = { id: 3, name: 'البنك الأهلي' }
const CASH = { id: 4, name: 'الصندوق' }

const partners = [
  { ...ACME, vat: '300000000000003', company_registry: '1010000001', street: 'طريق الملك فهد', city: 'الرياض', state: null, country: { id: 1, name: 'السعودية' }, is_company: true, customer: true, vendor: false, active: true },
  { ...NOOR, vat: '', company_registry: '', street: '', city: 'جدة', state: null, country: { id: 1, name: 'السعودية' }, is_company: true, customer: true, vendor: false, active: true },
  { ...SUPPLY, vat: '300000000000011', company_registry: '', street: '', city: 'الدمام', state: null, country: { id: 1, name: 'السعودية' }, is_company: true, customer: false, vendor: true, active: true },
  { ...PRINT, vat: '', company_registry: '', street: '', city: 'الرياض', state: null, country: { id: 1, name: 'السعودية' }, is_company: true, customer: false, vendor: true, active: true },
]

const journals = [
  { ...SALES, code: 'INV', type: 'sale', currency: CURRENCY },
  { ...PURCHASES, code: 'BILL', type: 'purchase', currency: CURRENCY },
  { ...BANK, code: 'BNK1', type: 'bank', currency: CURRENCY },
  { ...CASH, code: 'CSH1', type: 'cash', currency: CURRENCY },
]

const line = (id, name, quantity, price, discount = 0, taxed = true) => {
  const subtotal = quantity * price * (1 - discount / 100)
  return { id, name, account: { id: 40, name: 'إيرادات المبيعات' }, quantity, price_unit: price, discount, taxes: taxed ? [{ id: 1, name: 'ضريبة القيمة المضافة 15%' }] : [], price_subtotal: subtotal, price_total: taxed ? subtotal * 1.15 : subtotal, analytic_distribution: [] }
}

const submission = (state, extra = {}) => ({ state, mode: state === 'not_applicable' ? null : 'clearance', errors: [], warnings: [], qr_present: state === 'accepted', ...extra })

function document(id, moveType, state, paymentState, partner, lines, extra = {}) {
  const untaxed = lines.reduce((sum, item) => sum + item.price_subtotal, 0)
  const total = lines.reduce((sum, item) => sum + item.price_total, 0)
  const paid = { not_paid: 0, partial: total / 2, paid: total, in_payment: total }[paymentState] ?? 0
  const sale = moveType.startsWith('out_')
  const posted = state === 'posted'
  return {
    id,
    name: state === 'draft' ? null : `${{ out_invoice: 'INV', out_refund: 'RINV', in_invoice: 'BILL', in_refund: 'RBILL' }[moveType]}/2026/${String(id).padStart(4, '0')}`,
    move_type: moveType,
    state,
    payment_state: paymentState,
    partner,
    journal: sale ? SALES : PURCHASES,
    invoice_date: '2026-09-15',
    invoice_date_due: '2026-10-15',
    currency: CURRENCY,
    amount_untaxed: untaxed,
    amount_tax: total - untaxed,
    amount_total: total,
    amount_residual: posted ? total - paid : total,
    ref: '',
    debit_origin: null,
    zatca: sale ? { qr_code: posted ? 'AQ==' : null, confirmation_datetime: posted ? '2026-09-15T07:00:00Z' : null, submission: submission(posted ? 'pending' : 'not_applicable') } : null,
    lines,
    ...extra,
  }
}

export const financeDocuments = [
  document(1, 'out_invoice', 'draft', 'not_paid', ACME, [line(1, 'استشارات تقنية', 10, 500)]),
  document(2, 'out_invoice', 'posted', 'not_paid', ACME, [line(2, 'اشتراك سنوي', 1, 12000), line(3, 'دعم فني', 4, 750, 10)]),
  document(3, 'out_invoice', 'posted', 'partial', NOOR, [line(4, 'تصميم هوية', 1, 8000)], { invoice_date: '2026-08-01', invoice_date_due: '2026-08-31', zatca: { qr_code: 'AQ==', confirmation_datetime: '2026-08-01T07:00:00Z', submission: submission('retry', { warnings: [{ code: 'W-101', message: 'تعذّر الوصول إلى الهيئة' }] }) } }),
  document(4, 'out_invoice', 'posted', 'paid', NOOR, [line(5, 'صيانة', 2, 1500)], { invoice_date: '2026-07-05', invoice_date_due: '2026-08-05', zatca: { qr_code: 'AQ==', confirmation_datetime: '2026-07-05T07:00:00Z', submission: submission('accepted') } }),
  document(5, 'out_invoice', 'cancel', 'not_paid', ACME, [line(6, 'طلب ملغى', 1, 900)]),
  document(6, 'out_invoice', 'posted', 'not_paid', ACME, [line(7, 'ترخيص برنامج', 3, 2000)], { invoice_date: '2026-09-02', invoice_date_due: '2026-09-30', zatca: { qr_code: 'AQ==', confirmation_datetime: '2026-09-02T07:00:00Z', submission: submission('rejected', { errors: [{ code: 'BR-KSA-12', message: 'رقم الضريبة للمشتري مفقود' }] }) } }),
  document(7, 'out_refund', 'draft', 'not_paid', ACME, [line(8, 'استرداد جزئي', 1, 1000)]),
  document(8, 'out_refund', 'posted', 'not_paid', NOOR, [line(9, 'إشعار دائن للفاتورة', 1, 2500)]),
  document(9, 'out_refund', 'cancel', 'not_paid', NOOR, [line(10, 'إشعار ملغى', 1, 300)]),
  document(10, 'in_invoice', 'draft', 'not_paid', SUPPLY, [line(11, 'أثاث مكتبي', 6, 850)]),
  document(11, 'in_invoice', 'posted', 'not_paid', SUPPLY, [line(12, 'أجهزة حاسب', 5, 3200)], { invoice_date: '2026-09-10', invoice_date_due: '2026-10-10' }),
  document(12, 'in_invoice', 'posted', 'paid', PRINT, [line(13, 'مطبوعات', 500, 4)], { invoice_date: '2026-06-20', invoice_date_due: '2026-07-20' }),
  document(13, 'in_invoice', 'posted', 'partial', PRINT, [line(14, 'لوحات إعلانية', 3, 1800)], { invoice_date: '2026-08-12', invoice_date_due: '2026-09-12' }),
  document(14, 'in_refund', 'draft', 'not_paid', SUPPLY, [line(15, 'مرتجع أجهزة', 1, 3200)]),
  document(15, 'in_refund', 'posted', 'not_paid', PRINT, [line(16, 'مرتجع مطبوعات', 100, 4)]),
  document(16, 'in_refund', 'cancel', 'not_paid', SUPPLY, [line(17, 'مرتجع ملغى', 1, 150)]),
]
// A draft debit note shows the origin link on its record page.
financeDocuments.push(document(17, 'out_invoice', 'draft', 'not_paid', ACME, [line(18, 'إشعار مدين على الفاتورة', 1, 400)], { debit_origin: { id: 2, name: financeDocuments[1].name } }))

financeDocuments.push(document(18, 'in_invoice', 'cancel', 'not_paid', PRINT, [line(19, 'فاتورة موردة ملغاة', 1, 600)]))

const summary = ({ lines: _lines, ref: _ref, debit_origin: _origin, zatca: _zatca, ...rest }) => rest

export const financePayments = [
  { id: 1, name: 'BNK1/2026/0001', payment_type: 'inbound', partner_type: 'customer', state: 'paid', partner: NOOR, journal: BANK, date: '2026-08-10', memo: 'دفعة أولى', currency: CURRENCY, amount: 4600 },
  { id: 2, name: 'BNK1/2026/0002', payment_type: 'inbound', partner_type: 'customer', state: 'paid', partner: NOOR, journal: BANK, date: '2026-07-20', memo: 'سداد كامل', currency: CURRENCY, amount: 3450 },
  { id: 3, name: 'CSH1/2026/0001', payment_type: 'outbound', partner_type: 'supplier', state: 'paid', partner: PRINT, journal: CASH, date: '2026-09-01', memo: 'مطبوعات', currency: CURRENCY, amount: 2300 },
  { id: 4, name: 'BNK1/2026/0003', payment_type: 'outbound', partner_type: 'supplier', state: 'in_process', partner: PRINT, journal: BANK, date: '2026-09-18', memo: '', currency: CURRENCY, amount: 3105 },
  { id: 5, name: null, payment_type: 'inbound', partner_type: 'customer', state: 'draft', partner: ACME, journal: BANK, date: '2026-10-01', memo: '', currency: CURRENCY, amount: 1000 },
  { id: 6, name: 'BNK1/2026/0004', payment_type: 'inbound', partner_type: 'customer', state: 'canceled', partner: ACME, journal: BANK, date: '2026-09-05', memo: 'أُلغيت', currency: CURRENCY, amount: 500 },
  { id: 7, name: 'BNK1/2026/0005', payment_type: 'outbound', partner_type: 'supplier', state: 'rejected', partner: SUPPLY, journal: BANK, date: '2026-09-07', memo: 'رُفضت من البنك', currency: CURRENCY, amount: 800 },
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
  return Boolean(day) && (!from || day >= from) && (!to || day <= to)
}

function filterDocuments(url) {
  const { searchParams } = url
  const partner = Number(searchParams.get('partner_id') ?? 0)
  const hasPeriod = searchParams.has('date_from') || searchParams.has('date_to')
  return financeDocuments.filter(item => (!searchParams.get('move_type') || item.move_type === searchParams.get('move_type'))
    && (!searchParams.get('state') || item.state === searchParams.get('state'))
    && (!partner || item.partner?.id === partner)
    && (!hasPeriod || inPeriod(item.invoice_date, url))
    && (matches(item.name, searchParams.get('q')) || matches(item.ref, searchParams.get('q')) || matches(item.partner?.name, searchParams.get('q'))))
}

function filterPayments(url) {
  const { searchParams } = url
  const partner = Number(searchParams.get('partner_id') ?? 0)
  const hasPeriod = searchParams.has('date_from') || searchParams.has('date_to')
  return financePayments.filter(item => (!searchParams.get('payment_type') || item.payment_type === searchParams.get('payment_type'))
    && (!searchParams.get('state') || item.state === searchParams.get('state'))
    && (!partner || item.partner?.id === partner)
    && (!hasPeriod || inPeriod(item.date, url))
    && (matches(item.name, searchParams.get('q')) || matches(item.memo, searchParams.get('q')) || matches(item.partner?.name, searchParams.get('q'))))
}

const recordId = (route, base) => {
  const rest = route.slice(base.length + 1)
  return /^\d+$/.test(rest) ? Number(rest) : NaN
}

export function financeDocumentsPreviewData(path, url) {
  const route = String(path || '/').replace(/\/+$/, '') || '/'
  if (route === '/api/v1/finance/invoices') return page(filterDocuments(url).map(summary), url)
  if (route.startsWith('/api/v1/finance/invoices/')) return financeDocuments.find(item => item.id === recordId(route, '/api/v1/finance/invoices'))
  if (route === '/api/v1/finance/payments') return page(filterPayments(url), url)
  if (route === '/api/v1/finance/journals') return page(journals.filter(item => !url.searchParams.get('type') || item.type === url.searchParams.get('type')), url)
  if (route === '/api/v1/finance/partners') {
    const kind = url.searchParams.get('kind')
    return page(partners.filter(item => (!kind || item[kind]) && matches(item.name, url.searchParams.get('q'))), url)
  }
  if (route.startsWith('/api/v1/finance/partners/')) return partners.find(item => item.id === recordId(route, '/api/v1/finance/partners'))
  return undefined
}
