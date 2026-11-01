// Opt-in isolated preview of the change request routes (PROJECTS_UI_PREVIEW=1). Never connected to an Odoo database.
// Project 2 «مشروع بيتا» is managed by the mock user, who is also its sponsor; project 3 is read-only for them.
// The state lives for the process and mirrors the server's state machine: draft -> submitted -> approved | rejected,
// withdrawn before a decision, implemented after approval.
const ME = { id: 2, name: 'مدير المشروع' }
const SPONSOR_OF = new Set([2])
const CURRENCY = { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 }
const CATEGORIES = [
  { id: 1, name: 'النطاق', sequence: 10, active: true },
  { id: 2, name: 'الجدول الزمني', sequence: 20, active: true },
  { id: 3, name: 'التكلفة', sequence: 30, active: true },
  { id: 4, name: 'الجودة', sequence: 40, active: true },
  { id: 5, name: 'أخرى', sequence: 50, active: true },
  { id: 6, name: 'تنظيمي', sequence: 60, active: false },
]
const NOW = () => new Date().toISOString()

function seed() {
  const item = (id, number, state, extra = {}) => ({
    id, project_id: 2, number, title: '', description: '', reason: '', category: null, state, requester: ME,
    impact_schedule_days: 0, impact_cost: 0, currency: CURRENCY, impact_scope: '', decided_by: null, decided_at: null,
    decision_note: '', implemented_at: null, created_at: '2026-10-20T09:00:00Z', revision: 1, ...extra,
  })
  return [
    item(101, 1, 'implemented', { title: 'إضافة وحدة تقارير للإدارة', category: CATEGORIES[0], description: 'طلب العميل وحدة تقارير شهرية.', reason: 'طلب جديد من الإدارة العليا.', impact_schedule_days: 14, impact_cost: 18000, impact_scope: 'يضاف تقرير شهري واحد إلى نطاق التسليم.', decided_by: ME, decided_at: '2026-10-22T10:00:00Z', implemented_at: '2026-10-28T10:00:00Z' }),
    item(102, 2, 'rejected', { title: 'نقل الإطلاق إلى الربع الأول', category: CATEGORIES[1], reason: 'تعارض مع موسم الإجازات.', impact_schedule_days: 60, decided_by: ME, decided_at: '2026-10-23T10:00:00Z', decision_note: 'الموعد الحالي ملزم بعقد مع العميل.' }),
    item(103, 3, 'approved', { title: 'رفع ميزانية بيئة الاختبار', category: CATEGORIES[2], description: 'بيئة اختبار مستقلة للتكامل.', reason: 'مخاطر الاختبار على بيئة الإنتاج.', impact_cost: 7500.5, decided_by: ME, decided_at: '2026-10-25T10:00:00Z', decision_note: 'معتمد ضمن الاحتياطي.' }),
    item(104, 4, 'submitted', { title: 'تقليص نطاق المرحلة الثانية', category: CATEGORIES[0], description: 'حذف تكامل الدفع الإلكتروني من المرحلة الثانية.', reason: 'تأخر الجهة المزودة.', impact_schedule_days: -10, impact_cost: -4200, impact_scope: 'يؤجل تكامل الدفع إلى مرحلة لاحقة.', requester: { id: 5, name: 'سارة' } }),
    item(105, 5, 'draft', { title: 'إضافة مراجعة جودة قبل التسليم', category: CATEGORIES[3], reason: 'ملاحظات من التسليم السابق.', impact_schedule_days: 5, impact_cost: 2000 }),
    item(106, 6, 'withdrawn', { title: 'تغيير مزود الاستضافة', category: CATEGORIES[4] }),
  ]
}
let CHANGES = seed()
let nextId = 200

function flags(change) {
  const mine = change.requester.id === ME.id
  const sponsor = SPONSOR_OF.has(change.project_id)
  return {
    can_edit: mine && change.state === 'draft',
    can_submit: mine && change.state === 'draft',
    can_withdraw: mine && ['draft', 'submitted'].includes(change.state),
    can_decide: sponsor && change.state === 'submitted',
    can_implement: change.project_id === 2 && change.state === 'approved',
  }
}
function dump(change) {
  const { revision, category, ...rest } = change
  return { ...rest, category: category && { id: category.id, name: category.name }, updated_at: `v${revision}`, ...flags(change) }
}
const bump = change => { change.revision += 1; return change }

