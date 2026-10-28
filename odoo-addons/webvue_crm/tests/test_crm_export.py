# Part of Odoo. See LICENSE file for full copyright and licensing details.
import csv
import io
import re

from odoo import Command
from odoo.tests import new_test_user, tagged

from .common import WebVueCrmCase
from odoo.addons.webvue_api.tests.common import set_probe_feature

URL = '/api/v1/crm/export'
HEADER = ['name', 'phone', 'email', 'stage', 'agent', 'source', 'package', 'final_price', 'created']


@tagged('post_install', '-at_install', 'webvue')
class TestCrmExport(WebVueCrmCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.exporter = cls._exporter()
        cls.team = cls.env['crm.team'].create({
            'name': 'Export team', 'company_id': cls.company.id,
            'crm_team_member_ids': [Command.create({'user_id': cls.exporter.id}), Command.create({'user_id': cls.agent2.id})],
        })
        cls.source = cls.env['utm.source'].create({'name': 'Export source'})
        cls.package = cls.make_package(price=500.0, name='Gold')
        cls.own = cls.make_lead(
            cls.exporter, contact_name='Own customer', phone='+966501000001', email_from='own@example.com',
            source_id=cls.source.id, webvue_package_id=cls.package.id, webvue_final_price=450.0,
        )
        cls.mate = cls.make_lead(cls.agent2, contact_name='Teammate customer', phone='+966501000002')
        cls.other = cls.make_lead(cls.agent, contact_name='Outside customer', phone='+966501000003')
        cls.pool = cls.make_lead(None, contact_name='Pool customer', phone='+966501000004')
        cls.foreign = cls.make_lead(None, company=cls.other_company, contact_name='Foreign customer')

    @classmethod
    def _exporter(cls):
        """A user who exports and works but does not assign: the policy, not the role, bounds the file."""
        permissions = cls.env['webvue.access.permission'].search([
            ('key', 'in', ['crm.leads.read', 'crm.leads.work', 'crm.leads.export']),
        ])
        role = cls.env['webvue.access.role'].create({
            'name_ar': 'مصدّر', 'company_id': cls.company.id, 'permission_ids': [Command.set(permissions.ids)],
        })
        user = new_test_user(
            cls.env, login='crm_exporter', password='crm_exporter_pass_123', name='CRM Exporter',
            groups='webvue_core.group_employee',
        )
        cls.env['webvue.access.assignment'].create({'user_id': user.id, 'role_id': role.id, 'company_id': cls.company.id})
        return user

    def rows(self, user, query=''):
        response = self.as_user(user).api('GET', f'{URL}{query}')
        self.assertEqual(response.status_code, 200, response.text)
        return list(csv.reader(io.StringIO(response.content.decode('utf-8-sig'))))

    def names(self, user, query=''):
        return {row[0] for row in self.rows(user, query)[1:]}

    def test_manager_downloads_a_utf8_csv_with_the_stable_header(self):
        response = self.as_manager().api('GET', URL)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.headers['Content-Type'].startswith('text/csv'))
        self.assertRegex(
            response.headers['Content-Disposition'], r'attachment;.*crm-opportunities-\d{4}-\d{2}-\d{2}\.csv',
        )
        self.assertTrue(response.content.startswith(b'\xef\xbb\xbf'))
        self.assertEqual(self.rows(self.manager)[0], HEADER)

    def test_row_values(self):
        row = next(row for row in self.rows(self.manager) if row[0] == 'Own customer')
        self.assertEqual(row[1:8], [
            '\t+966501000001', 'own@example.com', 'New', 'CRM Exporter', 'Export source', 'Gold', '450.0',
        ])
        self.assertRegex(row[8], r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')

    def test_manager_gets_every_company_opportunity_open_won_and_lost(self):
        won = self.make_lead(self.agent, contact_name='Won customer')
        won.write({'stage_id': self.env.ref('webvue_crm.stage_won').id})
        lost = self.make_lead(self.agent, contact_name='Lost customer')
        lost.action_set_lost()
        self.assertEqual(lost.won_status, 'lost')
        self.assertEqual(self.names(self.manager), {
            'Own customer', 'Teammate customer', 'Outside customer', 'Pool customer', 'Won customer', 'Lost customer',
        })

    def test_filters_of_the_list_apply(self):
        self.assertEqual(self.names(self.manager, f'?user_id={self.agent2.id}'), {'Teammate customer'})
        self.assertEqual(self.names(self.manager, '?unassigned=true'), {'Pool customer'})
        self.assertEqual(self.names(self.manager, '?q=outside'), {'Outside customer'})
        self.assertEqual(self.as_manager().api('GET', f'{URL}?due=maybe').status_code, 422)

    def test_own_mode_exports_only_own(self):
        self.set_visibility('own')
        self.assertEqual(self.names(self.exporter), {'Own customer'})

    def test_team_mode_adds_teammates(self):
        self.set_visibility('team')
        self.assertEqual(self.names(self.exporter), {'Own customer', 'Teammate customer'})

    def test_all_mode_adds_every_assigned_opportunity_but_not_the_pool(self):
        self.set_visibility('all')
        self.assertEqual(self.names(self.exporter), {'Own customer', 'Teammate customer', 'Outside customer'})

    def test_other_company_is_never_exported(self):
        self.set_visibility('all')
        for user in (self.manager, self.exporter):
            self.assertNotIn('Foreign customer', self.names(user))

    def test_agent_and_outsider_are_forbidden(self):
        for user in (self.agent, self.outsider):
            self.assertEqual(self.as_user(user).api('GET', URL).status_code, 403)

    def test_closed_export_feature_refuses(self):
        set_probe_feature(self, key='crm.export', enabled=False)
        self.assertEqual(self.as_manager().api('GET', URL).status_code, 403)

    def test_formula_cells_are_neutralised(self):
        for index, text in enumerate(('=SUM(A1)', '+1', '-1', '@cmd', '\tx')):
            self.make_lead(self.agent, contact_name=text, phone=f'+96650200000{index}')
        values = {row[0] for row in self.rows(self.manager)[1:]}
        self.assertTrue({"'=SUM(A1)", "'+1", "'-1", "'@cmd", "'\tx"} <= values)
        self.assertFalse(any(re.match(r'^[=+\-@\t\r]', value) for value in values))

    def test_a_phone_keeps_its_plus_in_a_spreadsheet_and_nothing_else_runs(self):
        # A leading tab keeps Excel from reading "+9665..." as a number; only digits follow the plus.
        phones = {row[0]: row[1] for row in self.rows(self.manager)[1:]}
        self.assertEqual(phones['Own customer'], '\t+966501000001')
        for index, raw in enumerate(('=SUM(A1)', '+1;=cmd', '@cmd', '-966501000009')):
            self.make_lead(self.agent, contact_name=f'Raw {index}', phone=raw)
        phones = {row[0]: row[1] for row in self.rows(self.manager)[1:]}
        self.assertEqual([phones[f'Raw {index}'] for index in range(4)], ["'=SUM(A1)", "'+1;=cmd", "'@cmd", "'-966501000009"])
