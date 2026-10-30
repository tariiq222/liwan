// Synthetic number-health, business-profile and report routes of the Customer Inbox UI mock (inbox-ui-preview-data.mjs
// delegates here). Deterministic and in memory; never reads or writes Odoo data. Every answer is shaped like
// packages/contracts/src/inbox (index.ts health/profile block and reports.ts); inboxMockContract.test.ts parses them.

const DAY = 86_400_000
const dayNumber = day => Date.parse(`${day}T00:00:00Z`) / DAY
const dayOf = number => new Date(number * DAY).toISOString().slice(0, 10)
const daysBetween = (from, to) => Array.from({ length: dayNumber(to) - dayNumber(from) + 1 }, (_, index) => dayOf(dayNumber(from) + index))
const hash = (seed) => {
  let x = Math.imul(seed ^ 0x9e3779b9, 2654435761) >>> 0
  x ^= x >>> 15
  x = Math.imul(x, 2246822519) >>> 0
  x ^= x >>> 13
  return (x >>> 0) / 4294967296
}
const PICTURE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="#2563eb"/><text x="96" y="118" font-size="84" text-anchor="middle" fill="#fff">A</text></svg>')}`
const VERTICALS = ['alcohol', 'apparel', 'auto', 'beauty', 'edu', 'entertain', 'event_plan', 'finance', 'govt', 'grocery', 'health', 'hotel', 'nonprofit', 'online_gambling', 'otc_drugs', 'other', 'physical_gambling', 'prof_services', 'restaurant', 'retail', 'travel']

/** The health block of a channel Meta has not reported on yet. */
export const emptyHealth = () => ({
  display_phone_number: null, verified_name: null, name_status: 'unknown', requested_name: null, name_rejection_reason: null, quality_rating: 'unknown',
  messaging_limit: 'unknown', throughput_level: 'unknown', code_verified: false, account_state: 'active', account_restricted_until: null, checked_at: null,
  template_insights_enabled: false, currency: null, analytics_synced_at: null, analytics_error: null,
})

export const seedHealth = ago => ({
  display_phone_number: '966500000000', verified_name: 'عيادة الأمل', name_status: 'approved', requested_name: null, name_rejection_reason: null, quality_rating: 'green',
  messaging_limit: 'tier_2k', throughput_level: 'standard', code_verified: true, account_state: 'active', account_restricted_until: null, checked_at: ago(1),
  template_insights_enabled: false, currency: 'USD', analytics_synced_at: ago(3), analytics_error: null,
})

/** Per-channel timeline and the profile Meta holds (the mock's stand-in for Meta). */
export function seedChannelExtras(channelIds, ago) {
  const alert = (id, kind, severity, hours, rest = {}) => ({
    id, kind, severity, occurred_at: ago(hours), quality_rating: null, messaging_limit: null, previous_messaging_limit: null, requested_name: null, reason: null, expires_at: null, ...rest,
  })
  return {
    alerts: new Map(channelIds.map(id => [id, [
      alert(3, 'name_rejected', 'danger', 30, { requested_name: 'عيادة الأمل للأسنان', reason: 'NAME_NOT_CONSISTENT' }),
      alert(2, 'quality_changed', 'warning', 80, { quality_rating: 'yellow' }),
      alert(1, 'messaging_limit_changed', 'info', 200, { messaging_limit: 'tier_2k', previous_messaging_limit: 'tier_250' }),
    ]])),
    profiles: new Map(channelIds.map(id => [id, {
      about: 'عيادة الأمل: رعاية أسنان لكل العائلة.', address: 'الرياض، طريق الملك فهد', description: 'نقدم خدمات الأسنان العامة والتجميلية بمواعيد مرنة.',
      email: 'info@clinic.example.test', websites: ['https://clinic.example.test'], vertical: 'health', picture_url: PICTURE,
    }])),
  }
}

// ---------------------------------------------------------------- number health and business profile

const PIN = /^\d{6}$/

function touchHealth(channel, now) {
  channel.health = { ...channel.health, checked_at: now }
}

