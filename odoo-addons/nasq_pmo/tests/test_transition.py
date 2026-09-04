# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('nasq')
class TestTransition(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee = new_test_user(cls.env, login='pmo_emp', groups='nasq_core.group_employee')
        cls.manager = new_test_user(cls.env, login='pmo_mgr', groups='nasq_core.group_employee,project.group_project_manager')
        cls.project = cls.env['project.project'].create({'name': 'P1'})
        cls.task = cls.env['project.task'].create({
            'name': 'T1', 'project_id': cls.project.id, 'user_ids': [(4, cls.employee.id)],
        })

    def test_employee_can_close_and_reopen(self):
        task = self.task.with_user(self.employee)
        task._nasq_transition('1_done')
        self.assertEqual(task.state, '1_done')
        self.assertTrue(task.date_end)
        task._nasq_transition('01_in_progress')
        self.assertEqual(task.state, '01_in_progress')

    def test_employee_cannot_approve(self):
        task = self.task.with_user(self.employee)
        self.assertFalse(task._nasq_can_approve())
        with self.assertRaises(AccessError):
            task._nasq_transition('03_approved')
        with self.assertRaises(AccessError):
            task._nasq_transition('02_changes_requested')

    def test_manager_can_approve(self):
        task = self.task.with_user(self.manager)
        self.assertTrue(task._nasq_can_approve())
        task._nasq_transition('03_approved')
        self.assertEqual(task.state, '03_approved')
        task._nasq_transition('02_changes_requested')
        self.assertEqual(task.state, '02_changes_requested')

    def test_customer_admin_can_approve(self):
        admin = new_test_user(self.env, login='pmo_cadmin', groups='nasq_core.group_customer_admin')
        self.assertTrue(self.task.with_user(admin)._nasq_can_approve())
        self.task.with_user(admin)._nasq_transition('02_changes_requested')
        self.assertEqual(self.task.state, '02_changes_requested')

    def test_unknown_state_rejected(self):
        with self.assertRaises(ValueError):
            self.task._nasq_transition('99_nope')

    def test_reopen_batch_keeps_open_tasks_date_end(self):
        task2 = self.env['project.task'].create({
            'name': 'T2', 'project_id': self.project.id, 'user_ids': [(4, self.employee.id)],
        })
        task2.write({'date_end': fields.Datetime.now()})
        self.task.with_user(self.employee)._nasq_transition('1_done')
        (self.task | task2).with_user(self.manager)._nasq_transition('01_in_progress')
        self.assertFalse(self.task.date_end)
        self.assertTrue(task2.date_end)
        self.assertEqual(self.task.state, '01_in_progress')
        self.assertEqual(task2.state, '01_in_progress')
