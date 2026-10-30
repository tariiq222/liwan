# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import LiwanApiCase

PATHS = (
    '/api/commercial/v1/context',
    '/api/commercial/v1/invoices',
    '/api/commercial/v1/subscriptions/current',
)


@tagged('post_install', '-at_install', 'liwan')
class TestCommercialSurface(LiwanApiCase):
    """CP1 keeps the commercial surface closed. No page, no outbound call."""

    def test_anonymous_commercial_paths_are_not_public(self):
        for path in PATHS:
            with self.subTest(path=path):
                response = self.api('GET', path)
                self.assertEqual(response.status_code, 401)
                self.assertNotIn('commercial_unavailable', response.text)

    def test_saas_self_service_stays_closed(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        for method in ('GET', 'POST'):
            response = self.api(method, '/api/commercial/v1/invoices', json={})
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.json()['code'], 'commercial_unavailable')

    def test_non_saas_rejects_and_does_not_echo_a_billing_body(self):
        self.env.cr.execute("""
            UPDATE liwan_tenant_profile SET commercial_mode='non_saas',
                entitlement_source='local_policy', valid_until=NULL
        """)
        self.env['liwan.tenant.profile'].invalidate_model()
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('POST', '/api/commercial/v1/payment-methods', json={
            'card': '4111111111111111',
        })
        self.assertEqual((response.status_code, response.json()['code']), (404, 'commercial_unavailable'))
        self.assertNotIn('4111', response.text)

    def test_business_routes_stay_available(self):
        self.env.cr.execute("""
            UPDATE liwan_tenant_profile SET commercial_mode='non_saas',
                entitlement_source='local_policy', valid_until=NULL
        """)
        self.env['liwan.tenant.profile'].invalidate_model()
        self.authenticate('api_emp', 'api_emp_pass_123')
        me = self.api('GET', '/api/v1/me')
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()['commercial']['mode'], 'non_saas')
        self.assertFalse(me.json()['commercial']['self_service_available'])
