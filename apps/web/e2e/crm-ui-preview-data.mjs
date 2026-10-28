// Synthetic CRM for the isolated mock (MODULE_UI_PREVIEW=1): the settings, the terms and the five settings lists.
// Shapes follow packages/contracts/src/crm. It keeps state, so the settings page can save against it; POST
// /api/v1/__mock/reset-crm restores the seeds between spec runs. Revision conflicts answer 409 like the server.
const seedSettings = () => ({
  revision: 0,
  values: {
    preset: 'phone_packages',
    followup_attempts: 2,
    followup_interval_hours: 24,
    after_attempts: 'lost',
    recycle_enabled: true,
    recycle_after_days: 30,
    recycle_cycles: 1,
    distribution_mode: 'round_robin',
    distribution_user_ids: [2],
    visibility: 'own',
    view_log_enabled: false,
    discount_allowed: true,
    discount_max_percent: 10,
    terms: {
      customer: { ar: { singular: 'عميل', plural: 'عملاء' }, en: { singular: 'customer', plural: 'customers' }, gender: 'm' },
      opportunity: { ar: { singular: 'فرصة', plural: 'فرص' }, en: { singular: 'opportunity', plural: 'opportunities' }, gender: 'f' },
      package: { ar: { singular: 'باقة', plural: 'باقات' }, en: { singular: 'plan', plural: 'plans' }, gender: 'f' },
    },
  },
})
const OPTIONS = {
  preset: ['general', 'phone_packages'],
  after_attempts: ['lost', 'manager'],
  distribution_mode: ['round_robin', 'manual', 'on_import'],
  visibility: ['own', 'team', 'all'],
  term_gender: ['m', 'f'],
  followup_attempts: { min: 0, max: 10 },
  followup_interval_hours: { min: 1, max: 720 },
  recycle_after_days: { min: 1, max: 365 },
  recycle_cycles: { min: 0, max: 5 },
  discount_max_percent: { min: 0, max: 100 },
}
const PRESETS = {
  general: { followup_attempts: 0, distribution_mode: 'manual' },
  phone_packages: { followup_attempts: 2, followup_interval_hours: 24, after_attempts: 'lost', distribution_mode: 'round_robin', visibility: 'own', discount_allowed: true, discount_max_percent: 10 },
}
const seedLists = () => ({
  stages: [
    { id: 1, name: 'جديد', sequence: 10, is_won: false, active: true },
    { id: 2, name: 'تم التواصل', sequence: 20, is_won: false, active: true },
    { id: 3, name: 'مهتم', sequence: 30, is_won: false, active: true },
    { id: 4, name: 'تم البيع', sequence: 40, is_won: true, active: true },
  ],
  outcomes: [
    { id: 1, name: 'لا يرد', effect: 'follow_up', lost_reason_id: null, active: true },
    { id: 2, name: 'سيفكر', effect: 'follow_up', lost_reason_id: null, active: true },
    { id: 3, name: 'تم البيع', effect: 'won', lost_reason_id: null, active: true },
    { id: 4, name: 'غير مهتم', effect: 'lost', lost_reason_id: 1, active: true },
  ],
  'lost-reasons': [
    { id: 1, name: 'غير مهتم', active: true, protected: false },
    { id: 2, name: 'استنفاد محاولات الاتصال', active: true, protected: true },
  ],
  sources: [
    { id: 1, name: 'الموقع', active: true },
    { id: 2, name: 'معرض', active: true },
  ],
  packages: [
    { id: 1, name: 'باقة أساسية', price: 120, description: 'مكالمات محدودة', active: true },
    { id: 2, name: 'باقة متقدمة', price: 280, description: 'مكالمات غير محدودة', active: true },
  ],
})

let settings = seedSettings()
let lists = seedLists()

const USER_NAMES = { 2: 'Admin', 3: 'ليلى الحربي', 4: 'خالد الشمري' }
const dumpSettings = () => ({
  values: settings.values,
  distribution_users: settings.values.distribution_user_ids.map(id => ({ id, name: USER_NAMES[id] ?? `#${id}` })),
  options: OPTIONS,
  revision: settings.revision,
})
const listPage = rows => ({ items: rows, total: rows.length })
const stale = { status: 409, body: { code: 'conflict', message: 'CRM settings changed; reload before saving' } }
const merge = (base, patch) => Object.fromEntries(Object.entries(base).map(([key, value]) => [
  key,
  patch[key] === undefined ? value : (value && typeof value === 'object' && !Array.isArray(value) ? merge(value, patch[key]) : patch[key]),
]))

export function crmPreviewData(path) {
  if (path === '/api/v1/crm/settings') return dumpSettings()
  if (path === '/api/v1/crm/terms') return settings.values.terms
  const list = path.match(/^\/api\/v1\/crm\/(stages|outcomes|lost-reasons|sources|packages)$/)
  if (list) return listPage([...lists[list[1]]])
  return undefined
}

export function crmPreviewWrite(method, path, body) {
  if (path === '/api/v1/__mock/reset-crm') {
    settings = seedSettings()
    lists = seedLists()
    return { status: 200, body: { reset: true } }
  }
  if (method === 'PATCH' && path === '/api/v1/crm/settings') {
    if (body.revision !== settings.revision) return stale
    const values = body.preset ? { ...PRESETS[body.preset], preset: body.preset } : body.values
    settings = { revision: settings.revision + 1, values: merge(settings.values, values) }
    return { status: 200, body: dumpSettings() }
  }
  const stagesOrder = path === '/api/v1/crm/stages/order'
  if (method === 'POST' && stagesOrder) {
    lists.stages = body.ids.map((id, index) => ({ ...lists.stages.find(stage => stage.id === id), sequence: (index + 1) * 10 }))
      .concat(lists.stages.filter(stage => !body.ids.includes(stage.id)))
    return { status: 200, body: listPage(lists.stages) }
  }
  const row = path.match(/^\/api\/v1\/crm\/(stages|outcomes|lost-reasons|sources|packages)(?:\/(\d+))?$/)
  if (!row) return undefined
  const rows = lists[row[1]]
  if (method === 'POST' && !row[2]) {
    const created = { id: Math.max(0, ...rows.map(item => item.id)) + 1, active: true, ...(row[1] === 'stages' ? { sequence: (rows.length + 1) * 10, is_won: false } : {}), ...(row[1] === 'outcomes' ? { lost_reason_id: null } : {}), ...(row[1] === 'lost-reasons' ? { protected: false } : {}), ...(row[1] === 'packages' ? { description: '' } : {}), ...body }
    rows.push(created)
    return { status: 200, body: created }
  }
  const target = rows.find(item => item.id === Number(row[2]))
  if (method === 'PATCH' && target) {
    if (body.is_won) rows.forEach(item => { item.is_won = false })
    Object.assign(target, body)
    return { status: 200, body: target }
  }
  return undefined
}
