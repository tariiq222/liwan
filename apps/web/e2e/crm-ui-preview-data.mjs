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
    price_above_list: 'managers',
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
  price_above_list: ['forbid', 'managers', 'everyone'],
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
    { id: 5, name: 'رقم خاطئ', effect: 'lost', lost_reason_id: null, active: true },
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

const USER_NAMES = { 2: 'Admin', 3: 'ليلى الحربي', 4: 'خالد الشمري' }
// Opportunities and their calls. Times are relative to the moment the mock starts (or resets), in the contract's UTC format.
const HOUR = 3_600_000
const iso = offsetHours => new Date(Math.round((Date.now() + offsetHours * HOUR) / 1000) * 1000).toISOString().replace('.000Z', 'Z')
// Seeded records fall on the last ten days, kept inside the current month so the month figures hold on its first days.
const seededCreatedAt = (id) => {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
  const at = Math.max(Date.now() - 24 * (10 - id) * HOUR, monthStart)
  return new Date(Math.round(at / 1000) * 1000).toISOString().replace('.000Z', 'Z')
}
const ref = (rows, id) => { const row = rows.find(item => item.id === id); return row ? { id: row.id, name: row.name } : null }
const mockUserRef = id => (id ? { id, name: USER_NAMES[id] ?? `#${id}` } : null)
const seedOpportunities = () => {
  const base = { email: '', lost_reason: null, package: null, list_price: 0, discount_percent: 0, final_price: 0, expected_revenue: 0, attempt_count: 0, next_call_at: null, cycle: 0, recycle_at: null, needs_manager: false, active: true, status: 'pending' }
  const row = (id, contact_name, phone, stageId, userId, sourceId, extra = {}) => ({ ...base, id, contact_name, phone, stage: ref(seedLists().stages, stageId), user: mockUserRef(userId), source: ref(seedLists().sources, sourceId), created_at: seededCreatedAt(id), ...extra })
  return [
    row(1, 'أحمد العتيبي', '0501234567', 1, 2, 1, { attempt_count: 1, next_call_at: iso(-3), email: 'ahmad@example.com' }),
    row(2, 'سارة القحطاني', '0507654321', 2, 2, 2, { attempt_count: 1, next_call_at: iso(20) }),
    row(3, 'محمد الدوسري', '0551112233', 3, 3, 1, { next_call_at: iso(48) }),
    row(4, 'نورة الزهراني', '0559988776', 1, null, 2),
    row(5, 'فهد الحربي', '0533344556', 4, 2, 1, { status: 'won', package: { id: 1, name: 'باقة أساسية' }, list_price: 120, discount_percent: 10, final_price: 108, expected_revenue: 108 }),
    row(6, 'ريم السبيعي', '0544455667', 1, 3, 1, { status: 'lost', active: false, lost_reason: { id: 1, name: 'غير مهتم' }, attempt_count: 1 }),
    row(7, 'عبدالله المطيري', '0566677889', 2, 4, 2, { attempt_count: 3, needs_manager: true }),
    row(8, 'هند الشهري', '0522200111', 3, 4, 1, { next_call_at: iso(-30) }),
  ]
}
const seedCalls = () => ({
  1: [{ id: 1, outcome: { id: 1, name: 'لا يرد' }, note: 'رنّ الهاتف ولم يُجب', duration_minutes: 0, user: mockUserRef(2), created_at: iso(-27) }],
  2: [{ id: 2, outcome: { id: 2, name: 'سيفكر' }, note: 'طلب مهلة حتى نهاية الأسبوع', duration_minutes: 4, user: mockUserRef(2), created_at: iso(-4) }],
  // A long history, newest first, to exercise the call log's paging.
  8: Array.from({ length: 45 }, (_, index) => ({ id: 100 + index, outcome: { id: 1, name: 'لا يرد' }, note: `محاولة رقم ${45 - index}`, duration_minutes: 0, user: mockUserRef(4), created_at: iso(-1 - index) })),
})

