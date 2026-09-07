import json
from datetime import datetime, timedelta
from odoo.tests import new_test_user
company = env.company
mgr = new_test_user(env, login='lg_mgr', password='lg_mgr_pass_12345', name='LegacyMgr', groups='nasq_core.group_employee,project.group_project_manager')
emp = new_test_user(env, login='lg_emp', password='lg_emp_pass_12345', name='LegacyEmp', groups='nasq_core.group_employee')
P = env['project.project']; T = env['project.task']
p_nodates = P.with_user(mgr)._nasq_create_from_policy('Legacy no dates')
p_startonly = P.create({'name': 'Legacy start only', 'user_id': mgr.id, 'date_start': '2026-01-01'})
p_nomgr = P.create({'name': 'Legacy no manager', 'user_id': False})
p_both = P.create({'name': 'Legacy both', 'user_id': mgr.id, 'date_start': '2026-01-01', 'date': '2026-12-31'})
t_open = T.create({'name': 'open', 'project_id': p_nodates.id, 'user_ids': [(4, emp.id)], 'date_deadline': datetime.now() - timedelta(days=2)})
t_done = T.create({'name': 'done', 'project_id': p_nodates.id, 'user_ids': [(4, emp.id)], 'state': '1_done'})
t_cancel = T.create({'name': 'cancelled', 'project_id': p_both.id, 'state': '1_canceled'})
t_arch = T.create({'name': 'archived', 'project_id': p_both.id}); t_arch.write({'active': False})
env['nasq.pmo.settings'].set_values({'project_creators': 'employees', 'default_stages': [{'name': 'قديم', 'fold': False}, {'name': 'منجز', 'fold': True}]})
cron = env.ref('nasq_pmo.ir_cron_nasq_deadline_notifications')
snap = {
  'projects': {str(p.id): {'name': p.name, 'user_id': p.user_id.id, 'date_start': str(p.date_start or ''), 'date': str(p.date or ''), 'active': p.active, 'stage_ids': p.type_ids.ids} for p in (p_nodates, p_startonly, p_nomgr, p_both)},
  'tasks': {str(t.id): {'name': t.name, 'state': t.state, 'active': t.active, 'project_id': t.project_id.id} for t in (t_open, t_done, t_cancel, t_arch)},
  'settings': env['nasq.pmo.settings'].get(),
  'cron': {'id': cron.id, 'active': cron.active, 'interval': [cron.interval_number, cron.interval_type], 'code': cron.code},
  'counts': {'projects': P.sudo().with_context(active_test=False).search_count([]), 'tasks': T.sudo().with_context(active_test=False).search_count([]), 'params': env['ir.config_parameter'].sudo().search_count([('key','like','nasq_pmo.%')])},
  'users': {'mgr': mgr.id, 'emp': emp.id},
}
env.cr.commit()
print('SEED ' + json.dumps(snap))
