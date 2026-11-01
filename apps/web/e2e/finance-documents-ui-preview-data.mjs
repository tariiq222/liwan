// Finance documents for the isolated mock (MODULE_UI_PREVIEW=1): invoices, credit notes, vendor bills and
// refunds in every state, their payments and the payment journals (partners come from finance-ui-preview-data.mjs). Reads
// only, except the internal transfer, a partner's bank accounts and the fiscal transfer account (`financeGapsPreview`
// at the end of this file). Lists honour the filters the Odoo controller supports (move_type, state,
// partner_id, q, date_from, date_to, limit, offset), and `total` is the filtered count, so the KPI strip's
// limit=1 requests report real totals. A record carries the actions the server would allow its caller (an administrator
// who holds every capability, on a tenant that can write), so the pages draw the same buttons.
import { financeAccounts } from './finance-accounting-ui-preview-data.mjs'
import { financePreviewData } from './finance-ui-preview-data.mjs'

const CURRENCY = 'SAR'
const ACME = { id: 1, name: 'شركة الأفق للتجارة' }
const NOOR = { id: 2, name: 'مؤسسة نور للخدمات' }
const SUPPLY = { id: 3, name: 'مورّد المكاتب المتحدة' }
const PRINT = { id: 4, name: 'مطبعة الرياض' }
const SALES = { id: 1, name: 'مبيعات' }
const PURCHASES = { id: 2, name: 'مشتريات' }
const BANK = { id: 3, name: 'البنك الأهلي' }
const CASH = { id: 4, name: 'الصندوق' }
const MISC = { id: 5, name: 'العمليات المتنوعة' }

const journals = [
  { ...SALES, code: 'INV', type: 'sale', currency: CURRENCY, default_account: null, active: true },
  { ...PURCHASES, code: 'BILL', type: 'purchase', currency: CURRENCY, default_account: null, active: true },
  { ...BANK, code: 'BNK1', type: 'bank', currency: CURRENCY, default_account: null, active: true },
  { ...CASH, code: 'CSH1', type: 'cash', currency: CURRENCY, default_account: null, active: true },
  { ...MISC, code: 'MISC', type: 'general', currency: CURRENCY, default_account: null, active: true },
]

