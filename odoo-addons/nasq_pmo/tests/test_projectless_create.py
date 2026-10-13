# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import NasqPmoCase
from odoo.addons.nasq_pmo.models.project_task import ProjectTask


@tagged('post_install', '-at_install', 'nasq')
class TestProjectlessCreateHook(NasqPmoCase):
    def test_projectless_create_still_rejected_by_default(self):
        """Without an addon that answers the hook, PMO keeps requiring a project."""
        Task = self.env['project.task']
        # The hook's own default, whatever bridge is installed alongside.
        with patch.object(
            type(Task), '_nasq_projectless_create_allowed', return_value=False,
        ), self.assertRaisesRegex(AccessError, 'A visible current-company project is required'):
            Task.with_user(self.employee).create({
                'name': 'no project', 'company_id': self.env.company.id,
            })

    def test_hook_default_is_false(self):
        """PMO's own implementation never waives the project requirement."""
        self.assertFalse(ProjectTask._nasq_projectless_create_allowed(
            self.env['project.task'], [{'name': 'x'}],
        ))