let settings = seedSettings()
let lists = seedLists()
let opportunities = seedOpportunities()
let calls = seedCalls()
let batches = []
let mappings = []
// When a won record was closed (the contract's opportunity has no such field); the seeded sale closed today, so the month figures hold on the first of a month.
const seedClosedAt = () => new Map([[5, iso(0)]])
let closedAt = seedClosedAt()

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

const page = (rows, url) => {
  const offset = Number(url.searchParams.get('offset') ?? 0)
  const limit = Number(url.searchParams.get('limit') ?? 20)
  return { items: rows.slice(offset, offset + limit), total: rows.length }
}
function filterOpportunities(url) {
  const param = name => url.searchParams.get(name)
  const q = (param('q') ?? '').trim().toLowerCase()
  const now = Date.now()
  const status = param('status') ?? 'open'
  return opportunities.filter(item => (status === 'all' || (status === 'open' ? item.status === 'pending' : item.status === status))
    && (status === 'lost' || status === 'all' || item.active)
    && (!param('stage_id') || item.stage?.id === Number(param('stage_id')))
    && (!param('user_id') || item.user?.id === Number(param('user_id')))
    && (!param('source_id') || item.source?.id === Number(param('source_id')))
    && (param('due') === null || (param('due') === 'true') === (item.next_call_at !== null && Date.parse(item.next_call_at) <= now))
    && (param('unassigned') === null || (param('unassigned') === 'true') === (item.user === null))
    && (param('needs_manager') === null || (param('needs_manager') === 'true') === item.needs_manager)
    && (!q || `${item.contact_name} ${item.phone} ${item.email}`.toLowerCase().includes(q)))
}

export function crmPreviewData(path, url) {
  if (path === '/api/v1/crm/settings') return dumpSettings()
  if (path === '/api/v1/crm/terms') return settings.values.terms
  const list = path.match(/^\/api\/v1\/crm\/(stages|outcomes|lost-reasons|sources|packages)$/)
  // `?active=all` is the settings page (archived rows too); without it only active rows are offered.
  if (list) return listPage(lists[list[1]].filter(row => url.searchParams.get('active') === 'all' || row.active))
  if (path === '/api/v1/crm/opportunities') return page(filterOpportunities(url), url)
  if (path === '/api/v1/crm/imports') return page(batches, url)
  if (path === '/api/v1/crm/import-mappings') return page(mappings, url)
  if (path === '/api/v1/crm/dashboard') return dashboard()
  const record = path.match(/^\/api\/v1\/crm\/opportunities\/(\d+)(\/calls)?$/)
  if (record) {
    const found = opportunities.find(item => item.id === Number(record[1]))
    if (!found) return undefined
    return record[2] ? page(calls[found.id] ?? [], url) : found
  }
  return undefined
}

