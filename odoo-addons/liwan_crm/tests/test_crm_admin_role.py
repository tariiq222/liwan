# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_crm.tests.common import LiwanCrmCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

KEPT_LIMITS = ('users.limit', 'storage.limit_mb', 'branches.extra_limit')


@tagged('liwan', 'liwan_access', 'post_install', '-at_install')
class TestCrmAdminRole(LiwanCrmCase):
    """The first tenant administrator of a tenant with CRM holds the CRM manager role, like every other application."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['liwan.access.service']
        cls.entitlements = cls.env['liwan.entitlement.service'].sudo()
        cls.profile = cls.env.ref('liwan_platform.tenant_profile')
        cls.profile._liwan_initialize_legacy_policy(cls.env['liwan.feature.registry']._liwan_installed_module_ids())

    def _operator(self):
        return self.profile.with_context(**{OPERATOR_CONTEXT: True})

    def _set_crm(self, enabled):
        closed = self.entitlements._liwan_close_unlisted_features(
            {key: value for key, value in self.profile.features.items() if key in KEPT_LIMITS},
        )
        self._operator().write({'features': {**closed, 'crm.enabled': enabled}})

    def _assigned(self, user):
        return set(self.env['liwan.access.assignment'].search([
            ('user_id', '=', user.id), ('company_id', '=', self.profile.root_company_id.id),
        ]).mapped('role_id.key'))

    def test_legacy_administrator_roles_include_crm_manager(self):
        self.assertIn('crm_manager', self.service._liwan_legacy_admin_roles())

    def test_tenant_with_crm_opens_the_crm_manager_role(self):
        self._set_crm(True)
        self.assertIn('crm_manager', self.entitlements._liwan_entitled_admin_roles())

    def test_tenant_without_crm_does_not_open_the_crm_manager_role(self):
        self._set_crm(False)
        self.assertNotIn('crm_manager', self.entitlements._liwan_entitled_admin_roles())

    def test_first_admin_of_a_crm_tenant_reads_leads(self):
        self._set_crm(False)
        before = self.entitlements._liwan_entitled_admin_roles()
        self._set_crm(True)
        admin = new_test_user(self.env, login='crm_first_admin', groups='liwan_core.group_employee')
        self.assertFalse(
            self.service._liwan_capability_keys(admin, company=self.profile.root_company_id) & {'crm.leads.read'},
        )
        granted = self._operator()._liwan_grant_opened_admin_roles('crm_first_admin', before)
        self.assertIn('crm_manager', granted)
        self.assertIn('crm_manager', self._assigned(admin))
        keys = self.service._liwan_capability_keys(admin, company=self.profile.root_company_id)
        self.assertIn('crm.leads.read', keys)

    def test_opening_crm_in_an_older_tenant_grants_the_existing_admin_the_role(self):
        self._set_crm(False)
        before = self.entitlements._liwan_entitled_admin_roles()
        older = new_test_user(self.env, login='crm_older_admin', groups='liwan_core.group_employee')
        self.assertNotIn('crm_manager', self._assigned(older))
        self._set_crm(True)
        self._operator()._liwan_grant_opened_admin_roles('crm_older_admin', before)
        self.assertIn('crm_manager', self._assigned(older))

    def test_tenant_without_crm_grants_no_crm_role_to_the_admin(self):
        self._set_crm(False)
        before = self.entitlements._liwan_entitled_admin_roles()
        admin = new_test_user(self.env, login='crm_closed_admin', groups='liwan_core.group_employee')
        granted = self._operator()._liwan_grant_opened_admin_roles('crm_closed_admin', before)
        self.assertNotIn('crm_manager', granted)
        self.assertNotIn('crm_manager', self._assigned(admin))

    def test_vendor_support_holds_no_crm_key_after_the_role_exists(self):
        support = new_test_user(
            self.env, login='crm_admin_support', groups='liwan_core.group_vendor_support',
            company_id=self.company.id,
        )
        # The service refuses to assign roles to support, so the grant is written the way the enrolment grant does.
        self.env['liwan.access.assignment'].create({
            'user_id': support.id, 'role_id': self.env.ref('liwan_crm.role_crm_manager').id,
            'company_id': self.company.id,
        })
        self.assertFalse(
            self.service._liwan_capability_keys(support, company=self.company) & {'crm.leads.read', 'crm.settings.manage'},
        )