export function channelHealthRoute(ctx, method, action, parts, url, body, channel) {
  const { ok, fail, iso, state, page } = ctx
  const extras = state.health
  const addAlert = (alert) => {
    const list = extras.alerts.get(channel.id) ?? []
    const id = Math.max(0, ...list.map(item => item.id)) + 1
    extras.alerts.set(channel.id, [{ id, occurred_at: iso(Date.now()), quality_rating: null, messaging_limit: null, previous_messaging_limit: null, requested_name: null, reason: null, expires_at: null, ...alert }, ...list])
  }
  if (action === 'alerts' && method === 'GET') return ok(page(extras.alerts.get(channel.id) ?? [], url))
  if (action === 'profile') {
    const profile = extras.profiles.get(channel.id)
    if (method === 'PUT' && parts[6] === 'picture') {
      if (!channel.app_id) return fail(422, 'invalid', 'يلزم معرّف تطبيق ميتا', 'app_id')
      if (!['image/jpeg', 'image/png'].includes(body.mimetype)) return fail(422, 'invalid', 'يجب أن تكون الصورة JPEG أو PNG', 'mimetype')
      const next = { ...profile, picture_url: PICTURE }
      extras.profiles.set(channel.id, next)
      return ok(next)
    }
    if (method === 'GET') return ok(profile)
    if (method === 'PATCH') {
      if ('about' in body && !String(body.about).trim()) return fail(422, 'invalid', 'النبذة مطلوبة', 'about')
      if (typeof body.about === 'string' && body.about.length > 139) return fail(422, 'invalid', 'النبذة أطول من 139 حرفًا', 'about')
      if (typeof body.description === 'string' && body.description.length > 512) return fail(422, 'invalid', 'الوصف أطول من 512 حرفًا', 'description')
      if (typeof body.address === 'string' && body.address.length > 256) return fail(422, 'invalid', 'العنوان أطول من 256 حرفًا', 'address')
      if (body.websites && (body.websites.length > 2 || body.websites.some(site => !/^https?:\/\/\S+$/.test(site)))) return fail(422, 'invalid', 'رابط غير صحيح', 'websites')
      if (body.vertical && !VERTICALS.includes(body.vertical)) return fail(422, 'invalid', 'مجال غير معروف', 'vertical')
      const next = { ...profile }
      for (const key of ['about', 'address', 'description', 'email', 'websites']) if (key in body) next[key] = body[key] === '' && key !== 'about' ? null : body[key]
      if ('vertical' in body) next.vertical = body.vertical
      extras.profiles.set(channel.id, next)
      return ok(next)
    }
    return undefined
  }
  if (method !== 'POST') return undefined
  if (action === 'display-name') {
    if (String(body.name ?? '').trim().length < 3) return fail(422, 'invalid', 'الاسم قصير', 'name')
    channel.health = { ...channel.health, name_status: 'pending_review', requested_name: body.name.trim(), name_rejection_reason: null }
    addAlert({ kind: 'name_pending', severity: 'info', requested_name: body.name.trim() })
    return ok(channel)
  }
  if (action === 'two-step-pin') return PIN.test(body.pin ?? '') ? { status: 204, body: undefined } : fail(422, 'invalid', 'الرمز ستة أرقام', 'pin')
  if (action === 'register') {
    if (!PIN.test(body.pin ?? '')) return fail(422, 'invalid', 'الرمز ستة أرقام', 'pin')
    touchHealth(channel, iso(Date.now()))
    return ok(channel)
  }
  if (action === 'template-insights') {
    channel.health = { ...channel.health, template_insights_enabled: true }
    return ok(channel)
  }
  if (action === 'analytics' && parts[6] === 'sync') {
    channel.health = { ...channel.health, analytics_synced_at: iso(Date.now()), analytics_error: null }
    return ok(channel)
  }
  return undefined
}

// ---------------------------------------------------------------- inbox metrics

const sum = (values, pick) => values.reduce((total, value) => total + pick(value), 0)

