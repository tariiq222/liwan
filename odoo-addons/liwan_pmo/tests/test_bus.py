# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import PropertyMock, patch

from odoo.exceptions import AccessError, MissingError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_pmo.serializers.task import dump_task_detail


@tagged('post_install', '-at_install', 'liwan')
class TestTaskBus(TransactionCase):

    def _assert_write_payload(self, payload, task, changed_fields):
        self.assertEqual(set(payload), {'id', 'event', 'source', 'updated_at', 'changed_fields'})
        self.assertEqual((payload['id'], payload['event'], payload['source']), (task.id, 'updated', 'write'))
        self.assertEqual(payload['updated_at'], iso(task.write_date, timespec='microseconds'))
        self.assertEqual(payload['changed_fields'], sorted(set(payload['changed_fields'])))
        self.assertLessEqual(set(changed_fields), set(payload['changed_fields']))

    def test_write_notifies_old_and_new_assignees_and_writer(self):
        a = new_test_user(self.env, login='bus_a', groups='liwan_core.group_employee')
        b = new_test_user(self.env, login='bus_b', groups='liwan_core.group_employee')
        mgr = new_test_user(self.env, login='bus_mgr', groups='liwan_core.group_employee,project.group_project_manager')
        project = self.env['project.project'].create({'name': 'Bus'})
        task = self.env['project.task'].create({'name': 'T', 'project_id': project.id, 'user_ids': [(4, a.id)]})
        # Notifications are now accumulated on the cursor's precommit data
        # and only actually sent by the precommit hook registered in
        # _liwan_notify() - flush the ones queued by setup (task creation
        # above) before patching _sendone, so only the write() under test is
        # observed below.
        self.env.flush_all()
        self.env.cr.precommit.run()
        with patch.object(type(self.env['bus.bus']), '_sendone') as sendone:
            task.with_user(mgr).write({'user_ids': [(6, 0, [b.id])]})
            self.env.flush_all()
            self.env.cr.precommit.run()
        calls = [call for call in sendone.call_args_list if call.args[1] == 'liwan/task']
        targets = [call.args[0] for call in calls]
        for partner in (a.partner_id, b.partner_id, mgr.partner_id):
            self.assertEqual(targets.count(partner), 1, f"expected exactly one notification per partner, got {targets}")
        self.assertEqual(len(targets), 3, f"expected no notifications to unrelated partners, got {targets}")
        for call in calls:
            self._assert_write_payload(call.args[2], task, {'user_ids'})

    def test_create_notifies_assignees(self):
        # project.task's own create() override writes computed fields (e.g.
        # date_assign, when user_ids is set at creation) back onto the new
        # record via a plain task.write(...) call made *inside* create(),
        # before liwan_pmo's create() override gets to call
        # _liwan_notify('created') on the result. So a create() with
        # user_ids set legitimately queues both an 'updated' triple (from
        # that internal write()) and a 'created' triple (from create()
        # itself) in the same transaction - both are genuine, distinct
        # (partner, task, event) triples and _liwan_notify() sends both (see
        # its docstring: it dedupes identical triples, it doesn't collapse
        # 'created' and 'updated' into one). Assert presence, not order.
        a = new_test_user(self.env, login='bus_c', groups='liwan_core.group_employee')
        project = self.env['project.project'].create({'name': 'Bus2'})
        self.env.flush_all()
        self.env.cr.precommit.run()
        with patch.object(type(self.env['bus.bus']), '_sendone') as sendone:
            task = self.env['project.task'].with_user(a).create({'name': 'T2', 'project_id': project.id, 'user_ids': [(4, a.id)]})
            self.env.flush_all()
            self.env.cr.precommit.run()
        calls = [call for call in sendone.call_args_list if call.args[1] == 'liwan/task']
        self.assertIn(
            (a.partner_id, 'liwan/task', {'id': task.id, 'event': 'created'}),
            [call.args for call in calls],
        )

    def test_tracked_write_notifies_once(self):
        # A write() that changes a tracked field with a resolved subtype
        # (e.g. stage_id, see project/models/project_task.py's
        # _track_subtype: "if 'stage_id' in init_values: return
        # self.env.ref('project.mt_task_stage')") defers a tracking message
        # via _track_finalize(), which posts through message_post() with
        # message_type='notification'. Before the round-2 fix, the
        # unconditional _message_post_after_hook() notified for that
        # tracking message too, so the write notified twice for a single
        # user action - once from write() itself, once for the tracking
        # message it triggered. Only one notification per target partner
        # should be emitted.
        #
        # (stage_id, not state, deliberately: changing 'state' also goes
        # through project.task's own write() override, which - for that
        # field only - performs a second, separate super().write() call via
        # a plain field assignment (`task.date_last_stage_update = now`,
        # project/models/project_task.py). That double-write is now
        # collapsed by _liwan_notify()'s own precommit dedup - see
        # test_state_change_notifies_once below.)
        a = new_test_user(self.env, login='bus_e', groups='liwan_core.group_employee')
        project = self.env['project.project'].create({'name': 'Bus4'})
        stage1 = self.env['project.task.type'].create({'name': 'Stage1', 'project_ids': [(4, project.id)]})
        stage2 = self.env['project.task.type'].create({'name': 'Stage2', 'project_ids': [(4, project.id)]})
        task = self.env['project.task'].create({
            'name': 'T4', 'project_id': project.id, 'user_ids': [(4, a.id)], 'stage_id': stage1.id,
        })
        self.env.flush_all()
        self.env.cr.precommit.run()
        with patch.object(type(self.env['bus.bus']), '_sendone') as sendone:
            task.write({'stage_id': stage2.id})
            self.env.flush_all()
            self.env.cr.precommit.run()
        calls = [call for call in sendone.call_args_list if call.args[1] == 'liwan/task']
        targets = [call.args[0] for call in calls]
        self.assertIn(a.partner_id, targets)
        self.assertEqual(targets.count(a.partner_id), 1, f"expected exactly one notification per partner, got {targets}")
        for call in calls:
            self._assert_write_payload(call.args[2], task, {'stage_id'})

    def test_state_change_notifies_once(self):
        # Regression test for round 3: project.task's own write() override
        # does a plain field assignment (`task.date_last_stage_update =
        # now`) whenever 'state' is in vals. For a stored field, that
        # assignment triggers a second, independent records.write() call
        # that recurses through the entire write() stack, including this
        # module's override - double-firing _liwan_notify('updated') for a
        # single user action. _liwan_notify()'s precommit accumulation into
        # a mapping, drained once by a single precommit callback, must collapse
        # this into exactly one notification per target partner.
        a = new_test_user(self.env, login='bus_f', groups='liwan_core.group_employee')
        project = self.env['project.project'].create({'name': 'Bus5'})
        task = self.env['project.task'].create({'name': 'T5', 'project_id': project.id, 'user_ids': [(4, a.id)]})
        self.env.flush_all()
        self.env.cr.precommit.run()
        with patch.object(type(self.env['bus.bus']), '_sendone') as sendone:
            task.write({'state': '1_done'})
            self.env.flush_all()
            self.env.cr.precommit.run()
        calls = [call for call in sendone.call_args_list if call.args[1] == 'liwan/task']
        targets = [call.args[0] for call in calls]
        self.assertIn(a.partner_id, targets)
        self.assertIn(self.env.user.partner_id, targets)
        for partner in (a.partner_id, self.env.user.partner_id):
            self.assertEqual(targets.count(partner), 1, f"expected exactly one notification per partner, got {targets}")
        for call in calls:
            self._assert_write_payload(call.args[2], task, {'state', 'date_last_stage_update'})

    def test_write_stamp_matches_detail_and_unions_fields(self):
        project = self.env['project.project'].create({'name': 'Bus revisions'})
        task = self.env['project.task'].create({'name': 'Revision', 'project_id': project.id})
        self.env.flush_all()
        self.env.cr.precommit.run()
        with patch.object(type(self.env['bus.bus']), '_sendone') as sendone:
            task.write({'name': 'Revised'})
            task.write({'priority': '1'})
            detail_stamp = dump_task_detail(task)['updated_at']
            self.env.flush_all()
            self.env.cr.precommit.run()
        calls = [call for call in sendone.call_args_list if call.args[1] == 'liwan/task']
        self.assertEqual(len(calls), 1)
        self._assert_write_payload(calls[0].args[2], task, {'name', 'priority'})
        self.assertEqual(calls[0].args[2]['updated_at'], detail_stamp)

    def test_comment_and_unknown_origin_dominate_merged_write(self):
        project = self.env['project.project'].create({'name': 'Bus comments'})
        task = self.env['project.task'].create({'name': 'Comments', 'project_id': project.id})
        self.env.flush_all()
        self.env.cr.precommit.run()
        for origin in ('comment', 'unknown'):
            for write_first in (True, False):
                with self.subTest(origin=origin, write_first=write_first):
                    with patch.object(type(self.env['bus.bus']), '_sendone') as sendone:
                        if write_first:
                            task.write({'name': f'{origin} first'})
                        if origin == 'comment':
                            task.message_post(body='hi', message_type='comment', subtype_xmlid='mail.mt_comment')
                        else:
                            task._liwan_notify('updated')
                        if not write_first:
                            task.write({'name': f'{origin} last'})
                        self.env.flush_all()
                        self.env.cr.precommit.run()
                    calls = [call for call in sendone.call_args_list if call.args[1] == 'liwan/task']
                    self.assertEqual(len(calls), 1)
                    self.assertEqual(calls[0].args[2], {'id': task.id, 'event': 'updated'})

    def test_unavailable_revision_emits_conservative_notification(self):
        project = self.env['project.project'].create({'name': 'Bus unavailable revision'})
        task = self.env['project.task'].create({'name': 'Unavailable', 'project_id': project.id})
        self.env.flush_all()
        self.env.cr.precommit.run()
        for error in (AccessError, MissingError):
            with self.subTest(error=error.__name__):
                with patch.object(type(self.env['bus.bus']), '_sendone') as sendone:
                    with patch.object(type(task), 'write_date', new_callable=PropertyMock, side_effect=error('unavailable')):
                        task._liwan_notify('updated', changed_fields={'name'})
                    self.env.cr.precommit.run()
                calls = [call for call in sendone.call_args_list if call.args[1] == 'liwan/task']
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0].args[2], {'id': task.id, 'event': 'updated'})

    def test_comment_notifies_assignee(self):
        # message_post() doesn't go through write(), so without
        # _message_post_after_hook a comment would never reach a second tab
        # watching the task over the bus - see project_task.py.
        a = new_test_user(self.env, login='bus_d', groups='liwan_core.group_employee')
        project = self.env['project.project'].create({'name': 'Bus3'})
        task = self.env['project.task'].create({'name': 'T3', 'project_id': project.id, 'user_ids': [(4, a.id)]})
        self.env.flush_all()
        self.env.cr.precommit.run()
        write_date = task.write_date
        with patch.object(type(self.env['bus.bus']), '_sendone') as sendone:
            task.message_post(body='hi', message_type='comment', subtype_xmlid='mail.mt_comment')
            self.assertEqual(task.write_date, write_date)
            self.env.flush_all()
            self.env.cr.precommit.run()
        calls = [call for call in sendone.call_args_list if call.args[1] == 'liwan/task']
        targets = [call.args[0] for call in calls]
        self.assertIn(a.partner_id, targets)
        self.assertEqual(targets.count(a.partner_id), 1, f"expected exactly one notification per partner, got {targets}")
        for call in calls:
            self.assertEqual(call.args[2], {'id': task.id, 'event': 'updated'})