export function crmPreviewWrite(method, path, body) {
  if (path === '/api/v1/__mock/reset-crm') {
    settings = seedSettings()
    lists = seedLists()
    opportunities = seedOpportunities()
    calls = seedCalls()
    batches = []
    mappings = []
    closedAt = seedClosedAt()
    return { status: 200, body: { reset: true } }
  }
  const opportunityWrite = crmOpportunityWrite(method, path, body)
  if (opportunityWrite) return opportunityWrite
  const importWrite = crmImportWrite(method, path, body)
  if (importWrite) return importWrite
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

const invalid = (field, message, reason) => ({ status: 422, body: { code: 'invalid', message, field, ...(reason && { details: { reason } }) } })
const closed = { status: 409, body: { code: 'conflict', message: 'the opportunity is closed' } }
const wonStage = () => lists.stages.find(stage => stage.is_won)
const firstStage = () => [...lists.stages].filter(stage => stage.active && !stage.is_won).sort((a, b) => a.sequence - b.sequence)[0]

function closeLost(lead, reasonId) {
  Object.assign(lead, { status: 'lost', active: false, lost_reason: ref(lists['lost-reasons'], reasonId), next_call_at: null })
}
function sell(lead, body) {
  const pack = lists.packages.find(item => item.id === body.package_id)
  if (!pack) return invalid('package_id', 'package does not exist')
  const discount = body.final_price < pack.price ? Math.round(((pack.price - body.final_price) * 100) / pack.price * 100) / 100 : 0
  if (body.discount_percent != null && Math.round(body.discount_percent * 100) / 100 !== discount) return invalid('discount_percent', 'the discount does not match the prices')
  if (discount > settings.values.discount_max_percent) return { status: 403, body: { code: 'forbidden', message: 'crm.discount.approve capability is required' } }
  closedAt.set(lead.id, iso(0))
  Object.assign(lead, {
    status: 'won', stage: ref(lists.stages, wonStage().id), package: { id: pack.id, name: pack.name }, list_price: pack.price,
    discount_percent: discount, final_price: body.final_price, expected_revenue: body.final_price, next_call_at: null, needs_manager: false,
  })
  return undefined
}
function followUp(lead) {
  const { followup_attempts: allowed, followup_interval_hours: hours, after_attempts: after } = settings.values
  lead.attempt_count += 1
  if (lead.attempt_count <= allowed) lead.next_call_at = iso(hours)
  else if (after === 'manager') Object.assign(lead, { next_call_at: null, needs_manager: true })
  else closeLost(lead, 2)
}

// The opportunity routes of the mock: they follow the server's rules (closed -> 409, duplicate phone -> 422,
// discount above the ceiling -> 403) and answer with the shapes of packages/contracts/src/crm.
function crmOpportunityWrite(method, path, body) {
  if (method === 'POST' && path === '/api/v1/crm/opportunities') {
    if (opportunities.some(item => item.phone === body.phone)) return invalid('phone', 'duplicate phone', 'duplicate_phone')
    const created = {
      id: Math.max(0, ...opportunities.map(item => item.id)) + 1, contact_name: body.contact_name, phone: body.phone, email: body.email ?? '',
      stage: ref(lists.stages, firstStage().id), user: mockUserRef('user_id' in body ? body.user_id : 2), source: ref(lists.sources, body.source_id),
      package: null, lost_reason: null, status: 'pending', list_price: 0, discount_percent: 0, final_price: 0, expected_revenue: 0, attempt_count: 0,
      next_call_at: null, cycle: 0, recycle_at: null, needs_manager: false, active: true, created_at: iso(0),
    }
    opportunities.unshift(created)
    return { status: 200, body: created }
  }
  const route = path.match(/^\/api\/v1\/crm\/opportunities\/(\d+)(?:\/(calls|won|lost|reopen|assign))?$/)
  if (!route) return undefined
  const lead = opportunities.find(item => item.id === Number(route[1]))
  if (!lead) return { status: 404, body: { code: 'not_found', message: 'Record does not exist' } }
  const action = route[2]
  if (method === 'PATCH' && !action) {
    if (lead.status !== 'pending') return closed
    if (body.phone && opportunities.some(item => item.id !== lead.id && item.phone === body.phone)) return invalid('phone', 'duplicate phone', 'duplicate_phone')
    const { stage_id: stageId, source_id: sourceId, ...plain } = body
    if (stageId && !lists.stages.some(stage => stage.id === stageId)) return invalid('stage_id', 'stage does not exist')
    if (stageId && lists.stages.find(stage => stage.id === stageId).is_won) return invalid('stage_id', 'an opportunity is won through the sale action')
    Object.assign(lead, plain)
    if (stageId) lead.stage = ref(lists.stages, stageId)
    if ('source_id' in body) lead.source = ref(lists.sources, sourceId)
    return { status: 200, body: lead }
  }
  if (method !== 'POST' || !action) return undefined
  if (action === 'reopen') {
    if (lead.status === 'won' || (lead.active && !lead.needs_manager)) return { status: 409, body: { code: 'conflict', message: 'only a lost or flagged opportunity can be reopened' } }
    Object.assign(lead, { status: 'pending', active: true, lost_reason: null, needs_manager: false, attempt_count: 0, next_call_at: null, cycle: lead.cycle + 1, stage: ref(lists.stages, firstStage().id) })
    return { status: 200, body: lead }
  }
  if (lead.status !== 'pending') return closed
  if (action === 'assign') {
    Object.assign(lead, { user: mockUserRef(body.user_id), attempt_count: 0, next_call_at: null, needs_manager: false })
    return { status: 200, body: lead }
  }
  if (action === 'lost') {
    if (!lists['lost-reasons'].some(reason => reason.id === body.lost_reason_id)) return invalid('lost_reason_id', 'lost reason does not exist')
    closeLost(lead, body.lost_reason_id)
    return { status: 200, body: lead }
  }
  if (action === 'won') return sell(lead, body) ?? { status: 200, body: lead }
  const outcome = lists.outcomes.find(item => item.id === body.outcome_id)
  if (!outcome) return invalid('outcome_id', 'outcome does not exist')
  const saleFields = body.package_id !== undefined
  if (saleFields && outcome.effect !== 'won') return invalid('package_id', 'only a sold outcome carries a package')
  const reasonId = body.lost_reason_id
  if (reasonId !== undefined && outcome.effect !== 'lost') return invalid('lost_reason_id', 'only a losing outcome carries a reason')
  if (reasonId !== undefined && !lists['lost-reasons'].some(reason => reason.id === reasonId && reason.active)) return invalid('lost_reason_id', 'lost reason does not exist')
  if (outcome.effect === 'lost' && !outcome.lost_reason_id && reasonId === undefined) return invalid('lost_reason_id', 'a losing outcome without a reason needs lost_reason_id')
  if (outcome.effect === 'won') {
    if (!saleFields) return invalid('package_id', 'a sold outcome needs a package and a final price')
    const refused = sell(lead, body)
    if (refused) return refused
  } else if (outcome.effect === 'lost') closeLost(lead, reasonId ?? outcome.lost_reason_id)
  else if (outcome.effect === 'follow_up') followUp(lead)
  const call = { id: Math.max(0, ...Object.values(calls).flat().map(item => item.id)) + 1, outcome: { id: outcome.id, name: outcome.name }, note: body.note ?? '', duration_minutes: body.duration_minutes ?? 0, user: mockUserRef(2), created_at: iso(0) }
  calls[lead.id] = [call, ...(calls[lead.id] ?? [])]
  return { status: 200, body: { call, opportunity: lead } }
}

// The dashboard of the mock user (id 2): his own block, and the manager block he holds every capability for.
// Counted from the opportunities, so a call recorded or a record imported in a spec moves the figures.
function dashboard() {
  const now = Date.now()
  const startOfDay = new Date().setHours(0, 0, 0, 0)
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
  const due = item => item.status === 'pending' && item.next_call_at !== null && Date.parse(item.next_call_at) <= now
  const thisMonth = item => Date.parse(item.created_at) >= startOfMonth
  const wonThisMonth = rows => {
    const won = rows.filter(item => item.status === 'won' && Date.parse(closedAt.get(item.id) ?? item.created_at) >= startOfMonth)
    return { count: won.length, value: won.reduce((sum, item) => sum + item.final_price, 0) }
  }
  const mine = opportunities.filter(item => item.user?.id === 2)
  const open = opportunities.filter(item => item.status === 'pending')
  const sources = [...lists.sources.map(source => ({ source_id: source.id, name: source.name })), { source_id: null, name: '' }]
  const agentIds = [...new Set(opportunities.filter(item => item.user).map(item => item.user.id))]
  // Conversion: records created this month per source (lost ones included) and the won among them.
  const created = source => opportunities.filter(item => thisMonth(item) && (item.source?.id ?? null) === source.source_id)
  return {
    agent: {
      due_now: mine.filter(due).length,
      new_today: mine.filter(item => Date.parse(item.created_at) >= startOfDay).length,
      won_this_month: wonThisMonth(mine),
    },
    manager: {
      unassigned: open.filter(item => item.user === null).length,
      needs_manager: open.filter(item => item.needs_manager).length,
      due_follow_ups: open.filter(due).length,
      won_this_month: wonThisMonth(opportunities),
      conversion_by_source: sources.map(source => ({ ...source, total: created(source).length, won: created(source).filter(item => item.status === 'won').length })).filter(source => source.total > 0),
      agents: agentIds.map(id => {
        const own = opportunities.filter(item => item.user?.id === id)
        return { user_id: id, name: USER_NAMES[id] ?? `#${id}`, open: own.filter(item => item.status === 'pending').length, won: wonThisMonth(own).count, due: own.filter(due).length }
      }),
    },
  }
}

// ----- imports: a tiny CSV reader and the rules of the intake service (phone, email, duplicates, mapping) -----
const fileExtension = /\.(csv|xlsx)$/i
function readRows(body) {
  const text = Buffer.from(body.content_base64 ?? '', 'base64').toString('utf8').replace(/^﻿/, '')
  const [header, ...lines] = text.split(/\r?\n/).filter(line => line.trim())
  if (!header) return undefined
  const columns = header.split(',').map(cell => cell.trim())
  return { columns, rows: lines.map(line => Object.fromEntries(line.split(',').map((cell, index) => [columns[index], cell.trim()]))) }
}
const phoneDigits = phone => phone.replace(/[\s-]/g, '').replace(/^(\+?966|0)/, '')
const validPhone = phone => /^(\+?966|0)?5\d{8}$/.test(phone.replace(/[\s-]/g, ''))

function judge(file, mapping) {
  const seen = new Set(opportunities.map(item => phoneDigits(item.phone)))
  return file.rows.map((row, index) => {
    const name = row[mapping.name] ?? ''
    const phone = row[mapping.phone] ?? ''
    const email = mapping.email ? (row[mapping.email] ?? '') : ''
    let reason = null
    if (!name) reason = 'missing_name'
    else if (!phone) reason = 'missing_phone'
    else if (!validPhone(phone)) reason = 'invalid_phone'
    else if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) reason = 'invalid_email'
    const duplicate = !reason && seen.has(phoneDigits(phone))
    if (!reason) seen.add(phoneDigits(phone))
    return { number: index + 2, name, phone, email, reason, duplicate }
  })
}

