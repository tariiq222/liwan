# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import LiwanPmoCase


@tagged('post_install', '-at_install', 'liwan')
class TestPersonalStagesAndLookups(LiwanPmoCase):

    def test_personal_stages_created_on_first_call(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/me/personal-stages').json()
        self.assertEqual(body['total'], 7)
        self.assertEqual(len(body['items']), 7)
        self.assertEqual([s['sequence'] for s in body['items']], sorted(s['sequence'] for s in body['items']))
        self.assertEqual(set(body['items'][0]), {'id', 'name', 'sequence', 'fold'})
        self.assertEqual(self.api('GET', '/api/v1/me/personal-stages').json(), body, 'idempotent')

    def test_a_read_only_user_gets_their_own_personal_stages_on_the_first_read(self):
        """The first read seeds the caller's own stages; that is the person's bookkeeping, not a business write."""
        fresh = new_test_user(
            self.env, login='ro_stage_user', password='ro_stage_user_pass_123', groups='liwan_core.group_employee',
            liwan_mobile='+966590000031',
        )
        # An account that predates the application, or came up while it was off, has no stages yet.
        self.env.cr.execute('DELETE FROM project_task_user_rel WHERE user_id = %s', [fresh.id])
        self.env.cr.execute('DELETE FROM project_task_type WHERE user_id = %s', [fresh.id])
        self.env.invalidate_all()
        self.env['liwan.entitlement.service'].sudo()._liwan_apply_flags(fresh, {'liwan_read_only': True})
        self.authenticate('ro_stage_user', 'ro_stage_user_pass_123')
        response = self.api('GET', '/api/v1/me/personal-stages')
        self.assertEqual((response.status_code, response.json()['total']), (200, 7), response.text)

    def test_the_stage_list_is_paged_with_a_true_total(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        first = self.api('GET', '/api/v1/me/personal-stages?limit=3').json()
        self.assertEqual((len(first['items']), first['total']), (3, 7))
        second = self.api('GET', '/api/v1/me/personal-stages?limit=3&offset=3').json()
        self.assertEqual((len(second['items']), second['total']), (3, 7))
        rest = self.api('GET', '/api/v1/me/personal-stages?limit=3&offset=6').json()
        self.assertEqual((len(rest['items']), rest['total']), (1, 7))
        ids = [stage['id'] for page in (first, second, rest) for stage in page['items']]
        self.assertEqual(len(set(ids)), 7)
        beyond = self.api('GET', '/api/v1/me/personal-stages?offset=50').json()
        self.assertEqual((beyond['items'], beyond['total']), ([], 7))
        self.assertEqual(self.api('GET', '/api/v1/me/personal-stages?limit=x').status_code, 422)

    def test_personal_stages_are_worded_in_the_company_language(self):
        self.env['res.lang']._activate_lang('ar_001')
        self.env['ir.module.module']._load_module_terms(['project'], ['ar_001'])
        self.env.company.partner_id.lang = 'ar_001'
        names = [vals['name'] for vals in self.env['project.task']._get_default_personal_stage_create_vals(self.employee.id)]
        self.assertNotIn('Inbox', names)
        self.assertTrue(all(any('\u0600' <= char <= '\u06ff' for char in name) for name in names), names)

    def test_projects_minimal(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/projects?minimal=1').json()
        self.assertIn({'id': self.project.id, 'name': 'Erada Portal'}, items)
