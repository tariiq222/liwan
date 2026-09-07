# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('nasq')
class TestProjectStatus(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee = new_test_user(cls.env, login='pmo_emp', groups='nasq_core.group_employee')
        cls.manager = new_test_user(cls.env, login='pmo_mgr',
                                    groups='nasq_core.group_employee,project.group_project_manager')
        cls.project = cls.env['project.project'].create({'name': 'Status project'})

    def test_manager_sets_status_and_odoo_records_an_update(self):
        project = self.project.with_user(self.manager)
        self.assertEqual(project.last_update_status, 'to_define')
        project._nasq_set_status('at_risk')
        self.assertEqual(project.last_update_status, 'at_risk')
        update = self.env['project.update'].search([('project_id', '=', self.project.id)])
        self.assertEqual(len(update), 1)
        self.assertEqual(update.status, 'at_risk')

    def test_employee_cannot_set_status(self):
        with self.assertRaises(AccessError):
            self.project.with_user(self.employee)._nasq_set_status('on_track')
        self.assertEqual(self.project.last_update_status, 'to_define')

    def test_unknown_value_is_a_value_error(self):
        with self.assertRaises(ValueError):
            self.project.with_user(self.manager)._nasq_set_status('to_define')

    def test_can_manage(self):
        self.assertFalse(self.project.with_user(self.employee)._nasq_can_manage())
        self.assertTrue(self.project.with_user(self.manager)._nasq_can_manage())
