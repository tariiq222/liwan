import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export async function seedAllUi(api, baseURL) {
  if (baseURL !== 'http://127.0.0.1:3469') throw new Error('Only the owned scratch runtime3469 may be seeded')
  const call = async (method, url, data) => {
    const r = await api[method](url, data === undefined ? {} : { data })
    if (!r.ok()) throw new Error(`${method} ${url} returned HTTP ${r.status()}`)
    return r.json()
  }
  await call('post', '/api/auth/login', { login: 'admin', password: 'admin' })
  const me = await call('get', '/api/v1/me')
  const stamp = Date.now()
  const project = await call('post', '/api/v1/projects', { name: `فحص جميع الواجهات ${stamp}`, user_id: me.id, date_start: '2026-01-01', date: '2035-12-31' })
  const task = await call('post', '/api/v1/tasks', { name: 'مراجعة مؤشرات التنفيذ', project_id: project.id, date_deadline: '2026-01-05' })
  await call('patch', `/api/v1/tasks/${task.id}`, { user_ids: [me.id] })
  const milestone = await call('post', `/api/v1/projects/${project.id}/milestones`, { name: 'التسليم الأول', deadline: '2030-01-01' })
  const entry = await call('post', `/api/v1/projects/${project.id}/finance`, { kind: 'budget', title: 'الميزانية المعتمدة', amount: 1000 })
  const register = await call('post', `/api/v1/projects/${project.id}/register`, { kind: 'issue', title: 'متابعة التوريد', priority: 'high' })
  const stakeholder = await call('post', `/api/v1/projects/${project.id}/stakeholders`, { name: 'فريق المتابعة', organization: 'إدارة المشاريع', role: 'المتابعة' })
  const template = await call('post', '/api/v1/project-templates', { name: `قالب شامل ${stamp}`, description: 'قالب فحص الواجهة', definition: { stages: [{ key: 'planning', name: 'التخطيط', fold: false }], milestones: [{ key: 'delivery', name: 'التسليم', offset_days: 5 }], tasks: [{ key: 'task', name: 'المراجعة', stage_key: 'planning', start_offset: 0, duration_days: 2, milestone_key: 'delivery', dependency_keys: [] }] } })
  const referenceIds = {}
  for (const resource of ['types', 'owning-units']) referenceIds[resource] = (await call('post', `/api/v1/project-charter/catalogs/${resource}`, { name: `مرجع ${resource} ${stamp}` })).id
  const department = await call('post', '/api/v1/hr/departments', { name: `إدارة الفحص ${stamp}` })
  const employee = await call('post', '/api/v1/hr/employees', { name: 'موظف مراجعة الواجهات', work_email: `all-ui-${stamp}@example.test`, department_id: department.id, job_title: 'منسق المشاريع' })
  const document = await call('post', '/api/v1/hr/documents', { name: 'دليل الإجراءات', body: '<p>محتوى المستند للتحقق من عرضه.</p>', department_id: department.id })
  const roles = await call('get', '/api/v1/admin/roles')
  const employeeRole = roles.items.find(r => r.key === 'employee')
  const user = await call('post', '/api/v1/admin/users', { employee_id: employee.id, password: 'Nasq-Ui-Fixture-2026!', assignments: [{ role_id: employeeRole.id, scope: { kind: 'company', id: me.company.id } }] })
  const role = await call('post', '/api/v1/admin/roles', { name: { ar: `دور المراجعة ${stamp}`, en: null }, description: '', permissions: ['hr.employees.read'] })
  const events = await call('get', `/api/v1/admin/access-log?target_type=role&target_id=${role.id}`)
  if (!events.items.length) throw new Error('Expected a real role-created audit event')
  const meeting = await call('post', '/api/v1/meetings', { name: 'اجتماع مراجعة المشروع', meeting_date: '2026-09-10', agenda: '<p>متابعة مراحل التنفيذ والقرارات.</p>', secretary_id: me.id, attendee_ids: [me.id], project_id: project.id })
  const resolution = await call('post', `/api/v1/meetings/${meeting.id}/resolutions`, { name: 'اعتماد خطة التنفيذ', responsible_id: me.id, deadline: '2030-01-01' })
  const series = await call('post', '/api/v1/meeting-series', { name: `سلسلة متابعة ${stamp}`, recurrence: 'none', secretary_id: me.id, attendee_ids: [me.id] })
  const conversation = await call('post', '/api/v1/chat/conversations', { user_ids: [user.id] })
  await call('post', `/api/v1/chat/conversations/${conversation.id}/messages`, { body: 'رسالة للتأكد من عرض المحادثة في الثيم الموحد.' })
  // Real recipient-owned digest via the existing notification model helper.
  // Never call a pre-existing fixture script by weakening its database guard.
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
  const py = `from datetime import date\nassert env.cr.dbname == 'nasq_nuxt_migration_20260910'\nadmin = env['res.users'].browse(${me.id})\ntask = env['project.task'].browse(${task.id})\nmessage = task._nasq_create_digest_notification(company=admin.company_id, partner=admin.partner_id, body='ملخص المهام المتأخرة', key='all-ui-${stamp}', overdue_count=1, local_date=date.today(), task_ids=[task.id])\nnotification = env['mail.notification'].search([('mail_message_id', '=', message.id), ('res_partner_id', '=', admin.partner_id.id)], limit=1)\nassert notification\nenv.cr.commit()\nprint('ALL_UI_DIGEST=' + str(notification.id))\n`
  const out = execFileSync('/Users/tariq/code/odoo/.venv/bin/python', ['/Users/tariq/code/odoo/odoo-bin', 'shell', '-c', '/Users/tariq/code/odoo/odoo.conf', '--addons-path=/Users/tariq/code/odoo/addons,' + repo + '/odoo-addons', '-d', 'nasq_nuxt_migration_20260910', '--no-http'], { input: py, encoding: 'utf8', timeout: 60000, cwd: '/Users/tariq/code/odoo', stdio: ['pipe', 'pipe', 'pipe'] })
  const digest = out.match(/ALL_UI_DIGEST=(\d+)/)
  if (!digest) throw new Error('Digest creation did not return an ID')
  const fixtures = { projectId: project.id, taskId: task.id, milestoneId: milestone.id, entryId: entry.id, registerId: register.id, stakeholderId: stakeholder.id, templateId: template.id, referenceIds, departmentId: department.id, documentId: document.id, employeeId: employee.id, userId: user.id, roleId: role.id, eventId: events.items[0].id, meetingId: meeting.id, resolutionId: resolution.id, seriesId: series.id, conversationId: conversation.id, digestNotificationId: Number(digest[1]) }
  await call('get', `/api/v1/notification-digests/${fixtures.digestNotificationId}`)
  return fixtures
}