const line = (id, name, quantity, price, discount = 0, taxed = true) => {
  const subtotal = quantity * price * (1 - discount / 100)
  return { id, name, account: { id: 40, name: 'إيرادات المبيعات' }, quantity, price_unit: price, discount, taxes: taxed ? [{ id: 1, name: 'ضريبة القيمة المضافة 15%' }] : [], price_subtotal: subtotal, price_total: taxed ? subtotal * 1.15 : subtotal, analytic_distribution: [], asset_profile: null, asset: null }
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
    payment_term: null,
    currency: CURRENCY,
    amount_untaxed: untaxed,
    amount_tax: total - untaxed,
    amount_total: total,
    amount_residual: posted ? total - paid : total,
    ref: '',
    debit_origin: null,
    credit_origin: null,
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

// A posted vendor bill that capitalised its line into an asset shows the asset link on its record page.
Object.assign(financeDocuments[10].lines[0], { asset_profile: { id: 1, name: 'أجهزة حاسب - 3 سنوات' }, asset: { id: 1, name: 'أجهزة حاسب - الدفعة الأولى' } })

financeDocuments.push(document(18, 'in_invoice', 'cancel', 'not_paid', PRINT, [line(19, 'فاتورة موردة ملغاة', 1, 600)]))

const summary = ({ lines: _lines, ref: _ref, debit_origin: _origin, credit_origin: _creditOrigin, zatca: _zatca, allowed_actions: _allowed, blocked_actions: _blocked, ...rest }) => rest

const PAID_STATES = ['in_payment', 'paid', 'partial']
const RESEND_STATES = ['retry', 'rejected', 'blocked', 'unauthorized']
const DEBITABLE_TYPES = ['out_invoice', 'in_invoice']

// Cancelling or resetting a posted document is blocked while a payment is reconciled with it.
function withDocumentActions(item) {
  const draft = item.state === 'draft'
  const posted = item.state === 'posted'
  const zatca = posted ? item.zatca?.submission.state : null
  const transitions = [...(draft ? [] : ['reset_to_draft']), ...(item.state === 'cancel' ? [] : ['cancel'])]
  const blocked = posted && PAID_STATES.includes(item.payment_state) ? transitions : []
  const offered = [
    ...(draft ? ['edit', 'delete', 'post'] : []),
    ...transitions,
    ...(posted ? ['pdf'] : []),
    ...(posted && DEBITABLE_TYPES.includes(item.move_type) && !item.debit_origin ? ['debit_note'] : []),
    ...(posted && DEBITABLE_TYPES.includes(item.move_type) ? ['credit_note'] : []),
    ...(posted && item.amount_residual > 0 && item.payment_state !== 'paid' ? ['register_payment'] : []),
    ...(zatca === 'pending' ? ['zatca_submit'] : RESEND_STATES.includes(zatca) ? ['zatca_retry'] : []),
  ]
  return {
    ...item,
    allowed_actions: offered.filter(action => !blocked.includes(action)),
    blocked_actions: blocked.map(action => ({ action, reason: 'has_payments' })),
  }
}

function withPaymentActions(payment) {
  const posted = payment.state === 'in_process' || payment.state === 'paid'
  const revivable = payment.state === 'canceled' || payment.state === 'rejected'
  return {
    ...payment,
    allowed_actions: [
      ...(revivable ? ['reset_to_draft'] : ['cancel']),
      ...(payment.state === 'draft' ? ['post', 'edit'] : []),
      ...(posted && payment.unallocated > 0 ? ['allocate'] : []),
      ...(posted && payment.invoices.length > 0 ? ['unallocate'] : []),
    ],
    blocked_actions: [],
  }
}

export const financePayments = [
  { id: 1, name: 'BNK1/2026/0001', payment_type: 'inbound', partner_type: 'customer', state: 'paid', partner: NOOR, journal: BANK, date: '2026-08-10', memo: 'دفعة أولى', currency: CURRENCY, amount: 4600, unallocated: 0, exchange_difference: 37.5, invoices: [] },
  { id: 2, name: 'BNK1/2026/0002', payment_type: 'inbound', partner_type: 'customer', state: 'paid', partner: NOOR, journal: BANK, date: '2026-07-20', memo: 'سداد كامل', currency: CURRENCY, amount: 3450, unallocated: 0, exchange_difference: 0, invoices: [] },
  { id: 3, name: 'CSH1/2026/0001', payment_type: 'outbound', partner_type: 'supplier', state: 'paid', partner: PRINT, journal: CASH, date: '2026-09-01', memo: 'مطبوعات', currency: CURRENCY, amount: 2300, unallocated: 0, exchange_difference: -12.4, invoices: [] },
  { id: 4, name: 'BNK1/2026/0003', payment_type: 'outbound', partner_type: 'supplier', state: 'in_process', partner: PRINT, journal: BANK, date: '2026-09-18', memo: '', currency: CURRENCY, amount: 3105, unallocated: 0, exchange_difference: 0, invoices: [] },
  { id: 5, name: null, payment_type: 'inbound', partner_type: 'customer', state: 'draft', partner: ACME, journal: BANK, date: '2026-10-01', memo: '', currency: CURRENCY, amount: 1000, unallocated: 0, exchange_difference: 0, invoices: [] },
  { id: 6, name: 'BNK1/2026/0004', payment_type: 'inbound', partner_type: 'customer', state: 'canceled', partner: ACME, journal: BANK, date: '2026-09-05', memo: 'أُلغيت', currency: CURRENCY, amount: 500, unallocated: 0, exchange_difference: 0, invoices: [] },
  { id: 7, name: 'BNK1/2026/0005', payment_type: 'outbound', partner_type: 'supplier', state: 'rejected', partner: SUPPLY, journal: BANK, date: '2026-09-07', memo: 'رُفضت من البنك', currency: CURRENCY, amount: 800, unallocated: 0, exchange_difference: 0, invoices: [] },
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

// ---- Writes and reads of the finance gap screens (internal transfer, partner bank accounts, fiscal transfer account) ----

const TRANSFER_ACCOUNTS = [
  { id: 101, code: '100001', name: 'Liquidity Transfer', account_type: 'asset_current', reconcile: true, currency: null, active: true },
  { id: 102, code: '100002', name: 'حساب تسوية مؤقت', account_type: 'asset_current', reconcile: true, currency: null, active: true },
]
let transferAccount = { id: 101, name: '100001 Liquidity Transfer' }
let nextPaymentId = 100
let nextBankId = 100

const bankAccounts = () => [
  { id: 1, partner_id: 2, acc_number: 'SA0380000000608010167519', holder_name: 'مؤسسة الأفق للتوريدات', bank_name: 'مصرف الراجحي', bic: 'RJHISARI', active: true },
  { id: 2, partner_id: 2, acc_number: 'SA4420000001234567891234', holder_name: 'مؤسسة الأفق للتوريدات', bank_name: 'البنك الأهلي السعودي', bic: 'NCBKSAJE', active: false },
  { id: 3, partner_id: 3, acc_number: '1234567890', holder_name: '', bank_name: '', bic: '', active: true },
]
const banks = bankAccounts()
const bankOut = ({ partner_id: _partner, ...rest }) => rest
const refuse = (status, code, message, field) => ({ status, body: { code, message, ...(field ? { field } : {}) } })

function saveBank(account, body) {
  if ('acc_number' in body) {
    const number = String(body.acc_number).toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!number) return refuse(422, 'invalid', 'acc_number is required', 'acc_number')
    if (number.startsWith('SA') && number.length !== 24) return refuse(422, 'invalid', 'acc_number is not a valid Saudi IBAN', 'acc_number')
    if (banks.some(other => other.partner_id === account.partner_id && other.id !== account.id && other.acc_number === number)) {
      return refuse(422, 'duplicate', 'the partner already has this bank account', 'acc_number')
    }
    account.acc_number = number
  }
  for (const field of ['holder_name', 'bank_name', 'bic']) if (field in body) account[field] = String(body[field])
  if (account.bic && !account.bank_name) return refuse(422, 'invalid', 'bic needs a bank_name', 'bank_name')
  return null
}

function transferLeg(kind, journal, body) {
  const id = nextPaymentId++
  return withPaymentActions({
    id, name: `${journal.code}/2026/${String(id).padStart(4, '0')}`, payment_type: kind, partner_type: 'customer', state: 'paid',
    partner: null, journal: { id: journal.id, name: journal.name }, date: body.payment_date, memo: body.memo ?? '', currency: CURRENCY, amount: body.amount,
    unallocated: 0, exchange_difference: 0, invoices: [],
  })
}

function transfer(body) {
  const from = journals.find(item => item.id === body.from_journal_id && ['bank', 'cash'].includes(item.type))
  const to = journals.find(item => item.id === body.to_journal_id && ['bank', 'cash'].includes(item.type))
  if (!from) return refuse(422, 'invalid', 'from_journal_id is not a bank or cash journal', 'from_journal_id')
  if (!to) return refuse(422, 'invalid', 'to_journal_id is not a bank or cash journal', 'to_journal_id')
  // The mock's stand-ins for the server's refusals: a magic amount or a date in a closed year.
  if (body.payment_date < '2026-01-01') return refuse(422, 'period_locked', 'the accounting period is locked', 'payment_date')
  if (body.amount === 998) return refuse(422, 'journal_currency_mismatch', 'both journals must use the same currency', 'to_journal_id')
  if (body.amount === 999) return refuse(422, 'transfer_account_missing', 'the company has no transfer account: choose one in the finance setup')
  return { status: 201, body: { outbound: transferLeg('outbound', from, body), inbound: transferLeg('inbound', to, body) } }
}

/**
 * The routes of the finance gap screens that the other preview files do not serve: the answer is `{status, body}`, or
 * undefined for any other request. The fiscal setup keeps its transfer account for the life of the mock process.
 */
export function financeGapsPreview(method, path, url, body = {}) {
  const route = String(path || '/').replace(/\/+$/, '') || '/'
  const setup = financePreviewData('/api/v1/finance/setup', url)
  if (method === 'GET' && route === '/api/v1/finance/setup') return { status: 200, body: { ...setup, fiscal: { ...setup.fiscal, transfer_account: transferAccount } } }
  if (method === 'PATCH' && route === '/api/v1/finance/setup/fiscal') {
    if ('transfer_account_id' in body) {
      const account = TRANSFER_ACCOUNTS.find(item => item.id === body.transfer_account_id)
      if (!account) return refuse(422, 'invalid', 'transfer_account_id is not a reconcilable current asset', 'transfer_account_id')
      transferAccount = { id: account.id, name: `${account.code} ${account.name}` }
    }
    const { transfer_account_id: _account, ...rest } = body
    return { status: 200, body: { ...setup, fiscal: { ...setup.fiscal, ...rest, transfer_account: transferAccount } } }
  }
  if (method === 'GET' && route === '/api/v1/finance/accounts' && url.searchParams.get('reconcile') === 'true') {
    const type = url.searchParams.get('account_type')
    const q = url.searchParams.get('q')
    const rows = [...financeAccounts, ...TRANSFER_ACCOUNTS].filter(item => item.reconcile && (!type || item.account_type === type) && (matches(item.code, q) || matches(item.name, q)))
    return { status: 200, body: page(rows, url) }
  }
  if (method === 'POST' && route === '/api/v1/finance/payments/transfer') return transfer(body)
  const bank = /^\/api\/v1\/finance\/partners\/(\d+)\/bank-accounts(?:\/(\d+)(?:\/(archive|unarchive))?)?$/.exec(route)
  if (!bank) return undefined
  const partnerId = Number(bank[1])
  const rows = banks.filter(item => item.partner_id === partnerId)
  if (!bank[2]) {
    if (method === 'GET') return { status: 200, body: { items: rows.map(bankOut), total: rows.length } }
    if (method !== 'POST') return undefined
    const created = { id: nextBankId++, partner_id: partnerId, acc_number: '', holder_name: '', bank_name: '', bic: '', active: true }
    if (typeof body.acc_number !== 'string' || !body.acc_number.trim()) return refuse(422, 'invalid', 'acc_number is required', 'acc_number')
    const refusal = saveBank(created, body)
    if (refusal) return refusal
    banks.push(created)
    return { status: 201, body: bankOut(created) }
  }
  const account = rows.find(item => item.id === Number(bank[2]))
  if (!account) return refuse(404, 'not_found', 'bank account not found')
  if (bank[3]) {
    account.active = bank[3] === 'unarchive'
    return { status: 200, body: bankOut(account) }
  }
  if (method !== 'PATCH') return undefined
  const refusal = saveBank(account, body)
  return refusal ?? { status: 200, body: bankOut(account) }
}

export function financeDocumentsPreviewData(path, url) {
  const route = String(path || '/').replace(/\/+$/, '') || '/'
  if (route === '/api/v1/finance/invoices') return page(filterDocuments(url).map(summary), url)
  if (route.startsWith('/api/v1/finance/invoices/')) {
    const found = financeDocuments.find(item => item.id === recordId(route, '/api/v1/finance/invoices'))
    return found && withDocumentActions(found)
  }
  if (route === '/api/v1/finance/payments') return page(filterPayments(url).map(withPaymentActions), url)
  if (route === '/api/v1/finance/journals') return page(journals.filter(item => !url.searchParams.get('type') || item.type === url.searchParams.get('type')), url)
  return undefined
}
