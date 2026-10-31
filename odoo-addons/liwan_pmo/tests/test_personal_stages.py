# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanPmoCase


@tagged('post_install', '-at_install', 'liwan')
class TestPersonalStagesAndLookups(LiwanPmoCase):

    def test_personal_stages_created_on_first_call(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        stages = self.api('GET', '/api/v1/me/personal-stages').json()
        self.assertEqual(len(stages), 7)
        self.assertEqual([s['sequence'] for s in stages], sorted(s['sequence'] for s in stages))
        self.assertEqual(set(stages[0]), {'id', 'name', 'sequence', 'fold'})
        self.assertEqual(self.api('GET', '/api/v1/me/personal-stages').json(), stages, 'idempotent')

    def test_personal_stages_are_worded_in_the_company_language(self):
        self.env['res.lang']._activate_lang('ar_001')
        self.env['ir.module.module']._load_module_terms(['project'], ['ar_001'])
        self.env.company.partner_id.lang = 'ar_001'
        self.authenticate('api_emp', 'api_emp_pass_123')
        names = [stage['name'] for stage in self.api('GET', '/api/v1/me/personal-stages').json()]
        self.assertNotIn('Inbox', names)
        self.assertTrue(all(any('\u0600' <= char <= '\u06ff' for char in name) for name in names), names)

    def test_projects_minimal(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/projects?minimal=1').json()
        self.assertIn({'id': self.project.id, 'name': 'Erada Portal'}, items)
