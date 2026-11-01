// Opt-in isolated preview of the baseline routes (PROJECTS_UI_PREVIEW=1). Never connected to an Odoo database.
// Project 2 «مشروع بيتا» is managed by the mock user and holds two baselines; project 3 is read-only for them.
// The state lives for the process: taking a baseline appends a numbered, immutable snapshot of the mock plan.
const ME = { id: 2, name: 'مدير المشروع' }
const CURRENCY = { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 }
const PLAN = [
  { task_id: 101, name: 'مهمة جارية', start: '2026-09-08', end: '2026-09-15', now_start: '2026-09-08', now_end: '2026-09-15' },
  { task_id: 102, name: 'مهمة تحتاج تعديلاً', start: '2026-09-10', end: '2026-09-20', now_start: '2026-09-14', now_end: '2026-09-28' },
  { task_id: 103, name: 'مهمة ملغاة', start: '2026-09-16', end: '2026-10-01', now_start: '2026-09-16', now_end: '2026-09-27' },
  { task_id: 104, name: 'مهمة مكتملة', start: '2026-09-20', end: '2026-10-01', now_start: '2026-09-20', now_end: '2026-10-01' },
  { task_id: 105, name: 'التدريب (دون تاريخ)', start: null, end: null, now_start: null, now_end: null },
]
const days = (current, planned) => current && planned ? Math.round((Date.parse(current) - Date.parse(planned)) / 86400000) : null
const row = (start, end, nowStart, nowEnd) => ({
  baseline_start: start, baseline_end: end, current_start: nowStart, current_end: nowEnd,
  start_variance_days: days(nowStart, start), end_variance_days: days(nowEnd, end),
})

function seed() {
  const take = (id, number, taken_at, note, budget) => ({
    id, project_id: 2, number, taken_by: ME, taken_at, note, change: null, budget_total: budget, currency: CURRENCY,
    planned_start: '2026-09-08', planned_end: '2026-10-01', task_count: PLAN.length,
    tasks: PLAN.map((line, index) => ({ id: id * 10 + index, task_id: line.task_id, name: line.name, planned_start: line.start, planned_end: line.end, planned_value_share: 1 / PLAN.length })),
  })
  return [take(31, 1, '2026-10-02T09:00:00Z', 'خطة الانطلاق المعتمدة', 120000), take(32, 2, '2026-10-20T09:00:00Z', 'بعد اعتماد طلب تغيير النطاق', 138000)]
}
let BASELINES = seed()
let nextId = 100

// The gate check of the planning -> executing phase card: the mock mirrors the default `warning` mode.
export const baselineGateCheck = projectId => ({ key: 'baseline_set', ok: BASELINES.some(item => item.project_id === projectId), warning: true })

const dumpList = ({ tasks: _tasks, ...rest }) => rest

function variance(projectId) {
  const latest = BASELINES.filter(item => item.project_id === projectId).sort((a, b) => b.number - a.number)[0]
  if (!latest) return { project_id: projectId, baseline: null, schedule: null, cost: null }
  const tasks = PLAN.map(line => ({ task_id: line.task_id, name: line.name, removed: false, ...row(line.start, line.end, line.now_start, line.now_end) }))
  return {
    project_id: projectId,
    baseline: { number: latest.number, taken_at: latest.taken_at },
    schedule: {
      project: row('2026-09-08', '2026-10-01', '2026-09-08', '2026-10-06'),
      tasks,
      late_count: tasks.filter(task => (task.end_variance_days ?? 0) > 0).length,
      early_count: tasks.filter(task => (task.end_variance_days ?? 0) < 0).length,
      undated_count: tasks.filter(task => task.end_variance_days === null).length,
    },
    cost: { currency: CURRENCY, baseline_budget: latest.budget_total, current_budget: 146000, budget_variance: 146000 - latest.budget_total, actual: 61500, remaining_against_baseline: latest.budget_total - 61500, over_baseline: false },
  }
}

export async function handleBaselines(req, res, path, url, { json, readBody }) {
  const method = req.method
  const send = (status, body) => { json(res, status, body); return true }
  if (method === 'POST' && path === '/api/v1/__mock/reset-baselines') {
    BASELINES = seed()
    return send(200, { ok: true })
  }
  const base = path.match(/^\/api\/v1\/projects\/(\d+)\/baselines(?:\/(\d+|variance))?$/)
  if (!base) return false
  const projectId = Number(base[1])
  if (projectId !== 2 && projectId !== 3) return send(404, { code: 'not_found', message: 'Record does not exist' })
  const rows = BASELINES.filter(item => item.project_id === projectId)
  if (base[2] === 'variance' && method === 'GET') return send(200, variance(projectId))
  if (!base[2]) {
    if (method === 'GET') {
      const items = [...rows].sort((a, b) => b.number - a.number)
      return send(200, { items: items.map(dumpList), total: items.length, can_take: projectId === 2, change_required: false, coverable_changes: projectId === 2 ? [{ id: 103, number: 3, title: 'رفع ميزانية بيئة الاختبار' }] : [] })
    }
    if (method === 'POST') {
      if (projectId !== 2) return send(403, { code: 'forbidden', message: 'Only the project manager can change this project.' })
      const body = JSON.parse(await readBody(req) || '{}')
      const unknown = Object.keys(body).find(key => !['note', 'change_id'].includes(key))
      if (unknown) return send(422, { code: 'unknown_field', message: `field '${unknown}' is not writable`, field: unknown })
      const number = Math.max(0, ...rows.map(item => item.number)) + 1
      const created = {
        id: nextId += 1, project_id: projectId, number, taken_by: ME, taken_at: new Date().toISOString(), note: (body.note ?? '').trim(),
        change: body.change_id ? { id: body.change_id, number: 3, title: 'رفع ميزانية بيئة الاختبار' } : null, budget_total: 146000, currency: CURRENCY,
        planned_start: '2026-09-08', planned_end: '2026-10-06', task_count: PLAN.length,
        tasks: PLAN.map((line, index) => ({ id: nextId * 10 + index, task_id: line.task_id, name: line.name, planned_start: line.now_start, planned_end: line.now_end, planned_value_share: 1 / PLAN.length })),
      }
      BASELINES.push(created)
      return send(201, created)
    }
    return false
  }
  const item = rows.find(candidate => candidate.number === Number(base[2]))
  if (!item) return send(404, { code: 'not_found', message: 'Record does not exist' })
  return method === 'GET' ? send(200, item) : false
}
