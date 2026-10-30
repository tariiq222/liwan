# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.exceptions import MissingError
from odoo.tests import new_test_user

from odoo.addons.liwan_api.tests.common import LiwanApiCase


def _no_actual_source(model, *_args, **_kwargs):
    raise MissingError(model.env._("This project has no external actual cost."))


# What the hooks of liwan.project.actual.source answer when no bridge fills them.
MANUAL_ACTUAL_SOURCE = {
    '_liwan_is_external': False,
    '_liwan_actual_totals': {},
    '_liwan_actual_account': None,
    '_liwan_can_read_actual_lines': False,
    '_liwan_can_choose_actual_account': False,
}


class LiwanPmoCase(LiwanApiCase):
    """The shared liwan_api fixture plus the project/task records the PMO
    endpoints are exercised against.

    The tests exercise plain PMO, so the hooks of a bridge that may be installed (the actual cost source and
    the project settings extensions) answer as if none were; tests of those extension points patch them again."""

    def setUp(self):
        super().setUp()
        source = type(self.env['liwan.project.actual.source'])
        for name, answer in MANUAL_ACTUAL_SOURCE.items():
            self.patch(source, name, lambda _model, *_args, _answer=answer, **_kwargs: _answer)
        self.patch(source, '_liwan_actual_lines', _no_actual_source)
        self.patch(source, '_liwan_set_actual_account', _no_actual_source)
        self.patch(type(self.env['liwan.pmo.settings']), '_liwan_settings_extensions', lambda _model: [])

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.manager = new_test_user(cls.env, login='api_mgr', password='api_mgr_pass_123',
                                    name='Mona', groups='liwan_core.group_employee,project.group_project_manager')
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
