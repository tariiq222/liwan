// Stateful synthetic preview only. No Odoo, filesystem persistence, credentials or production code.
import { ADMIN, SARA, SSR_TASKS, SSR_COMMENTS, SSR_LIST, CONVERT_TARGETS, personalTask, openActions, closedActions } from './my-tasks-fixtures.mjs'

const PREVIEW_TARGETS = CONVERT_TARGETS.map(project => ({ ...project, name: project.id === 1 ? 'مشروع ألفا' : 'مشروع بيتا' }))
const envelope = items => ({ items, total: items.length })
const reply = (body, status = 200) => ({ status, body })
const stamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const asDeadline = value => value ? value.includes('T') ? value : `${value}T00:00:00Z` : null
const person = id => [ADMIN, SARA].find(value => value.id === id)
const escapeHtml = text => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value])
const wireState = task => task.state === 'open' ? 'in_progress' : task.state

export function createMyTasksPreview() {
  const tasks = new Map(Object.entries(structuredClone(SSR_TASKS)).map(([id, value]) => [Number(id), value]))
  const comments = new Map(Object.entries(structuredClone(SSR_COMMENTS)).map(([id, value]) => [Number(id), value]))
  const attachments = new Map()
  const converted = new Map()
  let nextId = 50000
  const rows = (map, id) => map.get(id) ?? map.set(id, []).get(id)
  const fail = (message, field, status = 422) => reply({ code: status === 404 ? 'not_found' : 'invalid', message, ...(field ? { field } : {}) }, status)
  const listItem = task => ({ id: task.id, name: task.name, state: task.state, priority: task.priority, date_deadline: task.date_deadline, assignees: task.assignees, source: task.project ? 'project' : 'personal', project: task.project ?? null, href: task.project ? `/projects/${task.project.id}/tasks/${task.id}` : `/my-tasks/${task.id}` })
  const pmoRow = task => ({
    id: task.id, name: task.name, project: task.project, state: wireState(task), priority: task.priority === 'high' ? '1' : '0',
    date_deadline: task.date_deadline, days_remaining: null, is_overdue: false, is_closed: task.state !== 'open', personal_stage: null, stage: null,
    assignees: task.assignees.map(({ id, name }) => ({ id, name })), tags: [], can_write: false, can_approve: false, allowed_transitions: [],
  })
  const pmoDetail = task => ({
    ...pmoRow(task),
    description_html: `<p>${escapeHtml(task.description)}</p>`, allocated_hours: 0, age_days: 0, cycle_days: null,
    subtasks: task.subtasks.map(child => converted.get(child.id)).filter(Boolean).map(pmoRow), depends_on: [], attachments: rows(attachments, task.id).map(({ data: _data, ...item }) => item), can_manage_dependencies: false,
    milestone: null, created_at: task.created_at, updated_at: task.updated_at, planned_start: null, deliverables: [], allowed_actions: ['read'],
    completion_pending: false, completion_revision: 0, completion_return_note: null, completion_policy: 'none', completion_approver: null, completion_blocked_reason: null,
  })
  function update(task, body) {
    if ('name' in body && (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 255)) return fail('عنوان المهمة مطلوب وبحد أقصى 255 حرفًا.', 'name')
    for (const key of ['name', 'description', 'priority']) if (key in body) task[key] = body[key]
    if ('name' in body) task.name = task.name.trim()
    if ('date_deadline' in body) task.date_deadline = asDeadline(body.date_deadline)
    if ('assignees' in body) task.assignees = body.assignees.map(person).filter(Boolean)
    task.updated_at = stamp()
  }
  return function handle(method, rawUrl, body = {}) {
    const url = new URL(rawUrl, 'http://preview.local'), path = url.pathname
    if (method === 'GET' && path === '/api/v1/people') return reply([ADMIN, SARA].filter(value => !url.searchParams.get('q') || value.name.includes(url.searchParams.get('q'))))
    const download = /^\/web\/content\/(\d+)$/.exec(path)
    if (method === 'GET' && download) {
      const file = [...attachments.values()].flat().find(item => item.id === Number(download[1]))
      if (file) return { status: 200, bytes: Buffer.from(file.data, 'base64'), mimetype: file.mimetype }
    }
    const pmo = /^\/api\/v1\/tasks\/(\d+)(?:\/(timeline|attachments|dependencies))?$/.exec(path)
    if (method === 'GET' && pmo && converted.has(Number(pmo[1]))) {
      const task = converted.get(Number(pmo[1]))
      if (pmo[2] === 'timeline') return reply(rows(comments, task.id).map(comment => ({ id: comment.id, kind: 'comment', author: comment.author ? { id: comment.author.id, name: comment.author.name } : null, at: comment.created_at, body_html: `<p>${escapeHtml(comment.body)}</p>` })))
      if (pmo[2] === 'dependencies') return reply({ items: [], total: 0, can_manage: false, enabled: false })
      if (pmo[2] === 'attachments') return reply(envelope(rows(attachments, task.id).map(({ data: _data, ...item }) => item)))
      return reply(pmoDetail(task))
    }
    if (!path.startsWith('/api/v1/my-tasks')) return undefined
    if (path === '/api/v1/my-tasks/convert-targets') return reply(envelope(PREVIEW_TARGETS.filter(item => item.name.includes(url.searchParams.get('q') ?? ''))))
    if (path === '/api/v1/my-tasks' && method === 'GET') {
      const projectRows = SSR_LIST.filter(item => item.source === 'project')
      let items = [...tasks.values()].filter(task => !task.is_subtask).map(listItem).concat(projectRows, [...converted.values()].filter(task => !task.is_subtask).map(listItem))
      items = items.filter(task => (task.state !== 'open') === (url.searchParams.get('closed') === '1'))
      const term = (url.searchParams.get('q') ?? '').toLocaleLowerCase()
      if (term) items = items.filter(task => task.name.toLocaleLowerCase().includes(term))
      if (url.searchParams.get('assigned') === 'me') items = items.filter(task => task.assignees.some(value => value.id === ADMIN.id))
      const sort = url.searchParams.get('sort')
      items.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'created' ? b.id - a.id : (a.date_deadline ?? '9999').localeCompare(b.date_deadline ?? '9999'))
      const total = items.length, offset = Math.max(0, Number(url.searchParams.get('offset')) || 0), limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50))
      return reply({ items: items.slice(offset, offset + limit), total })
    }
    if (path === '/api/v1/my-tasks' && method === 'POST') {
      if (!body.name?.trim()) return fail('عنوان المهمة مطلوب.', 'name')
      const parent = body.parent_id ? tasks.get(body.parent_id) : null
      if (body.parent_id && (!parent || parent.is_subtask)) return fail('اختر مهمة أصلية صالحة.', 'parent_id')
      const task = personalTask(nextId++, { description: '', date_deadline: null, created_at: stamp(), updated_at: stamp(), allowed_actions: { ...openActions(), convert: !parent }, ...(parent ? { is_subtask: true, parent: { id: parent.id, name: parent.name } } : {}) })
      const problem = update(task, body); if (problem) return problem
      tasks.set(task.id, task)
      if (parent) parent.subtasks.push({ id: task.id, name: task.name, state: task.state })
      return reply(task, 201)
    }
    const match = /^\/api\/v1\/my-tasks\/(\d+)(?:\/(comments|attachments|done|reopen|cancel|convert)(?:\/(\d+))?)?$/.exec(path)
    if (!match) return fail('غير موجود.', undefined, 404)
    const id = Number(match[1]), action = match[2], task = tasks.get(id)
    if (!task) return fail('المهمة غير موجودة.', undefined, 404)
    if (!action && method === 'GET') return reply(task)
    if (!action && method === 'PATCH') { const problem = update(task, body); return problem ?? reply(task) }
    if (method === 'POST' && ['done', 'reopen', 'cancel'].includes(action)) {
      task.state = action === 'reopen' ? 'open' : action === 'done' ? 'done' : 'cancelled'
      task.allowed_actions = task.state === 'open' ? { ...openActions(), convert: true } : closedActions()
      task.updated_at = stamp()
      if (task.parent) { const child = tasks.get(task.parent.id)?.subtasks.find(value => value.id === id); if (child) child.state = task.state }
      return reply(task)
    }
    if (action === 'comments') {
      const items = rows(comments, id)
      if (method === 'GET') return reply(envelope(items))
      if (method === 'POST') {
        if (!body.body?.trim() || body.body.length > 5000) return fail('أدخل تعليقًا صالحًا.', 'body')
        const comment = { id: nextId++, body: body.body.trim(), author: ADMIN, created_at: stamp() }; items.push(comment); return reply(comment, 201)
      }
    }
    if (action === 'attachments') {
      const items = rows(attachments, id), metadata = file => { const { data: _data, ...value } = file; return value }
      if (method === 'GET') return reply(envelope(items.map(metadata)))
      if (method === 'POST') {
        if (!body.data || !body.name) return fail('اختر ملفًا صالحًا.', 'data')
        const file = { id: nextId++, name: body.name, mimetype: body.mimetype || 'application/octet-stream', data: body.data }; file.url = `/web/content/${file.id}?download=true`; items.push(file); task.attachment_count = items.length; return reply(metadata(file), 201)
      }
      if (method === 'DELETE') { const index = items.findIndex(value => value.id === Number(match[3])); if (index < 0) return fail('الملف غير موجود.', undefined, 404); items.splice(index, 1); task.attachment_count = items.length; return reply({}) }
    }
    if (action === 'convert' && method === 'POST') {
      const project = PREVIEW_TARGETS.find(value => value.id === body.project_id)
      if (!project) return fail('اختر مشروعًا.', 'project_id')
      task.project = project; tasks.delete(id); converted.set(id, task)
      for (const child of task.subtasks) { const value = tasks.get(child.id); if (value) { value.project = project; tasks.delete(child.id); converted.set(child.id, value) } }
      return reply({ href: `/projects/${project.id}/tasks/${id}` })
    }
    return fail('إجراء غير مدعوم.', undefined, 404)
  }
}
