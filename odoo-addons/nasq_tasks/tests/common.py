# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import new_test_user

from odoo.addons.nasq_api.tests.common import NasqApiCase


class NasqTasksCase(NasqApiCase):
    """The shared nasq_api fixture plus three employees and one in a second company."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.alice = cls._employee('tasks_alice', 'Alice')
        cls.bob = cls._employee('tasks_bob', 'Bob')
        cls.carol = cls._employee('tasks_carol', 'Carol')
        cls.other_company = cls.env['res.company'].create({'name': 'Other company'})
        cls.other_company_user = new_test_user(
            cls.env, login='tasks_other_company', password='tasks_other_company_pass_123',
            name='Other company user', groups='nasq_core.group_employee',
            company_id=cls.other_company.id, company_ids=[Command.set(cls.other_company.ids)],
        )

    @classmethod
    def _employee(cls, login, name):
        return new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', name=name,
            groups='nasq_core.group_employee',
        )

    def make_personal_task(self, user, name='t', assignees=None):
        """Create a project-less task as ``user``, assigned to ``assignees`` (user ids).

        Odoo leaves ``company_id`` empty on a task without a project; the service
        layer sets the caller's company, and so does this helper.
        """
        return self.env['project.task'].with_user(user).create({
            'name': name,
            'company_id': user.company_id.id,
            'user_ids': [Command.set(assignees if assignees is not None else [user.id])],
        })
