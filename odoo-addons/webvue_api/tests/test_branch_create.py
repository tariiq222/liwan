# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_api.tests.common import WebVueApiCase
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'webvue')
class TestBranchCreateApi(WebVueApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.profile = cls.env.ref('webvue_platform.tenant_profile')
        cls.profile._webvue_initialize_legacy_policy(
            cls.env['webvue.feature.registry']._webvue_installed_module_ids(),
        )
        cls.admin = new_test_user(
            cls.env, login='branch_create_admin', password='branch_create_password', groups='base.group_user',
            company_id=cls.company.id, company_ids=[Command.set(cls.company.ids)],
        )
        cls.env['webvue.access.assignment'].create({
            'user_id': cls.admin.id, 'role_id': cls.env.ref('webvue_core.role_system_admin').id,
            'company_id': cls.company.id,
        })

    def _set_limit(self, limit):
        self.profile.with_context(**{OPERATOR_CONTEXT: True}).write(
            {'features': {**self.profile.features, 'branches.extra_limit': limit}},
        )

    def test_admin_creates_branches_up_to_the_limit(self):
        self._set_limit(1)
        self.authenticate('branch_create_admin', 'branch_create_password')
        created = self.api('POST', '/api/v1/admin/branches', json={'name': '  Riyadh branch '})
        self.assertEqual(created.status_code, 200, created.text)
        body = created.json()
        self.assertEqual(body['name'], 'Riyadh branch')
        company = self.env['res.company'].browse(body['id'])
        self.assertEqual(company.parent_id, self.company)
        self.assertEqual(self.env['webvue.tenant.branch'].search([('company_id', '=', company.id)]).state, 'active')
        blocked = self.api('POST', '/api/v1/admin/branches', json={'name': 'Second'})
        self.assertEqual(blocked.status_code, 403, blocked.text)
        self.assertEqual(self.env['webvue.tenant.branch'].search_count([('state', '=', 'active')]), 1)

    def test_requires_company_manage_and_a_valid_body(self):
        self._set_limit(5)
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('POST', '/api/v1/admin/branches', json={'name': 'X'}).status_code, 403)
        self.authenticate('branch_create_admin', 'branch_create_password')
        self.assertEqual(self.api('POST', '/api/v1/admin/branches', json={'name': '   '}).status_code, 422)
        self.assertEqual(self.api('POST', '/api/v1/admin/branches', json={}).status_code, 422)
        self.assertEqual(self.api('POST', '/api/v1/admin/branches', json={'name': 'A', 'parent_id': 1}).status_code, 422)