// Both import routes check what the server checks first: the file, the mapping (or a saved profile), the source, the agent.
function prepareImport(body) {
  if (!fileExtension.test(body.file_name ?? '')) return { refused: invalid('file_name', 'the file must be a .csv or .xlsx file') }
  const file = readRows(body)
  if (!file) return { refused: invalid('file', 'the file is empty') }
  if (Boolean(body.mapping) === Boolean(body.mapping_profile)) return { refused: invalid('mapping', 'send a mapping or a mapping profile') }
  const profile = body.mapping_profile ? mappings.find(item => item.id === body.mapping_profile) : undefined
  if (body.mapping_profile && !profile) return { refused: { status: 404, body: { code: 'not_found', message: 'Record does not exist' } } }
  const mapping = body.mapping ?? Object.fromEntries(Object.entries(profile.columns).filter(([, column]) => column))
  const missing = Object.values(mapping).find(column => !file.columns.includes(column))
  if (missing) return { refused: invalid('mapping', `column '${missing}' is not in the file`) }
  if (!lists.sources.some(source => source.id === body.source_id)) return { refused: invalid('source_id', 'an active source is required') }
  const onImport = settings.values.distribution_mode === 'on_import'
  if (!onImport && body.user_id) return { refused: invalid('user_id', 'an agent is chosen only when distribution is set to on import') }
  if (onImport && !body.user_id) return { refused: invalid('user_id', 'choose the agent who takes this batch') }
  if (onImport && !USER_NAMES[body.user_id]) return { refused: invalid('user_id', 'the chosen agent cannot take opportunities') }
  return { checked: judge(file, mapping) }
}

