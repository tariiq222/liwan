// Synthetic campaign, audience, consent and sending-health routes of the Customer Inbox UI mock
// (inbox-ui-preview-data.mjs delegates here). Deterministic and in memory; never reads or writes Odoo data. Every answer
// is shaped like packages/contracts/src/inbox/campaigns.ts; inboxMockContract.test.ts parses them.
// A running campaign moves on every read of its detail, so the page's 10 second polling shows the stats climb.

const HOUR = 3_600_000
const DAY = 24 * HOUR
const EXTRA_CONTACTS = [
  [11, 'عبدالله المطيري', '+966500000011'], [12, 'هند الزهراني', '+966500000012'], [13, 'سلطان الحربي', '+966500000013'],
  [14, 'ريم العنزي', '+966500000014'], [15, 'ماجد القرني', '+966500000015'], [16, 'لمى السبيعي', '+966500000016'],
  [17, 'بدر الغامدي', '+966500000017'], [18, 'أمل الشهري', '+966500000018'],
].map(([id, name, phone]) => ({ id, name, phone, email: null }))
const CONTACT_TAGS = [[1, [2]], [2, [3]], [3, [1, 3]], [4, []], [11, [2]], [12, [2, 3]], [13, [3]], [14, [2]], [15, []], [16, [2]], [17, [3]], [18, [2, 3]]]
const STOP_KEYWORDS = ['إيقاف', 'إلغاء الاشتراك', 'إيقاف العروض', 'stop', 'unsubscribe', 'stop promotions']
const START_KEYWORDS = ['اشتراك', 'start', 'subscribe']
const PHONE = /^\+?\d{8,15}$/

export function seedCampaigns(ago) {
  const event = (state, source, note, hours, author = null) => ({ state, source, note, author, at: ago(hours) })
  const consent = new Map([
    [1, [event('opted_in', 'agent', 'نموذج الموقع الإلكتروني', 200, { id: 2, name: 'Admin' })]],
    [2, [event('opted_in', 'import', 'قائمة العيادة', 300), event('opted_out', 'keyword', null, 20)]],
    [11, [event('opted_in', 'import', 'قائمة العيادة', 300)]],
    [12, [event('opted_in', 'import', 'قائمة العيادة', 300)]],
    [13, [event('opted_in', 'agent', 'طلب في العيادة', 100, { id: 2, name: 'Admin' })]],
    [14, [event('opted_in', 'import', 'قائمة العيادة', 300)]],
    [16, [event('opted_in', 'import', 'قائمة العيادة', 300), event('opted_out', 'whatsapp', null, 10)]],
  ])
  const audiences = [
    { id: 1, name: 'عملاء الحجز', tag_ids: [2], tag_match: 'any', exclude_tag_ids: [], active_within_days: 0, created_at: ago(400) },
    { id: 2, name: 'الاستفسارات النشطة', tag_ids: [3], tag_match: 'any', exclude_tag_ids: [1], active_within_days: 90, created_at: ago(300) },
  ]
  const state = {
    audiences, consent, campaigns: [], recipients: new Map(), uploads: new Map(),
    contactTags: new Map(CONTACT_TAGS), extraContacts: [...EXTRA_CONTACTS],
    settings: {
      consent_policy: 'opted_in_only', default_country_code: '966', keyword_opt_out: true, stop_keywords: [...STOP_KEYWORDS], start_keywords: [...START_KEYWORDS],
      stop_reply: 'تم إيقاف رسائل العروض عنك. أرسل «اشتراك» لإعادتها.', start_reply: 'أهلًا بعودتك، سنرسل لك عروضنا.', default_daily_cap: 0,
    },
    sending: new Map([[1, {
      channel_id: 1, messaging_limit: 'tier_2k', quality_rating: 'green', used_24h: 340, remaining_24h: 1660, marketing_api: 'cloud_api', marketing_onboarding: 'eligible', checked_at: ago(1),
    }]]),
    ids: { audience: 3, campaign: 4, upload: 500, consentEvent: 1 },
  }
  return state
}

