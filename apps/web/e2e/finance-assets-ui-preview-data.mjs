// Finance assets for the isolated mock (MODULE_UI_PREVIEW=1): three asset profiles and eight fixed assets in every
// state, each with a consistent depreciation board (a draft has only unposted lines). Reads only: the mock has no
// finance write routes, so POST compute-depreciation and validate are not served. The assets list honours the filters
// the Odoo controller supports (q, state, profile_id, limit, offset) and `total` is the filtered count, so the KPI
// strip's limit=1 requests report real totals.
const CURRENCY = 'SAR'
const TODAY = '2026-10-20'
const ref = (id, name) => ({ id, name })
const assetAccount = ref(6, 'الأثاث والتجهيزات')
const depreciationAccount = ref(31, 'مجمع الإهلاك')
const expenseAccount = ref(26, 'مصروف الإهلاك')
const journal = ref(5, 'العمليات المتنوعة')
const VENDOR = ref(3, 'مورّد المكاتب المتحدة')
const TECH = ref(4, 'شركة التقنية الحديثة')

const profile = (id, name, method_number, method_period) => ({
  id,
  name,
  method: 'linear',
  method_time: 'year',
  method_number,
  method_period,
  prorata: false,
  asset_account: assetAccount,
  depreciation_account: depreciationAccount,
  expense_account: expenseAccount,
  journal,
})

export const financeAssetProfiles = [
  profile(1, 'أجهزة حاسب - 3 سنوات', 3, 'month'),
  profile(2, 'أثاث - 5 سنوات', 5, 'year'),
  profile(3, 'سيارات - 4 سنوات', 4, 'quarter'),
]

const STEP_MONTHS = { month: 1, quarter: 3, year: 12 }
const PERIODS_PER_YEAR = { month: 12, quarter: 4, year: 1 }
const cents = value => Math.round(value * 100) / 100

function addMonths(day, months) {
  const [year, month, date] = day.split('-').map(Number)
  const total = year * 12 + (month - 1) + months
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`
}

// The board of one asset: the acquisition line, then one line per period. Periods dated up to `postedUntil` are
// posted; a removed asset ends with a disposal line at `removedOn`. `lineId` keeps ids unique across assets.
function board(asset, profileRow, { postedUntil, removedOn }) {
  const base = cents(asset.purchase_value - asset.salvage_value)
  const periods = profileRow.method_number * PERIODS_PER_YEAR[profileRow.method_period]
  const step = STEP_MONTHS[profileRow.method_period]
  const draft = asset.state === 'draft'
  const lines = [{ type: 'create', date: asset.date_start, amount: base, depreciated_value: 0, remaining_value: base, posted: !draft, entry: null }]
  let accumulated = 0
  for (let index = 1; index <= periods; index += 1) {
    const date = addMonths(asset.date_start, index * step)
    if (removedOn && date > removedOn) break
    accumulated = index === periods ? base : cents(accumulated + base / periods)
    const amount = cents(accumulated - (lines.at(-1).depreciated_value))
    lines.push({ type: 'depreciate', date, amount, depreciated_value: accumulated, remaining_value: cents(base - accumulated), posted: !draft && date <= postedUntil, entry: null })
  }
  if (removedOn) {
    const last = lines.at(-1)
    lines.push({ type: 'remove', date: removedOn, amount: last.remaining_value, depreciated_value: base, remaining_value: 0, posted: true, entry: null })
  }
  return lines.map((line, index) => {
    const id = asset.id * 1000 + index + 1
    const entry = line.posted && line.type !== 'create' ? ref(900 + id, `MISC/${line.date.slice(0, 4)}/${String(id).slice(-4).padStart(4, '0')}`) : null
    return { id, ...line, entry }
  })
}

// [id, code, name, profile, purchase, salvage, start, state, partner, note, options]
const SOURCES = [
  [1, 'AST-001', 'لابتوبات الإدارة', 1, 12000, 0, '2025-11-01', 'open', TECH, 'عشرة أجهزة لفريق الإدارة.', {}],
  [2, 'AST-002', 'خوادم مركز البيانات', 1, 30000, 3000, '2023-06-01', 'close', TECH, '', {}],
  [3, 'AST-003', 'طاولات الاجتماعات', 2, 8500, 500, '2024-03-01', 'open', VENDOR, '', {}],
  [4, 'AST-004', 'كراسي مكتبية', 2, 4200, 0, '2026-10-01', 'draft', VENDOR, 'بانتظار استلام الدفعة الثانية.', {}],
  [5, 'AST-005', 'سيارة التوصيل', 3, 85000, 10000, '2025-07-01', 'open', null, '', {}],
  [6, 'AST-006', 'سيارة المدير العام', 3, 120000, 20000, '2026-11-01', 'draft', null, '', {}],
  [7, 'AST-007', 'طابعات الطابق الأول', 1, 6000, 0, '2024-02-01', 'removed', null, 'بيعت ضمن تحديث الأجهزة.', { removedOn: '2026-03-01' }],
  [8, 'AST-008', 'شاشات العرض', 1, 9600, 600, '2026-08-01', 'open', TECH, '', {}],
]

function buildAsset([id, code, name, profileId, purchase_value, salvage_value, date_start, state, partner, note, options]) {
  const profileRow = financeAssetProfiles.find(item => item.id === profileId)
  const summary = {
    id,
    name,
    code,
    state,
    profile: ref(profileRow.id, profileRow.name),
    partner,
    date_start,
    currency: CURRENCY,
    purchase_value,
    salvage_value,
    depreciation_base: cents(purchase_value - salvage_value),
    value_depreciated: 0,
    value_residual: 0,
  }
  const lines = board(summary, profileRow, { postedUntil: TODAY, ...options })
  const depreciated = lines.filter(line => line.posted && line.type === 'depreciate').reduce((sum, line) => cents(sum + line.amount), 0)
  summary.value_depreciated = depreciated
  summary.value_residual = state === 'removed' ? 0 : cents(summary.depreciation_base - depreciated)
  const { method, method_time, method_number, method_period, prorata } = profileRow
  return { ...summary, note, method, method_time, method_number, method_period, prorata, lines }
}

export const financeAssets = SOURCES.map(buildAsset)

const matches = (text, q) => !q || String(text ?? '').toLocaleLowerCase().includes(q.trim().toLocaleLowerCase())

function page(rows, url) {
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Number(url.searchParams.get('limit') ?? 50)
  const size = Number.isFinite(limit) && limit > 0 ? limit : 50
  return { items: rows.slice(offset, offset + size), total: rows.length }
}

function filterAssets(url) {
  const { searchParams } = url
  const profileId = Number(searchParams.get('profile_id') ?? 0)
  return financeAssets.filter(item => (!searchParams.get('state') || item.state === searchParams.get('state'))
    && (!profileId || item.profile.id === profileId)
    && (matches(item.name, searchParams.get('q')) || matches(item.code, searchParams.get('q'))))
}

const summary = ({ lines: _lines, note: _note, method: _method, method_time: _time, method_number: _number, method_period: _period, prorata: _prorata, ...rest }) => rest

export function financeAssetsPreviewData(path, url) {
  const route = String(path || '/').replace(/\/+$/, '') || '/'
  if (route === '/api/v1/finance/asset-profiles') return page(financeAssetProfiles, url)
  if (route === '/api/v1/finance/assets') return page(filterAssets(url).map(summary), url)
  const record = /^\/api\/v1\/finance\/assets\/(\d+)$/.exec(route)
  return record ? financeAssets.find(item => item.id === Number(record[1])) : undefined
}
