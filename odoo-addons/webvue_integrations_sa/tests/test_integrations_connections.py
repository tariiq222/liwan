# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged
from odoo.tools import mute_logger

from .common import WebVueIntegrationsCase
from odoo.addons.webvue_api.tests.common import set_probe_feature
from odoo.addons.webvue_integrations_sa.controllers.connections import (
    IntegrationConnectionController,
)


@tagged('post_install', '-at_install', 'webvue')
class TestIntegrationConnections(WebVueIntegrationsCase):

    def test_every_company_is_seeded_with_one_not_configured_zatca_link(self):
        other = self.env['res.company'].create({'name': 'Integrations company B'})
        Connection = self.env['webvue.integration.connection']
        Connection._webvue_ensure_default_connections()
        Connection._webvue_ensure_default_connections()
        for company in (self.env.company, other):
            links = Connection.search([('company_id', '=', company.id)])
            self.assertEqual(links.mapped('kind'), ['zatca'], company.name)
            self.assertEqual(links.state, 'not_configured')

    def test_admin_reads_the_whitelisted_shape(self):
        self.authenticate('integrations_admin', 'integrations_admin_pass_123')
        result = self.api('GET', '/api/v1/integrations/connections')
        self.assertEqual(result.status_code, 200)
        body = result.json()
        item = next(row for row in body['items'] if row['id'] == self.connection.id)
        self.assertEqual(set(item), {'id', 'kind', 'provider', 'state', 'last_checked', 'status_message'})
        self.assertEqual(
            (item['kind'], item['state'], item['last_checked'], item['status_message']),
            ('zatca', 'not_configured', None, ''),
        )
        self.assertEqual(body['total'], len(body['items']))

    def test_the_list_shows_only_the_current_company(self):
        other = self.env['res.company'].create({'name': 'Integrations company B'})
        self.env['webvue.integration.connection']._webvue_ensure_default_connections()
        self.authenticate('integrations_admin', 'integrations_admin_pass_123')
        ids = {row['id'] for row in self.api('GET', '/api/v1/integrations/connections').json()['items']}
        foreign = self.env['webvue.integration.connection'].search([('company_id', '=', other.id)])
        self.assertTrue(foreign)
        self.assertFalse(ids & set(foreign.ids))

    def test_a_user_without_the_read_capability_gets_403_forbidden(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        result = self.api('GET', '/api/v1/integrations/connections')
        self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'))

    def test_the_capability_gate_is_declared_and_answers_the_documented_403(self):
        handler = IntegrationConnectionController.list_connections
        self.assertEqual(handler._webvue_capability_keys, ('integrations.read',))
        self.authenticate('api_emp', 'api_emp_pass_123')
        denied = self.api('GET', '/api/v1/integrations/connections')
        self.assertEqual(
            (denied.status_code, denied.json()['code'], denied.json()['message']),
            (403, 'forbidden', 'integrations.read capability is required'),
        )
        self.authenticate('integrations_admin', 'integrations_admin_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/integrations/connections').status_code, 200)

    def test_a_closed_feature_refuses_the_route(self):
        set_probe_feature(self, key='integrations.enabled', enabled=False)
        self.authenticate('integrations_admin', 'integrations_admin_pass_123')
        result = self.api('GET', '/api/v1/integrations/connections')
        self.assertEqual(result.status_code, 403)

    def test_the_manage_capability_writes_and_the_employee_does_not(self):
        Connection = self.env['webvue.integration.connection']
        self.connection.with_user(self.admin).write({'state': 'pending', 'status_message': 'Awaiting onboarding'})
        self.assertEqual(self.connection.state, 'pending')
        with self.assertRaises(AccessError):
            self.connection.with_user(self.employee).write({'state': 'connected'})
        with self.assertRaises(AccessError):
            Connection.with_user(self.employee).create({'kind': 'bank', 'provider': 'Nobody'})

    def test_set_connection_state_updates_the_row_and_creates_a_missing_one(self):
        Connection = self.env['webvue.integration.connection'].with_user(self.admin)
        row = Connection._webvue_set_connection_state(self.env.company, 'zatca', 'ZATCA', 'connected', 'Sandbox ready')
        self.assertEqual(row, self.connection)
        self.assertEqual((row.state, row.status_message), ('connected', 'Sandbox ready'))
        self.assertTrue(row.last_checked)
        other = self.env['res.company'].create({'name': 'Integrations company C'})
        self.admin.company_ids = [(4, other.id)]
        with self.assertRaises(AccessError), self.env.cr.savepoint():
            Connection.with_context(allowed_company_ids=[other.id])._webvue_set_connection_state(
                other, 'zatca', 'ZATCA', 'pending', 'Membership grants no capability',
            )
        self.env['webvue.access.assignment'].create({
            'user_id': self.admin.id, 'role_id': self.env.ref('webvue_core.role_system_admin').id,
            'company_id': other.id,
        })
        created = Connection.with_context(allowed_company_ids=[other.id])._webvue_set_connection_state(
            other, 'zatca', 'ZATCA', 'pending', '1 of 2 journals',
        )
        self.assertEqual((created.company_id, created.state, created.status_message), (other, 'pending', '1 of 2 journals'))

    def test_set_connection_state_adds_no_elevation(self):
        with self.assertRaises(AccessError):
            self.env['webvue.integration.connection'].with_user(self.employee)._webvue_set_connection_state(
                self.env.company, 'zatca', 'ZATCA', 'connected', 'x',
            )
        self.assertEqual(self.connection.state, 'not_configured')

    def test_a_connection_is_unique_per_company_kind_and_provider(self):
        Connection = self.env['webvue.integration.connection']
        with mute_logger('odoo.sql_db'), self.assertRaises(Exception), self.env.cr.savepoint():  # noqa: B017
            Connection.create({'kind': self.connection.kind, 'provider': self.connection.provider})

    def test_plain_orm_stays_current_only_and_other_company_requires_a_grant(self):
        other = self.env['res.company'].create({'name': 'Integrations company B'})
        Connection = self.env['webvue.integration.connection']
        Connection._webvue_ensure_default_connections()
        main = self.env.company
        self.assertNotIn(other, self.admin.company_ids)
        self.assertEqual(Connection.with_user(self.admin).search([]).company_id, main)
        self.admin.company_ids = [(4, other.id)]
        both = Connection.with_user(self.admin).with_context(allowed_company_ids=[main.id, other.id])
        self.assertEqual(both.search([]).company_id, main)
        self.env['webvue.access.assignment'].create({
            'user_id': self.admin.id, 'role_id': self.env.ref('webvue_core.role_system_admin').id,
            'company_id': other.id,
        })
        self.assertEqual(both.search([]).company_id, main, 'plain ORM has no aggregate capability scope')
        only_other = Connection.with_user(self.admin).with_context(allowed_company_ids=[other.id])
        self.assertEqual(only_other.search([]).company_id, other)
        only_main = Connection.with_user(self.admin).with_context(allowed_company_ids=[main.id])
        self.assertEqual(only_main.search([]).company_id, main)

    def test_manage_without_read_cannot_be_granted_and_manage_with_read_reads(self):
        Permission = self.env['webvue.access.permission']
        manage = Permission.search([('key', '=', 'integrations.manage')])
        read = Permission.search([('key', '=', 'integrations.read')])
        Role = self.env['webvue.access.role']
        with self.assertRaisesRegex(ValidationError, 'missing_dependency'), self.cr.savepoint():
            Role.create({'name_ar': 'مدير ربط', 'type': 'custom', 'permission_ids': [(6, 0, manage.ids)]})
        role = Role.create({'name_ar': 'مدير ربط', 'type': 'custom', 'permission_ids': [(6, 0, (manage | read).ids)]})
        user = new_test_user(
            self.env, login='integrations_manager', password='integrations_manager_pass_123',
            name='Integrations manager', groups='webvue_core.group_employee',
        )
        self.env['webvue.access.service']._webvue_replace_assignments(
            user, [{'role_id': role.id, 'company_id': self.env.company.id}],
        )
        keys = self.env['webvue.access.service']._webvue_capability_keys(user)
        self.assertTrue({'integrations.manage', 'integrations.read'} <= keys)
        self.authenticate('integrations_manager', 'integrations_manager_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/integrations/connections').status_code, 200)

    def test_a_user_with_neither_capability_gets_403(self):
        user = new_test_user(
            self.env, login='integrations_nobody', password='integrations_nobody_pass_123',
            name='Integrations nobody', groups='webvue_core.group_employee',
        )
        self.assertFalse(
            self.env['webvue.access.service']._webvue_capability_keys(user)
            & {'integrations.read', 'integrations.manage'},
        )
        self.authenticate('integrations_nobody', 'integrations_nobody_pass_123')
        result = self.api('GET', '/api/v1/integrations/connections')
        self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'))
