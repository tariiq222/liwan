import json, os
exp = json.load(open(os.environ['PSC_EXPECTED']))
P = env['project.project'].sudo().with_context(active_test=False); T = env['project.task'].sudo().with_context(active_test=False)
fails = []
for pid, e in exp['projects'].items():
    p = P.browse(int(pid))
    got = {'name': p.name, 'user_id': p.user_id.id, 'date_start': str(p.date_start or ''), 'date': str(p.date or ''), 'active': p.active, 'stage_ids': p.type_ids.ids}
    if got != e: fails.append(('project', pid, e, got))
    if p.nasq_completion_approval != 'none' or p.nasq_completion_approver_id: fails.append(('project approval not none', pid))
for tid, e in exp['tasks'].items():
    t = T.browse(int(tid))
    got = {'name': t.name, 'state': t.state, 'active': t.active, 'project_id': t.project_id.id}
    if got != e: fails.append(('task', tid, e, got))
    if t.nasq_completion_pending or t.nasq_completion_revision: fails.append(('task meta dirty', tid))
s = env['nasq.pmo.settings'].get()
if {k: s[k] for k in exp['settings']} != exp['settings']: fails.append(('settings', s))
new_defaults = {k: s[k] for k in ('require_manager_on_create','require_end_date_on_create','default_completion_approval','deadline_reminders_enabled','deadline_reminders_days_before','overdue_digest_enabled')}
if new_defaults != {'require_manager_on_create': True, 'require_end_date_on_create': True, 'default_completion_approval': 'none', 'deadline_reminders_enabled': True, 'deadline_reminders_days_before': 1, 'overdue_digest_enabled': True}: fails.append(('new defaults', new_defaults))
cron = env.ref('nasq_pmo.ir_cron_nasq_deadline_notifications')
if (cron.id, cron.active, [cron.interval_number, cron.interval_type], cron.code) != (exp['cron']['id'], exp['cron']['active'], exp['cron']['interval'], exp['cron']['code']): fails.append(('cron', cron.read(['active','interval_number','interval_type','code'])))
counts = {'projects': P.search_count([]), 'tasks': T.search_count([]), 'params': env['ir.config_parameter'].sudo().search_count([('key','like','nasq_pmo.%')])}
if counts != exp['counts']: fails.append(('counts', exp['counts'], counts))
# legacy incomplete projects remain editable by their manager
mgr = env['res.users'].browse(exp['users']['mgr'])
for pid, e in exp['projects'].items():
    p = env['project.project'].with_user(mgr).browse(int(pid))
    if not p.user_id or p.user_id.id != mgr.id: continue
    try:
        with env.cr.savepoint():
            p._nasq_write_as_manager({'name': p.name + ' edited'}); p._nasq_write_as_manager({'date': '2032-01-01'}); p.invalidate_recordset()
            if str(p.date) != '2032-01-01': fails.append(('legacy date edit not persisted', pid, str(p.date), str(p.date_start)))
            raise Exception('rollback-probe')
    except Exception as ex:
        if str(ex) != 'rollback-probe': fails.append(('legacy edit raised', pid, type(ex).__name__, str(ex)[:80]))
print('VERIFY_RESULT', 'OK' if not fails else 'FAIL', json.dumps(fails, default=str)[:1500])
