# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.tests import new_test_user

from odoo.addons.nasq_api.tests.common import NasqApiCase


class NasqPmoCase(NasqApiCase):
    """The shared nasq_api fixture plus the project/task records the PMO
    endpoints are exercised against."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.manager = new_test_user(cls.env, login='api_mgr', password='api_mgr_pass_123',
                                    name='Mona', groups='nasq_core.group_employee,project.group_project_manager')
        cls.project = cls.env['project.project'].create({
            'name': 'Erada Portal', 'company_id': cls.env.company.id,
        })
        now = fields.Datetime.now()
        cls.task_overdue = cls.env['project.task'].create({
            'name': 'Overdue task', 'project_id': cls.project.id,
            'user_ids': [(4, cls.employee.id)], 'date_deadline': now - timedelta(days=3), 'priority': '1',
        })
        cls.task_done = cls.env['project.task'].create({
            'name': 'Done task', 'project_id': cls.project.id,
            'user_ids': [(4, cls.employee.id)], 'state': '1_done',
        })
        cls.task_other = cls.env['project.task'].create({
            'name': 'Someone else', 'project_id': cls.project.id, 'user_ids': [(4, cls.manager.id)],
        })
