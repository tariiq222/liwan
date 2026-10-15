// Opt-in isolated preview data. Never connected to an Odoo database.
export function projectsPreviewData(path, url, { PROJECTS, TASKS, projectDetail, reportRow, CURRENCY }) {
  const user = { id: 2, name: 'مدير المشروع' }
  const milestone = { id: 1, name: 'اعتماد الخطة', deadline: '2026-10-01', is_reached: false, reached_date: null, task_count: 2, done_task_count: 1 }
  const stakeholder = { id: 1, name: 'فريق التشغيل', user: null, organization: 'إدارة الخدمات', role: 'مالك الخدمة', contact: 'operations@example.test', notes: 'المراجعة الأسبوعية لمخرجات المشروع.' }
  const risk = { id: 1, kind: 'risk', title: 'تأخر اعتماد المتطلبات', description: 'قد تتأخر مراجعة المتطلبات عن الموعد المحدد.', priority: 'high', status: 'open', owner: user, due_date: '2026-10-01', response: 'تحديد اجتماع مراجعة مبكر مع الأطراف المعنية.', task: { id: 101, name: TASKS[0].name }, probability: 3, impact: 4, score: 12 }
  const entries = [{ id: 1, project_id: 1, kind: 'budget', title: 'ميزانية التنفيذ', amount: 1000, expense_date: null, reference: 'B-001', notes: 'ميزانية المرحلة الأولى', budget_entry_id: null, updated_at: 'v1' }, { id: 2, project_id: 1, kind: 'expense', title: 'تكلفة تجهيز الخدمة', amount: 300, expense_date: '2026-09-01', reference: 'E-001', notes: 'المصروف المرتبط بتجهيز بيئة العمل', budget_entry_id: 1, updated_at: 'v1' }]
  const page = (items, extra = {}) => ({ items: items.slice(Number(url.searchParams.get('offset') || 0), Number(url.searchParams.get('offset') || 0) + Number(url.searchParams.get('limit') || 50)), total: items.length, ...extra })
  if (path === '/api/v1/people') return [user]
  if (path === '/api/v1/currencies' || path === '/api/v1/project-charter/currencies') return [CURRENCY]
  if (/^\/api\/v1\/project-charter\/catalogs\/(types|owning-units)\/1$/.test(path)) return { id: 1, name: path.includes('types') ? 'داخلي' : 'مكتب المشاريع', sequence: 1, active: true }
  if (path === '/api/v1/reports/projects/analytics') {
    const rows = PROJECTS.map(reportRow)
    return { project_count: 3, attention_project_count: 2, overdue_task_count: 0, status_counts: PROJECTS.map(p => ({ status: p.status, count: 1 })), totals: [{ currency: CURRENCY, project_count: 3, budgeted_project_count: 3, planned: 3000, actual: 900, remaining: 2100, over_budget_count: 0 }], attention: rows.slice(1), projects: rows, recent_projects: rows.map(r => ({ ...r, updated_at: '2026-09-08T06:00:00Z' })) }
  }
  if (/^\/api\/v1\/tasks\/\d+$/.test(path)) {
    const item = TASKS.find(t => t.id === Number(path.split('/').at(-1)))
    if (!item) return undefined
    return { ...item, description_html: '<p>توثيق خطوات العمل ومراجعة المخرجات مع الفريق.</p>', allocated_hours: 0, age_days: 4, cycle_days: null, subtasks: [], depends_on: [], attachments: [], can_manage_dependencies: true, milestone: { id: 1, name: milestone.name }, created_at: '2026-09-01T09:00:00Z', updated_at: '2026-09-08T06:00:00Z', allowed_actions: ['read', 'write', 'archive'], completion_pending: false, completion_revision: 0, completion_return_note: null, completion_policy: 'none', completion_approver: null, completion_blocked_reason: null }
  }
  if (/\/tasks\/\d+\/thread-tasks$/.test(path)) return [{ id: 102, name: 'تجهيز بيئة الاختبار' }, { id: 103, name: 'مراجعة المتطلبات' }]
  if (/\/tasks\/\d+\/timeline$/.test(path)) return [{ id: 2, kind: 'comment', at: '2026-09-09T08:00:00Z', author: user, task: { id: 102, name: 'تجهيز بيئة الاختبار' }, body_html: '<p><strong>@نورة الحربي</strong> البيئة جاهزة، راجعي <a href="/tasks/103">/مراجعة المتطلبات</a> قبل الاعتماد.</p>' }, { id: 1, kind: 'tracking', at: '2026-09-08T06:00:00Z', author: user, changes: [{ field: 'date_deadline', label: 'الموعد النهائي', old: false, new: '2026-10-01' }] }]
  if (/\/tasks\/\d+\/dependencies$/.test(path)) return { items: [], total: 0, can_manage: true, enabled: true }
  const section = path.match(/^\/api\/v1\/projects\/(\d+)\/(.+)$/)
  if (!section) return undefined
  const projectId = Number(section[1]); const rest = section[2]
  if (rest === 'milestones') return [milestone]
  if (rest === 'updates') return [{ id: 1, name: 'اعتماد نطاق المرحلة الأولى', status: 'on_track', description_html: '<p>اكتملت مراجعة النطاق وتم تحديد موعد اعتماد الخطة.</p>', date: '2026-09-08', author: user }, { id: 2, name: 'بدء المشروع', status: 'on_track', description_html: '<p>عُقد اجتماع البداية مع فريق العمل.</p>', date: '2026-09-01', author: user }]
  if (rest === 'stakeholders') return page([stakeholder], { can_manage: true })
  if (rest === 'stakeholders/1') return stakeholder
  if (rest === 'register') return page([risk], { can_manage: true })
  if (rest === 'register/1') return risk
  if (rest === 'raci') return { items: [{ id: 1, task: { id: 101, name: TASKS[0].name }, stakeholder: { id: 1, name: stakeholder.name }, role: 'R' }], total: 1, can_manage: true }
  if (rest === 'schedule') return { project_id: projectId, tasks: TASKS.map(t => ({ id: t.id, name: t.name, start: '2026-09-08', end: '2026-10-01', state: t.state, dependency_ids: [], milestone_id: 1 })), milestones: [{ id: 1, name: milestone.name, deadline: milestone.deadline }], can_manage: PROJECTS.find(project => project.id === projectId)?.can_manage !== false, total: TASKS.length }
  if (rest === 'finance') return page(entries.filter(e => !url.searchParams.get('kind') || url.searchParams.get('kind') === 'all' || e.kind === url.searchParams.get('kind')), { can_manage: true, summary: reportRow(PROJECTS[0]).finance })
  if (/^finance\/\d+$/.test(rest)) return entries.find(e => e.id === Number(rest.split('/')[1]))
  return undefined
}