/** One local day of metrics for a slice of the inbox (`weight` 0..1 is its share of the whole), deterministic per day. */
function dayRow(day, weight, salt) {
  const n = dayNumber(day)
  const weekend = [5, 6].includes((new Date(n * DAY).getUTCDay() + 6) % 7) ? 0.45 : 1
  const r = key => hash(n * 97 + key + salt * 1009)
  const scale = (base, key) => Math.round(base * weekend * weight * (0.7 + r(key) * 0.6))
  const opened = scale(18, 1)
  const resolved = Math.min(opened + 2, scale(16, 2))
  const out = scale(70, 3)
  const automated = scale(34, 4)
  const responses = Math.min(opened, scale(15, 5))
  const buckets = [0.38, 0.22, 0.2, 0.1, 0.07, 0.03].map(share => Math.floor(responses * share))
  buckets[0] += responses - sum(buckets, value => value)
  const answers = Math.round(resolved * 0.4)
  const good = Math.round(answers * (0.6 + r(6) * 0.25))
  const bad = Math.round((answers - good) * 0.3)
  return {
    day, opened, resolved, autoClosed: scale(2, 7), in: scale(96, 8), out, automated, failed: scale(3, 9), templatesSent: scale(12, 10), templatesFailed: r(11) > 0.7 ? scale(2, 12) : 0,
    responses, responseSeconds: responses * Math.round(240 + r(13) * 900), buckets,
    resolutionCount: resolved, resolutionSeconds: resolved * Math.round(3600 + r(14) * 14_400), good, neutral: answers - good - bad, bad,
  }
}

function metricsOf(rows) {
  const total = key => sum(rows, row => row[key])
  const bucket = index => sum(rows, row => row.buckets[index])
  const csat = total('good') + total('neutral') + total('bad')
  const outbound = total('out') + total('automated')
  const responses = total('responses')
  const resolutions = total('resolutionCount')
  return {
    conversations_opened: total('opened'), conversations_resolved: total('resolved'), conversations_auto_closed: total('autoClosed'),
    messages_in: total('in'), messages_out: total('out'), messages_automated: total('automated'), messages_failed: total('failed'),
    templates_sent: total('templatesSent'), templates_failed: total('templatesFailed'),
    automated_share: outbound ? total('automated') / outbound : null,
    first_response: {
      count: responses, average_seconds: responses ? total('responseSeconds') / responses : null,
      buckets: { under_5m: bucket(0), under_15m: bucket(1), under_1h: bucket(2), under_4h: bucket(3), under_24h: bucket(4), over_24h: bucket(5) },
    },
    resolution: { count: resolutions, average_seconds: resolutions ? total('resolutionSeconds') / resolutions : null },
    csat: { good: total('good'), neutral: total('neutral'), bad: total('bad'), score: csat ? total('good') / csat : null },
  }
}

const mondayOf = day => dayOf(dayNumber(day) - ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7))
const monthOf = day => `${day.slice(0, 7)}-01`

function series(rows, granularity) {
  const key = granularity === 'day' ? day => day : granularity === 'week' ? mondayOf : monthOf
  const groups = new Map()
  for (const row of rows) groups.set(key(row.day), [...(groups.get(key(row.day)) ?? []), row])
  return [...groups].map(([start, group]) => {
    const metrics = metricsOf(group)
    return {
      start, messages_in: metrics.messages_in, messages_out: metrics.messages_out, messages_automated: metrics.messages_automated,
      conversations_opened: metrics.conversations_opened, conversations_resolved: metrics.conversations_resolved,
      first_response_average_seconds: metrics.first_response.average_seconds, resolution_average_seconds: metrics.resolution.average_seconds,
    }
  })
}

const SHARE_BY_ID = { agent: { 2: 0.1, 5: 0.35, 6: 0.3 }, department: { 1: 0.55, 2: 0.45 }, channel: { 1: 1 } }

function weightOf(filters) {
  let weight = 1
  if (filters.agent) weight *= SHARE_BY_ID.agent[filters.agent] ?? 0.1
  if (filters.department) weight *= SHARE_BY_ID.department[filters.department] ?? 0.5
  return weight
}

