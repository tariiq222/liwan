from datetime import datetime
from odoo.exceptions import AccessError, UserError
from odoo.tests import new_test_user
from odoo.addons.nasq_pmo.serializers.notification import dump_notification
def section(t): print('\n===== ' + t)
try:
    company = env.company
    emp = new_test_user(env, login='p3_emp', password='p3_emp_pass_123', name='Emp', groups='nasq_core.group_employee')
    mgr = new_test_user(env, login='p3_mgr', password='p3_mgr_pass_123', name='Mgr', groups='nasq_core.group_employee,project.group_project_manager')
    out = new_test_user(env, login='p3_out', password='p3_out_pass_123', name='Outsider', groups='nasq_core.group_employee')
    sysadm = new_test_user(env, login='p3_sys', password='p3_sys_pass_123', name='Sys', groups='base.group_user,base.group_system')
    for u in (emp, mgr, out, sysadm):
        u.write({'tz': 'UTC', 'company_id': company.id, 'company_ids': [(4, company.id)]})
    section('P1 cancel -> accept')
    proj = env['project.project'].create({'name': 'Cancel probe', 'user_id': mgr.id, 'nasq_completion_approval': 'project_manager', 'date': '2031-01-01'})
    task = env['project.task'].create({'name': 'T', 'project_id': proj.id, 'user_ids': [(4, emp.id)]})
    task.with_user(emp)._nasq_request_completion(); task.invalidate_recordset(); rev = task.nasq_completion_revision
    task.with_user(mgr)._nasq_transition('1_canceled'); task.invalidate_recordset()
    print('after cancel state', task.state, 'pending', task.nasq_completion_pending, 'rev', task.nasq_completion_revision, 'can_decide', task.with_user(mgr)._nasq_can_decide_completion())
    try: task.with_user(mgr)._nasq_accept_completion(rev); print('ACCEPT SUCCEEDED state', task.state)
    except Exception as e: print('accept raised', type(e).__name__, e)
    section('P1b ORM direct write cancelled + project archive')
    t1b = env['project.task'].create({'name': 'T1b', 'project_id': proj.id, 'user_ids': [(4, emp.id)]})
    t1b.with_user(emp)._nasq_request_completion(); t1b.invalidate_recordset(); r1b = t1b.nasq_completion_revision
    t1b.with_user(mgr).write({'state': '1_canceled'}); t1b.invalidate_recordset(); print('orm write cancel pending', t1b.nasq_completion_pending)
    t1c = env['project.task'].create({'name': 'T1c', 'project_id': proj.id, 'user_ids': [(4, emp.id)]})
    t1c.with_user(emp)._nasq_request_completion(); t1c.invalidate_recordset()
    proj.with_user(mgr)._nasq_write_as_manager({'active': False}); t1c.invalidate_recordset(); print('project archive pending', t1c.nasq_completion_pending, 'can_decide', t1c.with_user(mgr)._nasq_can_decide_completion())
    proj.with_user(mgr)._nasq_write_as_manager({'active': True})
    section('P2 ORM project.create ineligible approver / no approver / sysadmin non-su')
    for label, user, vals in [
        ('mgr ineligible approver', mgr, {'name': 'B1', 'user_id': mgr.id, 'nasq_completion_approval': 'specific_user', 'nasq_completion_approver_id': out.id, 'date': '2031-01-01'}),
        ('mgr no approver', mgr, {'name': 'B2', 'user_id': mgr.id, 'nasq_completion_approval': 'specific_user', 'date': '2031-01-01'}),
        ('mgr no end date', mgr, {'name': 'B3', 'user_id': mgr.id}),
        ('mgr no manager', mgr, {'name': 'B4', 'user_id': False, 'date': '2031-01-01'}),
        ('sysadmin non-su no end date', sysadm, {'name': 'B5', 'user_id': sysadm.id}),
        ('mgr ok', mgr, {'name': 'B6', 'user_id': mgr.id, 'date': '2031-01-01'}),
    ]:
        try:
            with env.cr.savepoint():
                p = env['project.project'].with_user(user).create(vals); print(label, '-> CREATED', p.nasq_completion_approval)
        except Exception as e: print(label, '-> raised', type(e).__name__, str(e)[:70])
    print('superuser no date ->', bool(env['project.project'].create({'name': 'SU'})))
    section('P3 default_ context')
    try:
        t3 = env['project.task'].with_user(emp).with_context(default_nasq_completion_pending=True, default_nasq_completion_revision=7, default_nasq_completion_requested_by=mgr.id).create({'name': 'ctx', 'project_id': proj.id})
        t3.invalidate_recordset(); print('pending', t3.nasq_completion_pending, 'rev', t3.nasq_completion_revision, 'by', t3.nasq_completion_requested_by)
    except Exception as e: print('raised', type(e).__name__, e)
    t3s = env['project.task'].with_context(default_nasq_completion_pending=True).create({'name': 'ctx-su', 'project_id': proj.id}); t3s.invalidate_recordset(); print('superuser ctx pending', t3s.nasq_completion_pending)
    section('P4 lone end date')
    p4 = env['project.project'].with_user(mgr)._nasq_create_from_policy('Lone end', date_end='2030-12-31'); p4.invalidate_recordset()
    print('create', p4.date_start, p4.date)
    p4.with_user(mgr)._nasq_write_as_manager({'date': '2031-06-30'}); p4.invalidate_recordset(); print('patch date', p4.date_start, p4.date, 'tracking msgs', len(p4.message_ids))
    p4.with_user(mgr)._nasq_write_as_manager({'date_start': '2030-01-01'}); p4.invalidate_recordset(); print('patch start', p4.date_start, p4.date)
    try:
        with env.cr.savepoint(): p4.with_user(mgr)._nasq_write_as_manager({'date': '2029-01-01'}); print('date<start ACCEPTED?!', p4.date)
    except Exception as e: print('date<start raised', type(e).__name__)
    p4.with_user(mgr)._nasq_write_as_manager({'date_start': None, 'date': None}); p4.invalidate_recordset(); print('clear', p4.date_start, p4.date)
    section('P5 partial revocation')
    m5 = new_test_user(env, login='p3_m5', password='p3_m5_pass_123', name='M5', groups='nasq_core.group_employee'); m5.write({'tz': 'UTC', 'company_id': company.id, 'company_ids': [(4, company.id)]})
    pa = env['project.project'].create({'name': 'PA', 'user_id': m5.id, 'privacy_visibility': 'employees', 'company_id': company.id})
    pb = env['project.project'].create({'name': 'PB', 'user_id': m5.id, 'privacy_visibility': 'employees', 'company_id': company.id})
    ta = env['project.task'].create({'name': 'A', 'project_id': pa.id, 'user_ids': [(4, emp.id)], 'date_deadline': datetime(2025,12,31,10)})
    tb = env['project.task'].create({'name': 'B', 'project_id': pb.id, 'user_ids': [(4, emp.id)], 'date_deadline': datetime(2025,12,30,10)})
    env['nasq.pmo.settings'].set_values({'deadline_reminders_enabled': False, 'overdue_digest_enabled': True})
    env['project.task']._nasq_run_deadline_notifications(now=datetime(2026,1,2,10,0,0))
    msg = env['mail.message'].sudo().search([('nasq_notification_kind','=','overdue_digest'),('partner_ids','in',m5.partner_id.id)], limit=1)
    notif = env['mail.notification'].sudo().search([('mail_message_id','=',msg.id)], limit=1)
    pb.write({'user_id': mgr.id, 'privacy_visibility': 'followers'}); pb.message_unsubscribe(partner_ids=[m5.partner_id.id]); tb.message_unsubscribe(partner_ids=[m5.partner_id.id])
    Tu = env['project.task'].with_user(m5).with_company(company)
    live = Tu._nasq_live_digest_tasks(Tu._nasq_digest_snapshot_ids(msg)); print('live', live.mapped('name'))
    row = env['mail.notification'].with_user(m5).sudo().browse(notif.id)
    try: dump_notification(row); print('dump without live SUCCEEDED (bad)')
    except ValueError as e: print('dump without live raises ValueError (good)')
    print('dump with live count', dump_notification(row, live)['overdue_count'])
    section('P6 null deadline sort'); ta.write({'date_deadline': False}); from datetime import datetime as dt
    live2 = Tu._nasq_live_digest_tasks(Tu._nasq_digest_snapshot_ids(msg)); print('sorted', live2.sorted(lambda t: (t.date_deadline or dt.min, t.id)).mapped('name'))
    section('P7 withdraw'); p7 = env['project.project'].create({'name': 'W', 'user_id': mgr.id, 'nasq_completion_approval': 'specific_user', 'nasq_completion_approver_id': mgr.id})
    t7 = env['project.task'].create({'name': 'w', 'project_id': p7.id, 'user_ids': [(4, emp.id), (4, out.id)]})
    t7.with_user(emp)._nasq_request_completion(); t7.invalidate_recordset(); r7 = t7.nasq_completion_revision
    try: t7.with_user(out)._nasq_withdraw_completion(r7); print('OTHER ASSIGNEE WITHDREW (bad)')
    except AccessError as e: print('other assignee withdraw denied')
    try: t7.with_user(emp)._nasq_withdraw_completion(r7 + 1); print('stale withdraw ok?!')
    except UserError: print('stale withdraw rejected')
    t7.with_user(emp)._nasq_withdraw_completion(r7); t7.invalidate_recordset(); print('withdrawn pending', t7.nasq_completion_pending, 'rev', t7.nasq_completion_revision)
finally:
    env.cr.rollback(); print('\nROLLED BACK')