export function campaignsRoute(ctx, method, parts, url, body) {
  const { state, ok, fail, iso, page, ME } = ctx
  const data = state.campaignData
  const resource = parts[3]
  const id = parts[4] && /^\d+$/.test(parts[4]) ? Number(parts[4]) : undefined
  const tagRef = tagId => state.tags.find(tag => tag.id === tagId)
  const tagRefs = ids => ids.map(tagRef).filter(Boolean).map(tag => ({ id: tag.id, name: tag.name }))
  const people = () => [...state.contacts, ...data.extraContacts]
  const personOf = contactId => people().find(item => item.id === contactId)
  const tagsOf = contactId => data.contactTags.get(contactId) ?? []
  const events = contactId => [...(data.consent.get(contactId) ?? [])].sort((a, b) => b.at.localeCompare(a.at))
  const consentOf = (contactId) => {
    const newest = events(contactId)[0]
    return newest ? newest.state : 'unknown'
  }
  const addEvent = (contactId, entry) => data.consent.set(contactId, [...(data.consent.get(contactId) ?? []), { author: null, note: null, ...entry, at: iso(Date.now()) }])
  const reachable = contactId => (data.settings.consent_policy === 'opted_in_only' ? consentOf(contactId) === 'opted_in' : consentOf(contactId) !== 'opted_out') && !!personOf(contactId)?.phone

  // ---------------------------------------------------------------- audiences
  const matches = (audience, contactId) => {
    const own = tagsOf(contactId)
    const included = !audience.tag_ids.length || (audience.tag_match === 'all' ? audience.tag_ids.every(tag => own.includes(tag)) : audience.tag_ids.some(tag => own.includes(tag)))
    return included && !audience.exclude_tag_ids.some(tag => own.includes(tag))
  }
  const membersOf = audience => people().filter(person => matches(audience, person.id))
  const audienceOut = audience => ({
    id: audience.id, name: audience.name, tags: tagRefs(audience.tag_ids), tag_match: audience.tag_match, exclude_tags: tagRefs(audience.exclude_tag_ids),
    active_within_days: audience.active_within_days, contact_count: membersOf(audience).length, reachable_count: membersOf(audience).filter(person => reachable(person.id)).length, created_at: audience.created_at,
  })
  const audienceInput = (input, current) => {
    const name = (input.name ?? current?.name ?? '').trim()
    if (!name) return fail(422, 'invalid', 'الاسم مطلوب', 'name')
    if (data.audiences.some(item => item.id !== current?.id && item.name === name)) return fail(422, 'invalid', 'اسم الجمهور مستخدم', 'name')
    const days = input.active_within_days ?? current?.active_within_days ?? 0
    if (!Number.isInteger(days) || days < 0 || days > 3650) return fail(422, 'invalid', 'عدد الأيام غير صالح', 'active_within_days')
    return {
      id: current?.id ?? data.ids.audience++, name, tag_ids: input.tag_ids ?? current?.tag_ids ?? [], tag_match: input.tag_match ?? current?.tag_match ?? 'any',
      exclude_tag_ids: input.exclude_tag_ids ?? current?.exclude_tag_ids ?? [], active_within_days: days, created_at: current?.created_at ?? iso(Date.now()),
    }
  }
  if (resource === 'audiences') {
    if (id === undefined) {
      if (method === 'GET') {
        const q = (url.searchParams.get('q') ?? '').trim()
        return ok(page(data.audiences.filter(item => !q || item.name.includes(q)).map(audienceOut), url))
      }
      if (method !== 'POST') return undefined
      const made = audienceInput(body)
      if (made.status) return made
      data.audiences.push(made)
      return { status: 201, body: audienceOut(made) }
    }
    const audience = data.audiences.find(item => item.id === id)
    if (!audience) return fail(404, 'not_found', 'not found')
    if (parts[5] === 'members' && method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').trim()
      const wanted = url.searchParams.get('consent')
      const rows = membersOf(audience)
        .filter(person => (!q || person.name.includes(q) || (person.phone ?? '').includes(q)) && (!wanted || consentOf(person.id) === wanted))
        .map(person => ({ id: person.id, name: person.name, phone: person.phone, consent: consentOf(person.id), tags: tagRefs(tagsOf(person.id)) }))
      return ok(page(rows, url))
    }
    if (method === 'GET') return ok(audienceOut(audience))
    if (method === 'PATCH') {
      const made = audienceInput(body, audience)
      if (made.status) return made
      Object.assign(audience, made)
      return ok(audienceOut(audience))
    }
    if (method === 'DELETE') {
      if (data.campaigns.some(item => item.audience_id === id)) return fail(422, 'invalid', 'الجمهور مستخدم في حملة')
      data.audiences.splice(data.audiences.indexOf(audience), 1)
      return { status: 204, body: undefined }
    }
    return undefined
  }

  // ---------------------------------------------------------------- contact consent and import
  if (resource === 'contacts' && parts[4] === 'import' && method === 'POST') return importContacts(body)
  if (resource === 'contacts' && id !== undefined && parts[5] === 'marketing') {
    const person = personOf(id)
    if (!person) return fail(404, 'not_found', 'not found')
    if (method === 'PATCH') {
      if (body.consent) {
        if (body.consent.state === 'opted_in' && !String(body.consent.note ?? '').trim()) return fail(422, 'invalid', 'دليل الموافقة مطلوب', 'consent')
        addEvent(id, { state: body.consent.state, source: 'agent', note: body.consent.note ?? null, author: ME })
      }
      if (body.tag_ids) data.contactTags.set(id, body.tag_ids)
    }
    const newest = events(id)[0]
    return ok({
      contact_id: id, consent: consentOf(id), consent_at: newest?.at ?? null, consent_source: newest?.source ?? null, tags: tagRefs(tagsOf(id)), history: events(id).slice(0, 20),
    })
  }
  function importContacts(input) {
    if (input.consent === 'opted_in' && !String(input.consent_note ?? '').trim()) return fail(422, 'invalid', 'دليل الموافقة مطلوب', 'consent_note')
    const text = Buffer.from(String(input.data ?? ''), 'base64').toString('utf8').replace(/^﻿/, '')
    const [header, ...lines] = text.split(/\r?\n/).filter(line => line.trim())
    const columns = (header ?? '').split(',').map(cell => cell.trim().toLowerCase())
    if (!columns.includes('phone')) return fail(422, 'invalid', 'العمود phone مطلوب', 'data')
    const result = { created: 0, updated: 0, skipped: 0, errors: [] }
    lines.forEach((line, index) => {
      const cells = line.split(',').map(cell => cell.trim())
      const row = Object.fromEntries(columns.map((column, position) => [column, cells[position] ?? '']))
      const digits = row.phone.replace(/[^\d+]/g, '')
      const phone = digits.startsWith('0') && data.settings.default_country_code ? `+${data.settings.default_country_code}${digits.slice(1)}` : digits.startsWith('+') ? digits : `+${digits}`
      if (!PHONE.test(phone)) {
        result.skipped += 1
        if (result.errors.length < 50) result.errors.push({ line: index + 2, message: 'رقم الجوال غير صالح' })
        return
      }
      let person = people().find(item => item.phone === phone)
      if (person) result.updated += 1
      else {
        person = { id: 100 + data.extraContacts.length, name: row.name || phone, phone, email: null }
        data.extraContacts.push(person)
        result.created += 1
      }
      data.contactTags.set(person.id, [...new Set([...tagsOf(person.id), ...input.tag_ids])])
      if (input.consent === 'opted_in' && consentOf(person.id) !== 'opted_out') addEvent(person.id, { state: 'opted_in', source: 'import', note: input.consent_note })
    })
    return ok(result)
  }

  // ---------------------------------------------------------------- channel sending
  if (resource === 'channels' && id !== undefined && parts[5] === 'sending') {
    const sending = data.sending.get(id)
    if (!sending) return fail(404, 'not_found', 'not found')
    if (method === 'PATCH') {
      if (!['cloud_api', 'marketing_messages'].includes(body.marketing_api)) return fail(422, 'invalid', 'واجهة غير معروفة', 'marketing_api')
      sending.marketing_api = body.marketing_api
    }
    if (method === 'POST' && parts[6] === 'refresh') data.sending.set(id, { ...sending, checked_at: iso(Date.now()) })
    return ok(data.sending.get(id))
  }

  // ---------------------------------------------------------------- campaign settings
  if (parts[2] === 'settings') {
    if (method === 'PATCH') {
      const next = { ...data.settings, ...body }
      if (next.default_country_code !== null && !/^[1-9]\d{0,2}$/.test(String(next.default_country_code))) return fail(422, 'invalid', 'مفتاح الدولة غير صالح', 'default_country_code')
      Object.assign(data.settings, next)
    }
    return ok(data.settings)
  }

  // ---------------------------------------------------------------- campaigns
  if (resource !== 'campaigns') return undefined
  const templateOf = templateId => state.templates.find(item => item.id === templateId)
  const slots = (template) => {
    const rows = []
    if (template.header?.type === 'text' && /\{\{1\}\}/.test(template.header.text)) rows.push({ location: 'header', position: 1 })
    for (let position = 1; position <= template.param_count; position += 1) rows.push({ location: 'body', position })
    template.buttons.forEach((button, index) => { if (button.type === 'copy_code' || (button.type === 'url' && button.url.endsWith('{{1}}'))) rows.push({ location: 'button', position: index }) })
    return rows
  }
  const recipientsOf = campaignId => data.recipients.get(campaignId) ?? []
  const statsOf = (campaignId) => {
    const rows = recipientsOf(campaignId)
    const count = value => rows.filter(row => row.state === value).length
    return {
      total: rows.length, pending: count('pending'), skipped: count('skipped'), queued: count('queued'), sent: count('sent'), delivered: count('delivered'), read: count('read'), failed: count('failed'),
      replied: rows.filter(row => row.replied_at).length, unsubscribed: rows.filter(row => row.unsubscribed_at).length, held: 0,
    }
  }
  const campaignOut = (campaign) => {
    const template = templateOf(campaign.template_id)
    const stats = statsOf(campaign.id)
    return {
      id: campaign.id, name: campaign.name, state: campaign.state, pause_reason: campaign.pause_reason, pause_detail: campaign.pause_detail,
      waiting: campaign.state === 'scheduled' ? 'schedule' : null,
      channel: { id: campaign.channel_id, name: state.channels.find(item => item.id === campaign.channel_id)?.name ?? '' },
      template: template ? { id: template.id, name: template.name, language: template.language, category: template.category } : null,
      audience: { id: campaign.audience_id, name: data.audiences.find(item => item.id === campaign.audience_id)?.name ?? '' },
      params: campaign.params, header_attachment: data.uploads.get(campaign.header_attachment_id) ?? null, scheduled_at: campaign.scheduled_at, send_within_hours: campaign.send_within_hours, daily_cap: campaign.daily_cap,
      launched_at: campaign.launched_at, launched_by: campaign.launched_at ? ME : null, completed_at: campaign.completed_at, stats,
      can_edit: ['draft', 'scheduled', 'paused'].includes(campaign.state), can_delete: ['draft', 'scheduled'].includes(campaign.state), created_at: campaign.created_at,
    }
  }
  const problem = (field, message) => fail(422, 'invalid', message, field)
  function validate(input, current) {
    const merged = { ...current, ...input }
    if (!String(merged.name ?? '').trim()) return problem('name', 'الاسم مطلوب')
    if (!state.channels.some(item => item.id === merged.channel_id)) return problem('channel_id', 'القناة غير موجودة')
    const template = templateOf(merged.template_id)
    if (!template || template.status !== 'approved' || !template.supported) return problem('template_id', 'القالب غير معتمد')
    if (template.category === 'authentication') return problem('template_id', 'قوالب التوثيق لا تُستعمل في الحملات')
    if (template.header?.type === 'location') return problem('template_id', 'قوالب الموقع لا تُستعمل في الحملات')
    if (!data.audiences.some(item => item.id === merged.audience_id)) return problem('audience_id', 'الجمهور غير موجود')
    const needs = slots(template).map(slot => `${slot.location}:${slot.position}`).sort().join()
    if ((merged.params ?? []).map(param => `${param.location}:${param.position}`).sort().join() !== needs) return problem('params', 'متغيرات القالب غير مطابقة')
    if ((merged.params ?? []).some(param => param.source === 'static' && !param.value)) return problem('params', 'المتغير الثابت يحتاج نصًا')
    if (merged.scheduled_at && Date.parse(merged.scheduled_at) < Date.now()) return problem('scheduled_at', 'وقت البدء في الماضي')
    return null
  }
  const campaignInput = (input, current) => ({
    id: current?.id ?? data.ids.campaign++, name: String(input.name ?? current.name).trim(), channel_id: input.channel_id ?? current.channel_id, template_id: input.template_id ?? current.template_id,
    audience_id: input.audience_id ?? current.audience_id, params: input.params ?? current.params, header_attachment_id: 'header_attachment_id' in input ? input.header_attachment_id : current?.header_attachment_id ?? null,
    scheduled_at: 'scheduled_at' in input ? input.scheduled_at : current?.scheduled_at ?? null, send_within_hours: input.send_within_hours ?? current?.send_within_hours ?? false,
    daily_cap: input.daily_cap ?? current?.daily_cap ?? 0, state: current?.state ?? 'draft', pause_reason: current?.pause_reason ?? null, pause_detail: current?.pause_detail ?? null,
    launched_at: current?.launched_at ?? null, completed_at: current?.completed_at ?? null, created_at: current?.created_at ?? iso(Date.now()),
  })

  if (id === undefined && parts[4] === 'uploads' && method === 'POST') {
    const attachment = { id: data.ids.upload++, name: body.name, mimetype: body.mimetype, size: Math.floor(String(body.data ?? '').length * 0.75) }
    data.uploads.set(attachment.id, attachment)
    return { status: 201, body: attachment }
  }
  if (id === undefined && parts[4] === 'preview' && method === 'POST') return preview(body)
  if (id === undefined) {
    if (method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').trim()
      const wanted = { state: url.searchParams.get('state'), channel: Number(url.searchParams.get('channel_id')) || null }
      const rows = data.campaigns.filter(item => (!q || item.name.includes(q)) && (!wanted.state || item.state === wanted.state) && (!wanted.channel || item.channel_id === wanted.channel)).map(campaignOut)
      return ok(page(rows, url))
    }
    if (method !== 'POST') return undefined
    const refusal = validate(body)
    if (refusal) return refusal
    const made = campaignInput(body)
    data.campaigns.unshift(made)
    data.recipients.set(made.id, [])
    return { status: 201, body: campaignOut(made) }
  }

  const campaign = data.campaigns.find(item => item.id === id)
  if (!campaign) return fail(404, 'not_found', 'not found')
  const action = parts[5]
  if (method === 'GET' && !action) {
    advance(campaign)
    return ok(campaignOut(campaign))
  }
  if (method === 'GET' && action === 'recipients') {
    const q = (url.searchParams.get('q') ?? '').trim()
    const wanted = { state: url.searchParams.get('state'), failure: url.searchParams.get('failure') }
    const rows = recipientsOf(id).filter(row => (!q || row.contact.name.includes(q) || (row.contact.phone ?? '').includes(q)) && (!wanted.state || row.state === wanted.state) && (!wanted.failure || row.failure === wanted.failure))
    return ok(page(rows.map(row => ({ ...row, can_retry: row.failure === 'frequency_capped' && Date.now() - Date.parse(row.sent_at ?? iso(0)) >= DAY })), url))
  }
  if (method === 'PATCH' && !action) {
    if (!['draft', 'scheduled', 'paused'].includes(campaign.state)) return problem(undefined, 'لا يمكن تعديل الحملة في هذه الحالة')
    if (campaign.state === 'paused' && Object.keys(body).some(key => !['name', 'daily_cap', 'send_within_hours'].includes(key))) return problem(undefined, 'الحملة المتوقفة تقبل الاسم والحد اليومي وساعات العمل فقط')
    const refusal = validate(body, campaign)
    if (refusal) return refusal
    Object.assign(campaign, campaignInput(body, campaign))
    return ok(campaignOut(campaign))
  }
  if (method === 'DELETE' && !action) {
    if (!['draft', 'scheduled'].includes(campaign.state)) return problem(undefined, 'لا يمكن حذف حملة بدأ إرسالها')
    data.campaigns.splice(data.campaigns.indexOf(campaign), 1)
    data.recipients.delete(id)
    return { status: 204, body: undefined }
  }
  if (method === 'POST' && action === 'test') {
    const person = personOf(body.contact_id)
    if (!person) return problem('contact_id', 'العميل غير موجود')
    if (!reachable(person.id)) return problem('contact_id', 'سياسة الموافقة لا تسمح بمراسلة هذا العميل')
    const conversation = state.conversations.find(item => item.contact.id === person.id)
    return ok({ conversation_id: conversation?.id ?? 1, message_id: state.ids.message() })
  }
  if (method === 'POST' && ['launch', 'pause', 'resume', 'cancel', 'retry'].includes(action)) return transition(campaign, action)
  return undefined

  function transition(target, name) {
    const now = iso(Date.now())
    if (name === 'launch') {
      if (target.state !== 'draft') return problem(undefined, 'الحملة ليست مسودة')
      const template = templateOf(target.template_id)
      if (!template || template.status !== 'approved') return problem('template_id', 'القالب غير معتمد')
      if (['image', 'video', 'document'].includes(template.header?.type) && !target.header_attachment_id) return problem('header_attachment_id', 'ملف العنوان مطلوب')
      if (target.scheduled_at && Date.parse(target.scheduled_at) < Date.now()) return problem('scheduled_at', 'وقت البدء في الماضي')
      const audience = data.audiences.find(item => item.id === target.audience_id)
      const members = membersOf(audience)
      if (!members.some(person => reachable(person.id))) return problem('audience_id', 'لا يوجد عملاء مؤهلون في هذا الجمهور')
      data.recipients.set(target.id, members.map((person, index) => recipient(target.id * 100 + index, person, reachable(person.id) ? null : (consentOf(person.id) === 'opted_out' ? 'opted_out' : 'no_consent'))))
      target.launched_at = now
      target.state = target.scheduled_at ? 'scheduled' : 'running'
    } else if (name === 'pause') {
      if (target.state !== 'running') return problem(undefined, 'الحملة لا تعمل الآن')
      Object.assign(target, { state: 'paused', pause_reason: 'manual', pause_detail: null })
    } else if (name === 'resume') {
      if (target.state !== 'paused') return problem(undefined, 'الحملة ليست متوقفة')
      Object.assign(target, { state: 'running', pause_reason: null, pause_detail: null })
    } else if (name === 'cancel') {
      if (['done', 'cancelled'].includes(target.state)) return problem(undefined, 'الحملة منتهية')
      recipientsOf(target.id).filter(row => row.state === 'pending').forEach(row => Object.assign(row, { state: 'skipped', skip_reason: 'cancelled' }))
      Object.assign(target, { state: 'cancelled', completed_at: now })
    } else {
      const capped = recipientsOf(target.id).filter(row => row.failure === 'frequency_capped' && Date.now() - Date.parse(row.sent_at ?? now) >= DAY)
      if (!capped.length) return problem(undefined, 'لا يوجد مستلمون يمكن إعادة إرسالهم')
      capped.forEach(row => Object.assign(row, { state: 'pending', failure: null, error_code: null, error: null }))
      Object.assign(target, { state: 'running', completed_at: null })
    }
    return ok(campaignOut(target))
  }

  function preview(input) {
    const template = templateOf(input.template_id)
    if (!template) return fail(404, 'not_found', 'not found')
    const person = input.contact_id ? personOf(input.contact_id) : null
    const missing = []
    const valueOf = (location, position) => {
      const param = (input.params ?? []).find(item => item.location === location && item.position === position)
      const field = { contact_name: person?.name, contact_first_name: person?.name.split(' ')[0], contact_phone: person?.phone, contact_email: person?.email }[param?.source]
      const value = param?.source === 'static' ? param.value : (field || param?.value || '')
      if (!value) missing.push({ location, position })
      return value
    }
    const fill = (text, location) => text.replace(/\{\{(\d+)\}\}/g, (_, index) => valueOf(location, Number(index)) || `{{${index}}}`)
    return ok({
      contact: person ? { id: person.id, name: person.name } : null,
      header_text: template.header?.type === 'text' ? fill(template.header.text, 'header') : null,
      body: fill(template.body, 'body'), footer: template.footer,
      buttons: template.buttons.map((button, index) => {
        if (button.type === 'url' && button.url.endsWith('{{1}}')) valueOf('button', index)
        return { type: button.type, text: button.text ?? 'نسخ الرمز' }
      }),
      missing,
    })
  }

  function recipient(recipientId, person, skip, rest = {}) {
    return {
      id: recipientId, contact: { id: person.id, name: person.name, phone: person.phone }, state: skip ? 'skipped' : 'pending', skip_reason: skip, failure: null, error_code: null, error: null,
      conversation_id: state.conversations.find(item => item.contact.id === person.id)?.id ?? null, sent_at: null, replied_at: null, unsubscribed_at: null, can_retry: false, ...rest,
    }
  }

  // One step of a running campaign per read, so polling shows the numbers move.
  function advance(target) {
    if (target.state === 'scheduled' && target.scheduled_at && Date.parse(target.scheduled_at) <= Date.now()) target.state = 'running'
    if (target.state !== 'running') return
    const rows = recipientsOf(target.id)
    const take = (from, to, count, patch = () => ({})) => rows.filter(row => row.state === from).slice(0, count).forEach(row => Object.assign(row, { state: to }, patch(row)))
    take('delivered', 'read', 1, row => ({ replied_at: row.id % 3 === 0 ? iso(Date.now()) : null }))
    take('sent', 'delivered', 2)
    take('queued', 'sent', 2, () => ({ sent_at: iso(Date.now()) }))
    take('pending', 'queued', 2)
    if (!rows.some(row => row.state === 'pending' || row.state === 'queued')) Object.assign(target, { state: 'done', completed_at: iso(Date.now()) })
  }
}

