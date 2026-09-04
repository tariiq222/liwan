# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields

from odoo.addons.nasq_api.tests.common import NasqApiCase


class NasqPmoCase(NasqApiCase):
    """The shared nasq_api fixture plus the project/task records the PMO
    endpoints are exercised against."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = cls.env['project.project'].create({'name': 'Erada Portal'})
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