export async function handleChanges(req, res, path, url, { json, readBody }) {
  const method = req.method
  const send = (status, body) => { json(res, status, body); return true }
  if (method === 'POST' && path === '/api/v1/__mock/reset-changes') {
    CHANGES = seed()
    return send(200, { ok: true })
  }
  if (path === '/api/v1/pmo/change-categories' && method === 'GET') {
    const all = url.searchParams.get('active') === 'all'
    const items = CATEGORIES.filter(category => all || category.active)
    return send(200, { items, total: items.length })
  }
  const base = path.match(/^\/api\/v1\/projects\/(\d+)\/changes(?:\/(\d+))?(?:\/(submit|withdraw|approve|reject|implement))?$/)
  if (!base) return false
  const projectId = Number(base[1])
  if (projectId !== 2 && projectId !== 3) return send(404, { code: 'not_found', message: 'Record does not exist' })
  const rows = CHANGES.filter(change => change.project_id === projectId)
  if (!base[2]) {
    if (method === 'GET') {
      const state = url.searchParams.get('state')
      const category = url.searchParams.get('category_id')
      const items = rows.filter(change => (!state || change.state === state) && (!category || change.category?.id === Number(category))).sort((a, b) => b.number - a.number)
      return send(200, { items: items.map(dump), total: items.length, can_create: projectId === 2 })
    }
    if (method === 'POST') {
      if (projectId !== 2) return send(403, { code: 'forbidden', message: 'Only a member of the project can raise a change request.' })
      const body = JSON.parse(await readBody(req) || '{}')
      if (typeof body.title !== 'string' || !body.title.trim()) return send(422, { code: 'invalid', message: 'title must not be empty', field: 'title' })
      const created = {
        id: nextId += 1, project_id: projectId, number: Math.max(0, ...rows.map(change => change.number)) + 1, title: body.title.trim(),
        description: body.description ?? '', reason: body.reason ?? '', category: CATEGORIES.find(category => category.id === body.category_id) ?? null,
        state: 'draft', requester: ME, impact_schedule_days: body.impact_schedule_days ?? 0, impact_cost: body.impact_cost ?? 0, currency: CURRENCY,
        impact_scope: body.impact_scope ?? '', decided_by: null, decided_at: null, decision_note: '', implemented_at: null, created_at: NOW(), revision: 1,
      }
      CHANGES.push(created)
      return send(201, dump(created))
    }
    return false
  }
  const change = rows.find(item => item.id === Number(base[2]))
  if (!change) return send(404, { code: 'not_found', message: 'Record does not exist' })
  if (method === 'GET' && !base[3]) return send(200, dump(change))
  const body = ['PATCH', 'POST'].includes(method) ? JSON.parse(await readBody(req) || '{}') : {}
  const stale = () => body.expected_updated_at !== undefined && body.expected_updated_at !== `v${change.revision}`
  const wrongState = () => send(409, { code: 'change_state', message: 'The change request is not in the expected state.' })
  if (method === 'PATCH') {
    if (stale()) return send(409, { code: 'stale_write', message: 'This change request was changed by someone else.', field: 'expected_updated_at' })
    if (!flags(change).can_edit) return wrongState()
    const { expected_updated_at: _token, category_id: categoryId, ...fields } = body
    Object.assign(change, fields)
    if (categoryId !== undefined) change.category = CATEGORIES.find(category => category.id === categoryId) ?? null
    return send(200, dump(bump(change)))
  }
  if (method !== 'POST' || !base[3]) return false
  if (stale()) return send(409, { code: 'stale_write', message: 'This change request was changed by someone else.', field: 'expected_updated_at' })
  const can = flags(change)
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  switch (base[3]) {
    case 'submit':
      if (!can.can_submit) return wrongState()
      change.state = 'submitted'
      break
    case 'withdraw':
      if (!can.can_withdraw) return wrongState()
      change.state = 'withdrawn'
      break
    case 'approve':
      if (!can.can_decide) return wrongState()
      Object.assign(change, { state: 'approved', decided_by: ME, decided_at: NOW(), decision_note: note })
      break
    case 'reject':
      if (!can.can_decide) return wrongState()
      if (!note) return send(422, { code: 'invalid', message: 'A note of 1 to 2000 characters is required.', field: 'note' })
      Object.assign(change, { state: 'rejected', decided_by: ME, decided_at: NOW(), decision_note: note })
      break
    default:
      if (!can.can_implement) return wrongState()
      Object.assign(change, { state: 'implemented', implemented_at: NOW() })
  }
  return send(200, dump(bump(change)))
}