/** The seeded campaigns: a finished one with mixed outcomes, a running one that moves, and a draft. */
export function seedCampaignRecords(ctx, ago) {
  const data = ctx.state.campaignData
  const person = contactId => [...ctx.state.contacts, ...data.extraContacts].find(item => item.id === contactId)
  const row = (recipientId, contactId, rest) => {
    const contact = person(contactId)
    return {
      id: recipientId, contact: { id: contact.id, name: contact.name, phone: contact.phone }, state: 'pending', skip_reason: null, failure: null, error_code: null, error: null,
      conversation_id: ctx.state.conversations.find(item => item.contact.id === contactId)?.id ?? null, sent_at: null, replied_at: null, unsubscribed_at: null, can_retry: false, ...rest,
    }
  }
  const base = (id, name, rest) => ({
    id, name, channel_id: 1, template_id: 1, audience_id: 1, params: [], header_attachment_id: null, scheduled_at: null, send_within_hours: false, daily_cap: 0, state: 'draft',
    pause_reason: null, pause_detail: null, launched_at: null, completed_at: null, created_at: ago(500 - id), ...rest,
  })
  const params = [
    { location: 'body', position: 1, source: 'contact_first_name', value: 'عميلنا' },
    { location: 'body', position: 2, source: 'static', value: 'الخميس' },
    { location: 'button', position: 1, source: 'static', value: '4521' },
  ]
  data.campaigns.push(
    base(3, 'مسودة عروض الشتاء', { template_id: 2, audience_id: 2, params: [] }),
    base(2, 'عروض الشتاء', { template_id: 2, audience_id: 1, params: [], header_attachment_id: 400, state: 'running', launched_at: ago(0.5), created_at: ago(2) }),
    base(1, 'تذكير مواعيد الأسبوع', { params, state: 'done', launched_at: ago(60), completed_at: ago(58), created_at: ago(70) }),
  )
  data.uploads.set(400, { id: 400, name: 'عروض-الشتاء.jpg', mimetype: 'image/jpeg', size: 120000 })
  data.recipients.set(1, [
    row(101, 1, { state: 'read', sent_at: ago(59), replied_at: ago(58.5) }),
    row(102, 11, { state: 'delivered', sent_at: ago(59) }),
    row(103, 12, { state: 'delivered', sent_at: ago(59), unsubscribed_at: ago(58.2) }),
    row(104, 13, { state: 'failed', failure: 'frequency_capped', error_code: 131049, error: 'This message was not delivered to maintain healthy ecosystem engagement.', sent_at: ago(59), can_retry: true }),
    row(105, 14, { state: 'failed', failure: 'not_on_whatsapp', error_code: 131026, error: 'Message undeliverable', sent_at: ago(59) }),
    row(106, 2, { state: 'skipped', skip_reason: 'opted_out' }),
  ])
  data.recipients.set(2, [1, 11, 12, 13, 14, 16, 18].map((contactId, index) => row(200 + index, contactId, contactId === 1 ? { state: 'delivered', sent_at: ago(0.4) } : contactId === 16 ? { state: 'skipped', skip_reason: 'opted_out' } : {})))
  data.recipients.set(3, [])
}