function previewOf(checked) {
  const bad = checked.filter(item => item.reason)
  const duplicates = checked.filter(item => item.duplicate)
  return { new: checked.length - bad.length - duplicates.length, duplicate: duplicates.length, invalid: bad.length, invalid_rows: bad.map(item => ({ row: item.number, reason: item.reason })), duplicate_rows: duplicates.map(item => item.number) }
}

function commitImport(body, checked) {
  const agentId = body.user_id ?? (settings.values.distribution_mode === 'round_robin' ? settings.values.distribution_user_ids[0] ?? null : null)
  const fresh = checked.filter(item => !item.reason && !item.duplicate)
  let nextId = Math.max(0, ...opportunities.map(item => item.id))
  for (const item of fresh) {
    nextId += 1
    opportunities.unshift({
      id: nextId, contact_name: item.name, phone: item.phone, email: item.email, stage: ref(lists.stages, firstStage().id), user: mockUserRef(agentId),
      source: ref(lists.sources, body.source_id), package: null, lost_reason: null, status: 'pending', list_price: 0, discount_percent: 0, final_price: 0,
      expected_revenue: 0, attempt_count: 0, next_call_at: null, cycle: 0, recycle_at: null, needs_manager: false, active: true, created_at: iso(0),
    })
  }
  const batch = {
    id: Math.max(0, ...batches.map(item => item.id)) + 1, file_name: body.file_name, user: mockUserRef(2), source: ref(lists.sources, body.source_id),
    created: fresh.length, duplicate: checked.filter(item => item.duplicate).length, invalid: checked.filter(item => item.reason).length,
    unassigned: agentId ? 0 : fresh.length, created_at: iso(0),
  }
  batches.unshift(batch)
  return batch
}

