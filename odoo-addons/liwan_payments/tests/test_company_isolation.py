# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-request company isolation for the Payments routes.

The online order detail is the one session-backed GET record route; the others are public and token-
or signature-authorized, so they have no session company to isolate. The provider list and its writes
are the rest of the session-backed surface.
"""
from odoo import fields
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_api.tests.common import (
    CompanyIsolationCase,
    assert_isolation_discovery,
    cover_isolation_routes,
    exempt_isolation_route,
)

EXPECTED_GET_RECORD_ROUTES = 4
LIST = '/api/v1/payments/providers'
ORDER = '/api/v1/payments/orders/{}'
NOCAP_PASSWORD = 'iso_pay_nocap_pass_123'


@tagged('post_install', '-at_install', 'liwan')
class TestPaymentsCompanyIsolation(CompanyIsolationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.by_tag = {'p': cls.company_p, 'p1': cls.company_p1, 'p2': cls.company_p2, 'c': cls.company_c}
        Assignment = cls.env['liwan.access.assignment'].sudo()
        admin = cls.env.ref('liwan_core.role_system_admin')
        for company in cls.by_tag.values():
            Assignment.create({'user_id': cls.iso_user.id, 'role_id': admin.id, 'company_id': company.id})
        cls.no_cap = new_test_user(
            cls.env, login='iso_pay_nocap', password=NOCAP_PASSWORD, name='No payments',
            groups='liwan_core.group_employee', company_id=cls.company_p.id,
        )
        cls.no_cap.company_ids = [(6, 0, [cls.company_p.id])]
        Assignment.create({
            'user_id': cls.no_cap.id, 'role_id': cls.env.ref('liwan_core.role_employee').id,
            'company_id': cls.company_p.id,
        })
        template = cls.env['payment.provider'].search([('code', '=', 'paymob')], limit=1)
        cls.providers = {tag: template.copy({'company_id': company.id}) for tag, company in cls.by_tag.items()}
        customer = cls.env['res.partner'].create({'name': 'Online customer'})
        cls.orders = {
            tag: cls.env['sale.order'].sudo().with_company(company).create({
                'company_id': company.id, 'partner_id': customer.id,
                'liwan_payment_deadline': fields.Datetime.now(),
            })
            for tag, company in cls.by_tag.items()
        }

    def test_provider_list_never_shows_another_company(self):
        for current, company in self.by_tag.items():
            self.env_in(company)
            ids = {item['id'] for item in self.assertVisible(LIST).json()['items']}
            self.assertIn(self.providers[current].id, ids)
            for tag, provider in self.providers.items():
                if tag != current:
                    self.assertNotIn(provider.id, ids, f'{tag} leaked into {current}')

    def test_other_company_provider_answers_the_not_found(self):
        """A write on another company's provider is the same 404 as a missing one."""
        for current, company in self.by_tag.items():
            self.env_in(company)
            missing = self.api('PATCH', f'{LIST}/{self.NOT_FOUND_ID}', json={'state': 'disabled'})
            for tag, provider in self.providers.items():
                if tag == current:
                    continue
                response = self.api('PATCH', f'{LIST}/{provider.id}', json={'state': 'disabled'})
                self.assertEqual(response.status_code, 404, f'{tag} from {current}: {response.text[:200]}')
                self.assertEqual(response.content, missing.content)

    def test_order_detail_matrix(self):
        """The owning company reads its online order; every other company answers the not-found."""
        for current, company in self.by_tag.items():
            self.env_in(company)
            self.assertVisible(ORDER.format(self.orders[current].id))
            for tag, order in self.orders.items():
                if tag != current:
                    self.assertHiddenEveryWay('GET', ORDER.format(order.id), self.by_tag[tag].id)

    def test_missing_capability_in_the_same_company_stays_forbidden(self):
        self.authenticate('iso_pay_nocap', NOCAP_PASSWORD)
        self.assertEqual(self.api('GET', LIST).status_code, 403)
        self.assertEqual(self.api('GET', '/api/v1/payments/settings').status_code, 403)

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'liwan_payments', EXPECTED_GET_RECORD_ROUTES)


cover_isolation_routes(
    ('/api/v1/payments/orders/<int:order_id>',),
    source='liwan_payments/tests/test_company_isolation.py',
)
for _pattern in (
    '/api/v1/public/payments/invoices/<int:document_id>',
    '/api/v1/public/payments/orders/<int:document_id>',
):
    exempt_isolation_route(_pattern, 'public route: the document access token authorizes one document, no session company applies')
exempt_isolation_route(
    '/api/v1/public/payments/hooks/<string:code>/<string:kind>',
    'public gateway callback: authorized by the gateway signature, no session company applies',
)
