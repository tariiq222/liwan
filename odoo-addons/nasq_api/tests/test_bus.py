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
