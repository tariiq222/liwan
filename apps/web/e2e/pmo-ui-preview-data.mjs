// Opt-in isolated preview data for the Plan 6a pages. Never connected to an Odoo database.
// It runs before projects-ui-preview-data.mjs and owns only what that module cannot give a list a second row of:
// project 2 «مشروع بيتا» (can manage) and project 3 «مشروع جاما» (read-only), plus a few global lists.
const manager = { id: 2, name: 'مدير المشروع' }
const MANAGE = 2
const READONLY = 3

const milestones = [
  { id: 11, name: 'اعتماد الخطة', start_date: '2026-01-05', deadline: '2026-02-01', is_reached: true, reached_date: '2026-01-30', task_count: 2, done_task_count: 2, deliverables: [{ name: 'وثيقة النطاق', done: true }, { name: 'خطة المخاطر', done: true }] },
  { id: 12, name: 'إطلاق النموذج الأول', start_date: '2026-02-02', deadline: '2026-04-15', is_reached: false, reached_date: null, task_count: 3, done_task_count: 1, deliverables: [{ name: 'نموذج قابل للتجربة', done: false }] },
  { id: 13, name: 'التسليم النهائي', start_date: null, deadline: '2035-01-01', is_reached: false, reached_date: null, task_count: 0, done_task_count: 0, deliverables: [] },
]
const stakeholders = [
  { id: 21, name: 'فريق التشغيل', user: null, organization: 'إدارة الخدمات', role: 'مالك الخدمة', contact: 'operations@example.test', notes: 'المراجعة الأسبوعية.' },
  { id: 22, name: 'مكتب الجودة', user: manager, organization: 'الجودة', role: 'مراجع', contact: 'quality@example.test', notes: '' },
  { id: 23, name: 'الإدارة المالية', user: null, organization: 'المالية', role: 'معتمد', contact: '', notes: '' },
]
const register = [
  { id: 31, kind: 'risk', title: 'تأخر اعتماد المتطلبات', description: 'قد تتأخر مراجعة المتطلبات.', priority: 'high', status: 'open', owner: manager, due_date: '2026-10-01', response: 'اجتماع مراجعة مبكر.', task: { id: 101, name: 'مهمة جارية' }, probability: 3, impact: 4, score: 12 },
  { id: 32, kind: 'risk', title: 'نقص الموارد في المرحلة الثانية', description: '', priority: 'normal', status: 'in_progress', owner: null, due_date: null, response: '', task: null, probability: 2, impact: 2, score: 4 },
  { id: 33, kind: 'issue', title: 'تعطل بيئة الاختبار', description: 'البيئة غير متاحة.', priority: 'critical', status: 'open', owner: manager, due_date: '2026-09-20', response: '', task: null, probability: null, impact: null, score: null },
]
const raci = [
  { id: 41, task: { id: 101, name: 'مهمة جارية' }, stakeholder: { id: 21, name: stakeholders[0].name }, role: 'R' },
  { id: 42, task: { id: 101, name: 'مهمة جارية' }, stakeholder: { id: 22, name: stakeholders[1].name }, role: 'A' },
  { id: 43, task: { id: 102, name: 'مهمة تحتاج تعديلاً' }, stakeholder: { id: 21, name: stakeholders[0].name }, role: 'C' },
]
const entries = (projectId) => [
  { id: 51, project_id: projectId, kind: 'budget', title: 'ميزانية التنفيذ', amount: 1500, expense_date: null, reference: 'B-001', notes: 'المرحلة الأولى', budget_entry_id: null, updated_at: 'v1' },
  { id: 52, project_id: projectId, kind: 'budget', title: 'ميزانية التشغيل', amount: 1000, expense_date: null, reference: 'B-002', notes: '', budget_entry_id: null, updated_at: 'v1' },
  { id: 53, project_id: projectId, kind: 'expense', title: 'تجهيز بيئة العمل', amount: 400, expense_date: '2026-09-01', reference: 'E-001', notes: '', budget_entry_id: 51, updated_at: 'v1' },
  { id: 54, project_id: projectId, kind: 'expense', title: 'رخص البرمجيات', amount: 300, expense_date: '2026-09-10', reference: 'E-002', notes: '', budget_entry_id: null, updated_at: 'v1' },
]
const catalog = (names) => names.map((name, index) => ({ id: index + 1, name, sequence: index + 1, active: index < 2 }))

function slice(items, url, extra = {}) {
  const offset = Number(url.searchParams.get('offset') || 0)
  const limit = Number(url.searchParams.get('limit') || 50)
  return { items: items.slice(offset, offset + limit), total: items.length, ...extra }
}
function search(items, url, key) {
  const q = (url.searchParams.get('q') || '').trim()
  return q ? items.filter(item => String(item[key]).includes(q)) : items
}

export function pmoPreviewData(path, url, { TASKS, CURRENCY }) {
  if (path === '/api/v1/tasks/archived') return { items: TASKS.slice(0, 3), total: 3 }
  const c = path.match(/^\/api\/v1\/project-charter\/catalogs\/(types|owning-units)$/)
  if (c) {
    const all = catalog(c[1] === 'types' ? ['داخلي', 'خارجي', 'تجريبي'] : ['مكتب المشاريع', 'مكتب التحول', 'مكتب قديم'])
    const visible = url.searchParams.get('active') === 'all' ? all : all.filter(item => item.active)
    return slice(search(visible, url, 'name'), url)
  }
  const section = path.match(/^\/api\/v1\/projects\/(\d+)\/(.+)$/)
  if (!section) return undefined
  const projectId = Number(section[1])
  if (projectId !== MANAGE && projectId !== READONLY) return undefined
  const canManage = projectId === MANAGE
  const rest = section[2]
  if (rest === 'milestones') return milestones
  if (rest === 'stakeholders') return slice(search(stakeholders, url, 'name'), url, { can_manage: canManage })
  if (/^stakeholders\/\d+$/.test(rest)) return stakeholders.find(item => item.id === Number(rest.split('/')[1]))
  if (rest === 'register') {
    const filtered = register.filter(item => ['kind', 'status', 'priority'].every(key => !url.searchParams.get(key) || item[key] === url.searchParams.get(key)))
    return slice(search(filtered, url, 'title'), url, { can_manage: canManage })
  }
  if (/^register\/\d+$/.test(rest)) return register.find(item => item.id === Number(rest.split('/')[1]))
  if (rest === 'raci') return { items: raci, total: raci.length, can_manage: canManage }
  if (rest === 'finance') {
    const kind = url.searchParams.get('kind')
    const list = entries(projectId).filter(item => !kind || kind === 'all' || item.kind === kind)
    return slice(search(list, url, 'title'), url, {
      can_manage: canManage,
      summary: { project_id: projectId, currency: CURRENCY, charter_estimate: null, planned: 2500, actual: 700, remaining: 1800, utilization_percent: 28, over_budget: false, budget_count: 2, expense_count: 2, actual_source: 'manual', actual_account: null, can_read_actual_lines: false, can_choose_actual_account: false },
    })
  }
  if (/^finance\/\d+$/.test(rest)) return entries(projectId).find(item => item.id === Number(rest.split('/')[1]))
  return undefined
}
