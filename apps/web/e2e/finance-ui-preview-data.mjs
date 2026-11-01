// Finance rows for the isolated mock (MODULE_UI_PREVIEW=1). Reads only: the mock has no finance write routes.
// The partners cover a customer, a vendor, both at once, an individual without tax data and an archived one, so the list filters,
// the kind tags and the archived scope can be tested. The setup is deliberately incomplete (no ZATCA onboarding, no company
// registration) so the overview checklist and the settings page show a blocker; the invoices are drafts for the "needs attention" list.
const SAUDI = { id: 1, name: 'المملكة العربية السعودية' }
const RIYADH = { id: 1, name: 'منطقة الرياض' }
const MAKKAH = { id: 2, name: 'منطقة مكة المكرمة' }

const partners = [
  { id: 1, name: 'شركة النخبة للتجارة', vat: '300123456700003', company_registry: '1010123456', street: 'طريق الملك فهد', city: 'الرياض', state: RIYADH, country: SAUDI, is_company: true, customer: true, vendor: false, active: true },
  { id: 2, name: 'مؤسسة الأفق للتوريدات', vat: '300765432100003', company_registry: '4030765432', street: 'شارع التحلية', city: 'جدة', state: MAKKAH, country: SAUDI, is_company: true, customer: false, vendor: true, active: true },
  { id: 3, name: 'مجموعة الريادة القابضة', vat: '300999888700003', company_registry: '', street: '', city: 'الرياض', state: RIYADH, country: SAUDI, is_company: true, customer: true, vendor: true, active: true },
  { id: 4, name: 'خالد الشمري', vat: '', company_registry: '', street: '', city: '', state: null, country: null, is_company: false, customer: true, vendor: false, active: true },
  { id: 5, name: 'شركة الغروب القديمة', vat: '300111222300003', company_registry: '', street: '', city: 'الدمام', state: null, country: SAUDI, is_company: true, customer: false, vendor: true, active: false },
]
const countries = [
  { id: 1, name: SAUDI.name, code: 'SA' },
  { id: 2, name: 'الإمارات العربية المتحدة', code: 'AE' },
  { id: 3, name: 'مصر', code: 'EG' },
]
const states = [{ id: 1, name: RIYADH.name, code: 'RD' }, { id: 2, name: MAKKAH.name, code: 'MK' }]

const SALES_JOURNAL = { id: 1, name: 'مبيعات العملاء' }
const draft = (id, move_type, partner, total) => ({
  id, name: null, move_type, state: 'draft', payment_state: 'not_paid', partner, journal: SALES_JOURNAL, invoice_date: null, invoice_date_due: null, payment_term: null,
  currency: 'SAR', amount_untaxed: total / 1.15, amount_tax: total - total / 1.15, amount_total: total, amount_residual: total,
})
const invoices = [
  draft(1, 'out_invoice', { id: 1, name: partners[0].name }, 11500),
  draft(2, 'in_invoice', { id: 2, name: partners[1].name }, 3450),
  draft(3, 'out_refund', { id: 3, name: partners[2].name }, 575),
  { ...draft(4, 'out_invoice', { id: 1, name: partners[0].name }, 23000), name: 'INV/2026/0001', state: 'posted', payment_state: 'partial', invoice_date: '2026-10-01', invoice_date_due: '2026-10-31', amount_residual: 9000 },
]

const setup = {
  chart: { loaded: true, template: 'sa', accounts_count: 182 },
  company: { name: 'ليوان', vat: '300000000000003', company_registry: '', street: 'طريق الملك عبدالله', city: 'الرياض', state: RIYADH, country: SAUDI, currency: 'SAR', missing_fields: ['company_registry'] },
  fiscal: { fiscalyear_last_day: 31, fiscalyear_last_month: 12, fiscalyear_lock_date: '2025-12-31', tax_lock_date: null, sale_lock_date: null, purchase_lock_date: null, hard_lock_date: null },
  journals: { sale: 1, purchase: 1, bank: 1, cash: 1 },
  taxes: { sale_count: 4, purchase_count: 4, vat_15_present: true },
  zatca: { api_mode: 'sandbox', private_key_present: false, journals: [{ journal: SALES_JOURNAL, onboarded: false, state: 'not_started' }], onboarded: false },
  ready: false,
  blockers: ['company_registry_missing', 'zatca_not_onboarded'],
}

// One account with two partners; the buckets add up to `total` (the figure the overview reads), receivables aged and payables current.
const agedBuckets = (total, kind) => {
  const aging = kind === 'payable' ? [1, 0, 0] : [0.4, 0.35, 0.25]
  const [current, days1To30, days31To60] = aging.map(share => total * share)
  return { current, days_1_30: days1To30, days_31_60: days31To60, days_61_90: 0, days_91_120: 0, days_over_120: 0, total }
}
const scaleBuckets = (buckets, share) => Object.fromEntries(Object.entries(buckets).map(([bucket, value]) => [bucket, value * share]))
const aged = (kind, total, url) => {
  const buckets = agedBuckets(total, kind)
  return {
    date_to: url.searchParams.get('date_to') ?? new Date().toISOString().slice(0, 10), kind, target_move: url.searchParams.get('target_move') ?? 'posted', currency: 'SAR',
    accounts: [{
      account: kind === 'payable' ? { id: 301, code: '210101', name: 'الموردون' } : { id: 201, code: '120101', name: 'العملاء' },
      ...buckets,
      partners: [
        { partner: { id: 1, name: 'شركة الأفق للتجارة' }, ...scaleBuckets(buckets, 0.6) },
        { partner: null, ...scaleBuckets(buckets, 0.4) },
      ],
    }],
    totals: buckets,
  }
}

const page = (items, url) => {
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Number(url.searchParams.get('limit') ?? 50)
  return { items: items.slice(offset, offset + (Number.isFinite(limit) && limit > 0 ? limit : 50)), total: items.length }
}
const matches = (text, q) => !q || text.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase())
const byId = (rows, route, base) => {
  const raw = route.slice(base.length + 1)
  return rows.find(row => /^\d+$/.test(raw) && row.id === Number(raw))
}

export function financePreviewData(path, url) {
  const route = String(path || '/').replace(/\/+$/, '') || '/'
  const q = url.searchParams.get('q') ?? ''
  if (route === '/api/v1/finance/partners') {
    const archived = url.searchParams.get('archived') === 'true'
    const kind = url.searchParams.get('kind')
    return page(partners.filter(row => row.active !== archived
      && (!kind || (kind === 'customer' ? row.customer : row.vendor))
      && (matches(`${row.name} ${row.vat} ${row.company_registry}`, q))), url)
  }
  if (route.startsWith('/api/v1/finance/partners/')) return byId(partners, route, '/api/v1/finance/partners')
  if (route === '/api/v1/finance/countries') return page(countries.filter(row => matches(`${row.name} ${row.code}`, q)), url)
  if (/^\/api\/v1\/finance\/countries\/\d+\/states$/.test(route)) return page(states, url)
  if (route === '/api/v1/finance/setup') return setup
  if (route === '/api/v1/finance/invoices') {
    const state = url.searchParams.get('state')
    return page(invoices.filter(row => (!state || row.state === state) && matches(`${row.name ?? ''} ${row.partner?.name ?? ''}`, q)), url)
  }
  if (route === '/api/v1/finance/reports/aged-partner-balance') return aged(url.searchParams.get('kind') ?? 'receivable', url.searchParams.get('kind') === 'payable' ? 3450 : 14000, url)
  return undefined
}
