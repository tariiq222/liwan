# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('nasq')
class TestTaskBus(TransactionCase):

    def test_write_notifies_old_and_new_assignees_and_writer(self):
        a = new_test_user(self.env, login='bus_a', groups='nasq_core.group_employee')
        b = new_test_user(self.env, login='bus_b', groups='nasq_core.group_employee')
        mgr = new_test_user(self.env, login='bus_mgr', groups='nasq_core.group_employee,project.group_project_manager')
        project = self.env['project.project'].create({'name': 'Bus'})
        task = self.env['project.task'].create({'name': 'T', 'project_id': project.id, 'user_ids': [(4, a.id)]})
        with patch.object(type(self.env['bus.bus']), '_sendone') as sendone:
            task.with_user(mgr).write({'user_ids': [(6, 0, [b.id])]})
        calls = [call for call in sendone.call_args_list if call.args[1] == 'nasq/task']
        targets = {call.args[0] for call in calls}
        self.assertEqual(targets, {a.partner_id, b.partner_id, mgr.partner_id})
        for call in calls:
            self.assertEqual(call.args[2], {'id': task.id, 'event': 'updated'})

    def test_create_notifies_assignees(self):
        a = new_test_user(self.env, login='bus_c', groups='nasq_core.group_employee')
        project = self.env['project.project'].create({'name': 'Bus2'})
        with patch.object(type(self.env['bus.bus']), '_sendone') as sendone:
            task = self.env['project.task'].with_user(a).create({'name': 'T2', 'project_id': project.id, 'user_ids': [(4, a.id)]})
        calls = [call for call in sendone.call_args_list if call.args[1] == 'nasq/task']
        self.assertEqual(calls[-1].args, (a.partner_id, 'nasq/task', {'id': task.id, 'event': 'created'}))

    def test_tracked_write_notifies_once(self):
        # A write() that changes a tracked field with a resolved subtype
        # (e.g. stage_id, see project/models/project_task.py's
        # _track_subtype: "if 'stage_id' in init_values: return
        # self.env.ref('project.mt_task_stage')") defers a tracking message
        # via _track_finalize(), which posts through message_post() with
        # message_type='notification'. Before the fix, the unconditional
        # _message_post_after_hook() notified for that tracking message too,
        # so the write notified twice for a single user action - once from
        # write() itself, once for the tracking message it triggered. Only
        # one notification per target partner should be emitted.
        #
        # (stage_id, not state, deliberately: changing 'state' also goes
        # through project.task's own write() override, which - for that
        # field only - performs a second, separate super().write() call via
        # a plain field assignment (`task.date_last_stage_update = now`,
        # project/models/project_task.py). That is a distinct, pre-existing
        # double-write path unrelated to message_post/tracking, and out of
        # scope for this fix.)
        a = new_test_user(self.env, login='bus_e', groups='nasq_core.group_employee')
        project = self.env['project.project'].create({'name': 'Bus4'})
        stage1 = self.env['project.task.type'].create({'name': 'Stage1', 'project_ids': [(4, project.id)]})
        stage2 = self.env['project.task.type'].create({'name': 'Stage2', 'project_ids': [(4, project.id)]})
        task = self.env['project.task'].create({
            'name': 'T4', 'project_id': project.id, 'user_ids': [(4, a.id)], 'stage_id': stage1.id,
        })
        with patch.object(type(self.env['bus.bus']), '_sendone') as sendone:
            task.write({'stage_id': stage2.id})
            self.env.flush_all()
            self.env.cr.precommit.run()
        calls = [call for call in sendone.call_args_list if call.args[1] == 'nasq/task']
        targets = [call.args[0] for call in calls]
        self.assertIn(a.partner_id, targets)
        self.assertEqual(targets.count(a.partner_id), 1, f"expected exactly one notification per partner, got {targets}")
        for call in calls:
            self.assertEqual(call.args[2], {'id': task.id, 'event': 'updated'})

    def test_comment_notifies_assignee(self):
        # message_post() doesn't go through write(), so without
        # _message_post_after_hook a comment would never reach a second tab
        # watching the task over the bus - see project_task.py.
        a = new_test_user(self.env, login='bus_d', groups='nasq_core.group_employee')
        project = self.env['project.project'].create({'name': 'Bus3'})
        task = self.env['project.task'].create({'name': 'T3', 'project_id': project.id, 'user_ids': [(4, a.id)]})
        with patch.object(type(self.env['bus.bus']), '_sendone') as sendone:
            task.message_post(body='hi', message_type='comment', subtype_xmlid='mail.mt_comment')
        calls = [call for call in sendone.call_args_list if call.args[1] == 'nasq/task']
        targets = {call.args[0] for call in calls}
        self.assertIn(a.partner_id, targets)
        for call in calls:
            self.assertEqual(call.args[2], {'id': task.id, 'event': 'updated'})
