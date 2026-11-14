# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Company isolation of connections and their secrets, and the inventory of the GET record routes.

The record route `GET /connections/<id>` is covered below. The OAuth callback carries no record id of its own:
the company comes from the signed state and must equal the session company, which its tests refuse otherwise.
"""
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import LiwanIntegrationsCase
from odoo.addons.liwan_api.tests.common import (
    assert_isolation_discovery,
    cover_isolation_routes,
    exempt_isolation_route,
)

CONNECTION_ROUTE = '/api/v1/integrations/connections/<int:connection_id>'
CALLBACK_ROUTE = '/api/v1/integrations/oauth/<string:provider>/callback'
EXPECTED_GET_RECORD_ROUTES = 2
cover_isolation_routes([CONNECTION_ROUTE], 'liwan_integrations_sa test_company_isolation')
exempt_isolation_route(CALLBACK_ROUTE, 'the company comes from the signed state and must equal the session company')


@tagged('post_install', '-at_install', 'liwan')
class TestIntegrationCompanyIsolation(LiwanIntegrationsCase):

    def setUp(self):
        super().setUp()
        self.other = self.env['res.company'].create({'name': 'Integrations company B'})
        self.mine = self.make_meta()
        self.foreign = self.make_meta(external_id='999999999999', company=self.other)

    def as_admin(self, model, *companies):
        return self.env[model].with_user(self.admin).with_context(allowed_company_ids=[company.id for company in companies])

    def test_a_user_sees_the_connections_and_secrets_of_the_current_company_only(self):
        for model, own, foreign in (
            ('liwan.integration.connection', self.mine, self.foreign),
            ('liwan.integration.secret', self.mine.secret_ids, self.foreign.secret_ids),
        ):
            with self.subTest(model=model):
                found = self.as_admin(model, self.env.company).search([])
                self.assertEqual(found, own)
                self.assertFalse(found & foreign)

    def test_the_secret_follows_the_company_of_its_connection(self):
        self.assertEqual(set(self.foreign.secret_ids.mapped('company_id')), {self.other})
        self.assertEqual(set(self.mine.secret_ids.mapped('company_id')), {self.env.company})

    def test_membership_alone_reaches_no_other_company(self):
        self.admin.company_ids = [(4, self.other.id)]
        both = self.as_admin('liwan.integration.connection', self.env.company, self.other)
        self.assertEqual(both.search([]).company_id, self.env.company, 'plain ORM has no aggregate capability scope')
        self.env['liwan.access.assignment'].create({
            'user_id': self.admin.id, 'role_id': self.env.ref('liwan_core.role_system_admin').id, 'company_id': self.other.id,
        })
        self.assertEqual(both.search([]).company_id, self.env.company)
        only_other = self.as_admin('liwan.integration.connection', self.other)
        self.assertEqual(only_other.search([]).company_id, self.other)

    def test_the_foreign_record_cannot_be_read_or_written_in_another_company_context(self):
        with self.assertRaises(AccessError):
            self.foreign.with_user(self.admin).with_context(allowed_company_ids=[self.env.company.id]).read(['state'])
        with self.assertRaises(AccessError):
            self.foreign.secret_ids.with_user(self.admin).with_context(allowed_company_ids=[self.env.company.id]).read(['name'])

    def test_the_record_route_hides_another_company_like_a_missing_record(self):
        self.login(self.admin)
        hidden = self.api('GET', f'/api/v1/integrations/connections/{self.foreign.id}')
        missing = self.api('GET', '/api/v1/integrations/connections/999999999')
        self.assertEqual((hidden.status_code, hidden.content), (404, missing.content))
        self.assertEqual(self.api('GET', f'/api/v1/integrations/connections/{self.mine.id}').status_code, 200)

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'liwan_integrations_sa', EXPECTED_GET_RECORD_ROUTES)
