# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import HttpCase, get_db_name, new_test_user, tagged

from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT

ADMIN_LOGIN = 'baseline_system_admin'
ADMIN_PASSWORD = 'baseline_system_admin_123'


@tagged('post_install', '-at_install', 'webvue')
class TestTenantBaseline(HttpCase):
    """What provisioning leaves on every tenant: a Saudi root company and a frozen public origin."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.profile = cls.env.ref('webvue_platform.tenant_profile')
        cls.params = cls.env['ir.config_parameter'].sudo()
        new_test_user(cls.env, login=ADMIN_LOGIN, password=ADMIN_PASSWORD, groups='base.group_system')

    def _operator(self):
        return self.profile.with_context(**{OPERATOR_CONTEXT: True})

    def _admin_login(self):
        """A system administrator signs in: stock then rewrites `web.base.url` from the request root unless frozen."""
        response = self.url_open(
            '/web/session/authenticate',
            json={
                'jsonrpc': '2.0', 'method': 'call', 'id': 0,
                'params': {'db': get_db_name(), 'login': ADMIN_LOGIN, 'password': ADMIN_PASSWORD},
            },
            headers={'Content-Type': 'application/json'},
        )
        self.assertIn('result', response.json(), response.text)

    def test_the_root_company_is_saudi_from_install(self):
        company = self.profile.root_company_id
        self.assertEqual(company.country_id, self.env.ref('base.sa'))
        self.assertEqual(company.currency_id, self.env.ref('base.SAR'))

    def test_an_unfrozen_origin_follows_the_admin_login(self):
        self.params.set_param('web.base.url', 'https://stale.example.com')
        self.params.set_param('web.base.url.freeze', False)
        self._admin_login()
        self.assertEqual(self.params.get_param('web.base.url'), self.base_url())

    def test_the_public_origin_survives_an_admin_login_and_follows_a_host_change(self):
        self._operator()._webvue_set_public_origin('acme.webvue.example')
        self.assertEqual(self.params.get_param('web.base.url'), 'https://acme.webvue.example')
        self.assertTrue(self.params.get_param('web.base.url.freeze'))
        self._admin_login()
        self.assertEqual(self.params.get_param('web.base.url'), 'https://acme.webvue.example')
        self._operator()._webvue_set_public_origin('erp.acme.sa')
        self._admin_login()
        self.assertEqual(self.params.get_param('web.base.url'), 'https://erp.acme.sa')

    def test_only_a_lowercase_dns_name_is_accepted(self):
        self._operator()._webvue_set_public_origin('acme.webvue.example')
        for host in ('', 'acme', 'Acme.webvue.example', 'https://acme.webvue.example', 'acme.webvue.example/pay',
                     'acme.webvue.example:8443', '-acme.webvue.example', 'acme..example', None):
            with self.subTest(host=host), self.assertRaises(ValidationError):
                self._operator()._webvue_set_public_origin(host)
        self.assertEqual(self.params.get_param('web.base.url'), 'https://acme.webvue.example')

    def test_only_the_trusted_operator_sets_the_origin(self):
        before = self.params.get_param('web.base.url')
        for profile in (self.profile, self.profile.with_user(self.env.ref('base.user_admin')).with_context(**{OPERATOR_CONTEXT: True})):
            with self.subTest(su=profile.env.su), self.assertRaises(AccessError):
                profile._webvue_set_public_origin('acme.webvue.example')
        self.assertEqual(self.params.get_param('web.base.url'), before)