function filtersOf(url) {
  const number = name => Number(url.searchParams.get(name)) || null
  return { from: url.searchParams.get('from'), to: url.searchParams.get('to'), channel: number('channel_id'), department: number('department_id'), agent: number('agent_id') }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const rangeError = (ctx, filters, maxDays) => {
  if (!ISO.test(filters.from ?? '') || !ISO.test(filters.to ?? '')) return ctx.fail(422, 'invalid', 'from and to are required', 'from')
  const days = dayNumber(filters.to) - dayNumber(filters.from) + 1
  return days < 1 || days > maxDays ? ctx.fail(422, 'invalid', 'the range runs forward and covers a limited number of days', 'to') : null
}

function overview(ctx, url) {
  const filters = filtersOf(url)
  const refusal = rangeError(ctx, filters, 366)
  if (refusal) return refusal
  const unknown = (filters.channel && !ctx.state.channels.some(item => item.id === filters.channel)) || (filters.department && !ctx.state.departments.some(item => item.id === filters.department))
  if (unknown) return ctx.fail(404, 'not_found', 'not found')
  const days = daysBetween(filters.from, filters.to)
  const weight = weightOf(filters)
  const rowsOf = list => list.map(day => dayRow(day, weight, 0))
  const previousDays = daysBetween(dayOf(dayNumber(filters.from) - days.length), dayOf(dayNumber(filters.from) - 1))
  const granularity = days.length <= 62 ? 'day' : days.length <= 190 ? 'week' : 'month'
  return ctx.ok({
    from: filters.from, to: filters.to, granularity, timezone: ctx.state.hours.timezone,
    totals: metricsOf(rowsOf(days)), previous: metricsOf(rowsOf(previousDays)), series: series(rowsOf(days), granularity), computed_at: ctx.iso(Date.now() - 20 * 60_000),
  })
}

function breakdownRows(ctx, by, filters) {
  const days = daysBetween(filters.from, filters.to)
  const subjects = by === 'agent' ? [ctx.ME, ...ctx.AGENTS, null] : by === 'department' ? [...ctx.state.departments.map(({ id, name }) => ({ id, name })), null] : ctx.state.channels.map(({ id, name }) => ({ id, name }))
  const shares = SHARE_BY_ID[by]
  return subjects
    .map((subject, index) => {
      const share = subject ? shares[subject.id] ?? 0.1 : 0.08
      return { subject, metrics: metricsOf(days.map(day => dayRow(day, share * (filters.department && by !== 'department' ? SHARE_BY_ID.department[filters.department] ?? 0.5 : 1), index + 1))) }
    })
    .sort((a, b) => b.metrics.conversations_resolved - a.metrics.conversations_resolved)
}

function breakdown(ctx, url) {
  const filters = filtersOf(url)
  const by = url.searchParams.get('by')
  if (!['agent', 'department', 'channel'].includes(by)) return ctx.fail(422, 'invalid', 'by must be agent, department or channel', 'by')
  if (by === 'agent' && filters.agent) return ctx.fail(422, 'invalid', 'agent_id is not allowed with by=agent', 'agent_id')
  const refusal = rangeError(ctx, filters, 366)
  if (refusal) return refusal
  const items = breakdownRows(ctx, by, filters)
  return ctx.ok({ items, total: items.length })
}

function exportCsv(ctx, url) {
  const filters = filtersOf(url)
  const by = url.searchParams.get('by')
  if (!['agent', 'department', 'channel'].includes(by)) return ctx.fail(422, 'invalid', 'by must be agent, department or channel', 'by')
  const refusal = rangeError(ctx, filters, 366)
  if (refusal) return refusal
  const lines = breakdownRows(ctx, by, filters).map(row => `${row.subject?.name ?? ''},${row.metrics.conversations_resolved},${row.metrics.messages_out}`)
  return { file: { filename: `inbox-${by}.csv`, mime: 'text/csv; charset=utf-8', body: `﻿name,resolved,messages_out\n${lines.join('\n')}\n` } }
}

// ---------------------------------------------------------------- Meta cost and volume

const CATEGORIES = [['marketing', 'regular', 0.034], ['utility', 'regular', 0.012], ['authentication', 'regular', 0.009], ['service', 'free_customer_service', 0], ['service', 'free_entry_point', 0]]
const COUNTRIES = ['SA', 'AE', 'KW', 'EG']

function costs(ctx, url) {
  const filters = filtersOf(url)
  const refusal = rangeError(ctx, filters, 366)
  if (refusal) return refusal
  if (filters.channel && !ctx.state.channels.some(item => item.id === filters.channel)) return ctx.fail(404, 'not_found', 'not found')
  const days = daysBetween(filters.from, filters.to)
  const granularity = days.length <= 62 ? 'day' : days.length <= 190 ? 'week' : 'month'
  const perDay = days.map((day) => {
    const n = dayNumber(day)
    return CATEGORIES.map(([category, type, price], index) => {
      const volume = Math.round((8 + hash(n * 7 + index) * 40) * (index < 3 ? 1 : 3))
      return { day, category, type, volume, cost: Math.round(volume * price * 1e4) / 1e4 }
    })
  })
  const flat = perDay.flat()
  const rows = CATEGORIES.map(([category, type]) => {
    const group = flat.filter(row => row.category === category && row.type === type)
    return { category, type, volume: sum(group, row => row.volume), cost: Math.round(sum(group, row => row.cost) * 100) / 100 }
  })
  const paid = flat.filter(row => row.type === 'regular')
  const totalCost = Math.round(sum(flat, row => row.cost) * 100) / 100
  const channels = ctx.state.channels.filter(item => !filters.channel || item.id === filters.channel)
  return ctx.ok({
    from: filters.from, to: filters.to, granularity, currency: ctx.state.channels[0]?.health.currency ?? null,
    totals: { volume: sum(flat, row => row.volume), paid_volume: sum(paid, row => row.volume), free_volume: sum(flat.filter(row => row.type !== 'regular'), row => row.volume), cost: totalCost },
    by_category: rows,
    by_country: COUNTRIES.map((country, index) => {
      const share = [0.7, 0.15, 0.1, 0.05][index]
      return { country, volume: Math.round(sum(flat, row => row.volume) * share), cost: Math.round(totalCost * share * 100) / 100 }
    }),
    series: perDay.map((group, index) => ({
      start: days[index], volume: sum(group, row => row.volume), paid_volume: sum(group.filter(row => row.type === 'regular'), row => row.volume), cost: Math.round(sum(group, row => row.cost) * 100) / 100,
    })),
    channels: channels.map(item => ({ channel: { id: item.id, name: item.name }, synced_at: item.health.analytics_synced_at, error: item.health.analytics_error })),
  })
}

// ---------------------------------------------------------------- template analytics

function templateRow(template, filters) {
  const days = daysBetween(filters.from, filters.to)
  const points = days.map((day) => {
    const n = dayNumber(day)
    const sent = Math.round(hash(n * 13 + template.id) * 30)
    const delivered = Math.round(sent * 0.96)
    const read = Math.round(delivered * 0.7)
    return { start: day, sent, delivered, read, clicked: Math.round(read * 0.2) }
  })
  return {
    points,
    row: {
      template: { id: template.id, name: template.name, language: template.language, category: template.category },
      sent: sum(points, point => point.sent), delivered: sum(points, point => point.delivered), read: sum(points, point => point.read), clicked: sum(points, point => point.clicked),
      amount_spent: template.category === 'marketing' ? Math.round(sum(points, point => point.delivered) * 0.034 * 100) / 100 : null,
      webvue_sent: sum(points, point => point.sent) + 1, webvue_failed: template.status === 'rejected' ? 0 : template.id % 3 === 0 ? 2 : 0,
    },
  }
}

function templateList(ctx, url) {
  const filters = { from: url.searchParams.get('from'), to: url.searchParams.get('to'), channel: Number(url.searchParams.get('channel_id')) || null }
  if (!filters.channel) return ctx.fail(422, 'invalid', 'channel_id is required', 'channel_id')
  const refusal = rangeError(ctx, filters, 90)
  if (refusal) return refusal
  if (!ctx.state.channels.some(item => item.id === filters.channel)) return ctx.fail(404, 'not_found', 'not found')
  const items = ctx.state.templates.filter(template => template.status === 'approved' && template.supported).map(template => templateRow(template, filters).row)
  return ctx.ok({ items, total: items.length })
}

function templateDetail(ctx, id, url) {
  const filters = { from: url.searchParams.get('from'), to: url.searchParams.get('to') }
  const refusal = rangeError(ctx, filters, 90)
  if (refusal) return refusal
  const template = ctx.state.templates.find(item => item.id === id)
  if (!template) return ctx.fail(404, 'not_found', 'not found')
  const { points, row } = templateRow(template, filters)
  const { template: ref, ...totals } = row
  const buttons = (template.buttons ?? []).filter(button => button.type === 'quick_reply' || button.type === 'url').map(button => ({ type: button.type, text: button.text, clicked: Math.round(row.clicked / 2) }))
  return ctx.ok({ template: ref, from: filters.from, to: filters.to, totals, series: points, buttons })
}

export function reportsRoute(ctx, method, parts, url) {
  if (method !== 'GET') return undefined
  const [, , , , name, id] = parts
  if (name === 'overview') return overview(ctx, url)
  if (name === 'breakdown') return breakdown(ctx, url)
  if (name === 'export') return exportCsv(ctx, url)
  if (name === 'costs') return costs(ctx, url)
  if (name === 'templates') return id && /^\d+$/.test(id) ? templateDetail(ctx, Number(id), url) : templateList(ctx, url)
  return undefined
}