function crmImportWrite(method, path, body) {
  if (method === 'POST' && path === '/api/v1/crm/imports/columns') {
    if (!fileExtension.test(body.file_name ?? '')) return invalid('file_name', 'the file must be a .csv or .xlsx file')
    const file = readRows(body)
    if (!file) return invalid('file', 'the file is empty')
    if (!file.rows.length) return invalid('file', 'the file has no rows')
    return { status: 200, body: { columns: file.columns, rows: file.rows.length } }
  }
  if (method === 'POST' && (path === '/api/v1/crm/imports/preview' || path === '/api/v1/crm/imports')) {
    const prepared = prepareImport(body)
    if (prepared.refused) return prepared.refused
    return { status: 200, body: path.endsWith('/preview') ? previewOf(prepared.checked) : commitImport(body, prepared.checked) }
  }
  if (method === 'POST' && path === '/api/v1/crm/import-mappings') {
    if (mappings.some(item => item.name === body.name)) return { status: 409, body: { code: 'conflict', message: 'a mapping profile with this name already exists', field: 'name' } }
    const { name, phone, email = null, notes = null, package: pack = null } = body.columns
    const created = { id: Math.max(0, ...mappings.map(item => item.id)) + 1, name: body.name, columns: { name, phone, email, notes, package: pack } }
    mappings.push(created)
    return { status: 200, body: created }
  }
  const profile = path.match(/^\/api\/v1\/crm\/import-mappings\/(\d+)$/)
  if (method === 'DELETE' && profile) {
    const found = mappings.find(item => item.id === Number(profile[1]))
    if (!found) return { status: 404, body: { code: 'not_found', message: 'Record does not exist' } }
    mappings = mappings.filter(item => item !== found)
    return { status: 200, body: found }
  }
  return undefined
}
