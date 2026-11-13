# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Company isolation of the customer record and export routes under branch sharing.

``GET /api/v1/customers/<id>`` and ``GET /api/v1/customers/export`` are the GET record routes. Under establishment sharing a customer has no
company and is shared on purpose (test_customers_routes.py); under branch sharing it belongs to its branch.
"""
import csv
import io

from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import (
    PROBE_FEATURE,
    CompanyIsolationCase,
    assert_isolation_discovery,
    cover_isolation_routes,
    register_probe_feature,
    set_probe_feature,
)

EXPECTED_GET_RECORD_ROUTES = 2
DETAIL = '/api/v1/customers/{}'
EXPORT = '/api/v1/customers/export'
# The descendants each company's session may see besides its own records.
DESCENDANTS = {'p': {'p1', 'p2'}, 'p1': set(), 'p2': set(), 'c': set()}


@tagged('post_install', '-at_install', 'liwan')
class TestCustomersCompanyIsolation(CompanyIsolationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.by_tag = {'p': cls.company_p, 'p1': cls.company_p1, 'p2': cls.company_p2, 'c': cls.company_c}
        admin = cls.env.ref('liwan_core.role_system_admin')
        Assignment = cls.env['liwan.access.assignment']
        for company in cls.by_tag.values():
            Assignment.create({'user_id': cls.iso_user.id, 'role_id': admin.id, 'company_id': company.id})
        cls.env['liwan.customers.settings']._liwan_current().sharing = 'branch'
        service = cls.env['liwan.customers.service']
        cls.customers = {
            tag: service.with_company(company)._liwan_create({'name': f'Isolated {tag}'})
            for tag, company in cls.by_tag.items()
        }

    def setUp(self):
        super().setUp()
        self.patch(type(self.env['liwan.customers.service']), '_liwan_customers_feature_keys', lambda model: (PROBE_FEATURE,))
        register_probe_feature(self)
        set_probe_feature(self)

    def test_customer_detail_matrix(self):
        for current, company in self.by_tag.items():
            self.assertEqual(self.customers[current].company_id, company)
            self.env_in(company)
            self.assertVisible(DETAIL.format(self.customers[current].id))
            for tag, customer in self.customers.items():
                if tag == current or tag in DESCENDANTS[current]:
                    continue
                with self.subTest(current=current, hidden=tag):
                    self.assertHiddenEveryWay('GET', DETAIL.format(customer.id), self.by_tag[tag].id)

    def test_export_never_includes_another_company(self):
        for current, company in self.by_tag.items():
            self.env_in(company)
            response = self.assertVisible(EXPORT)
            names = {row[0] for row in csv.reader(io.StringIO(response.content.decode('utf-8-sig')))}
            self.assertIn(f'Isolated {current}', names)
            for tag in self.by_tag:
                if tag != current and tag not in DESCENDANTS[current]:
                    self.assertNotIn(f'Isolated {tag}', names, f'{tag} leaked into {current}')


cover_isolation_routes(('/api/v1/customers/<int:customer_id>', EXPORT), 'liwan_customers/tests/test_company_isolation.py')


@tagged('post_install', '-at_install', 'liwan')
class TestLiwanCustomersIsolationDiscovery(CompanyIsolationCase):

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'liwan_customers', EXPECTED_GET_RECORD_ROUTES)
