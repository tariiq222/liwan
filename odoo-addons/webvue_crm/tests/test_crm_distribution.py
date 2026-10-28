# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import tagged

from .common import WebVueCrmCase
from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_crm.models.crm_settings import DEFAULTS


@tagged('post_install', '-at_install', 'webvue')
class TestCrmDistribution(WebVueCrmCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.agent3 = cls._user('crm_agent3', 'CRM Agent Three', 'webvue_crm.role_crm_agent')
        cls.agents = (cls.agent | cls.agent2 | cls.agent3).sorted('id')

    def _service(self, user=None, company=None):
        service = self.env['webvue.crm.distribution']
        if user:
            service = service.with_user(user)
        return service.with_company(company or self.company)

    def _settings(self, **values):
        return self.env['webvue.crm.settings'].create({'company_id': self.company.id, **values})

    def _leads(self, count, company=None):
        company = company or self.company
        return self.env['crm.lead'].create([
            {'name': f'Distribution lead {index}', 'company_id': company.id, 'user_id': False} for index in range(count)
        ]).sorted('id')

    @staticmethod
    def _owners(leads):
        return [lead.user_id.id for lead in leads]

    def _pool(self, users):
        return {'distribution_user_ids': [Command.set(users.ids)]}

    def test_round_robin_gives_each_agent_two_of_six_in_id_order(self):
        self._settings(**self._pool(self.agents))
        leads = self._leads(6)
        self._service().with_user(self.agent)._webvue_assign(leads)
        self.assertEqual(self._owners(leads), [*self.agents.ids, *self.agents.ids])

    def test_rotation_continues_across_calls(self):
        row = self._settings(**self._pool(self.agents))
        first, second = self._leads(2), self._leads(2)
        service = self._service()
        service._webvue_assign(first)
        service._webvue_assign(second)
        self.assertEqual(self._owners(first | second), [*self.agents.ids, self.agents[0].id])
        row.invalidate_recordset()
        self.assertEqual(row.round_robin_index, 1)

    def test_empty_pool_means_every_agent_holding_the_capability(self):
        eligible = self._service()._webvue_eligible_agents(self.company)
        self.assertLessEqual({self.agent.id, self.agent2.id, self.agent3.id, self.manager.id}, set(eligible.ids))
        self.assertNotIn(self.outsider, eligible)
        self.assertEqual(eligible.ids, sorted(eligible.ids))

    def test_pool_members_without_the_capability_are_skipped(self):
        self._settings(**self._pool(self.agents | self.outsider))
        self.assertEqual(self._service()._webvue_eligible_agents(self.company), self.agents)
        leads = self._leads(3)
        self._service()._webvue_assign(leads)
        self.assertEqual(self._owners(leads), self.agents.ids)

    def test_agent_losing_the_capability_is_skipped(self):
        self._settings(**self._pool(self.agents))
        self.env['webvue.access.service']._webvue_replace_assignments(self.agent2, [])
        leads = self._leads(4)
        self._service()._webvue_assign(leads)
        self.assertEqual(self._owners(leads), [self.agent.id, self.agent3.id] * 2)

    def test_archived_users_are_skipped(self):
        self._settings(**self._pool(self.agents))
        self.agent3.active = False
        self.assertEqual(self._service()._webvue_eligible_agents(self.company), self.agent | self.agent2)

    def test_capability_is_checked_in_the_lead_company(self):
        self._settings(**self._pool(self.agents))
        self.assertFalse(self._service(company=self.other_company)._webvue_eligible_agents(self.other_company))
        self.agent.company_ids = [Command.link(self.other_company.id)]
        self.assertFalse(self._service()._webvue_eligible_agents(self.other_company))
        self.assertEqual(self._service()._webvue_eligible_agents(self.company), self.agents)

    def test_no_eligible_agent_leaves_leads_unassigned_without_error(self):
        self._settings(**self._pool(self.outsider))
        leads = self._leads(2)
        self._service()._webvue_assign(leads)
        self.assertFalse(leads.mapped('user_id'))

    def test_manual_mode_leaves_leads_unassigned(self):
        self._settings(distribution_mode='manual', **self._pool(self.agents))
        leads = self._leads(3)
        self._service()._webvue_assign(leads)
        self.assertFalse(leads.mapped('user_id'))

    def test_mode_argument_overrides_the_company_mode(self):
        self._settings(distribution_mode='manual', **self._pool(self.agents))
        leads = self._leads(3)
        self._service()._webvue_assign(leads, mode='round_robin')
        self.assertEqual(self._owners(leads), self.agents.ids)

    def test_on_import_assigns_the_chosen_eligible_agent(self):
        self._settings(**self._pool(self.agents))
        leads = self._leads(3)
        self._service()._webvue_assign(leads, mode='on_import', agent=self.agent2)
        self.assertEqual(leads.mapped('user_id'), self.agent2)

    def test_on_import_with_an_ineligible_agent_is_422(self):
        self._settings(**self._pool(self.agents))
        leads = self._leads(1)
        for agent in (self.outsider, self.manager):
            if agent == self.manager:
                self.env['webvue.access.service']._webvue_replace_assignments(self.manager, [])
            with self.assertRaises(ApiError) as caught:
                self._service()._webvue_assign(leads, mode='on_import', agent=agent)
            self.assertEqual(caught.exception.status, 422)
            self.assertEqual(caught.exception.code, 'invalid')
            self.assertEqual(caught.exception.field, 'user_id')
            self.assertFalse(leads.user_id)

    def test_first_assignment_creates_the_row_with_exact_defaults_as_an_agent(self):
        self.assertFalse(self.env['webvue.crm.settings'].search([('company_id', '=', self.company.id)]))
        leads = self._leads(2)
        self._service(self.agent)._webvue_assign(leads)
        row = self.env['webvue.crm.settings'].search([('company_id', '=', self.company.id)])
        self.assertEqual(len(row), 1)
        self.assertEqual(row.revision, 1)
        self.assertEqual({name: row[name] for name in DEFAULTS}, dict(DEFAULTS))
        self.assertEqual(row.round_robin_index, 2 % len(self._service()._webvue_eligible_agents(self.company)))
        self.assertEqual(len(leads.user_id), 2)

    def test_assignment_runs_as_the_superuser_without_a_user(self):
        self._settings(**self._pool(self.agents))
        leads = self._leads(3)
        self.env['webvue.crm.distribution'].with_user(1).with_company(self.company)._webvue_assign(leads)
        self.assertEqual(self._owners(leads), self.agents.ids)

    def test_pointer_write_does_not_bump_the_settings_revision(self):
        row = self._settings(**self._pool(self.agents))
        self._service(self.agent)._webvue_assign(self._leads(2))
        row.invalidate_recordset()
        self.assertEqual((row.revision, row.round_robin_index), (1, 2))

    def test_the_row_is_locked_before_the_pointer_is_read_and_moved(self):
        row = self._settings(**self._pool(self.agents))
        statements = []
        original = type(self.env.cr).execute

        def spy(cursor, query, params=None, *args, **kwargs):
            text = query.code if hasattr(query, 'code') else str(query)
            statements.append(text)
            return original(cursor, query, params, *args, **kwargs)

        self.patch(type(self.env.cr), 'execute', spy)
        self._service()._webvue_assign(self._leads(1))
        pointer = [i for i, text in enumerate(statements) if 'round_robin_index' in text]
        locks = [i for i, text in enumerate(statements) if 'FOR UPDATE' in text and row._table in text]
        self.assertTrue(locks)
        self.assertLess(locks[0], pointer[0])

    def test_pointer_is_read_from_the_database_after_the_lock(self):
        # Models what a concurrent transaction does: it advances the pointer after this
        # transaction cached the row. The next pick must continue from the stored value.
        row = self._settings(**self._pool(self.agents))
        self.assertEqual(row.round_robin_index, 0)
        self.env.cr.execute('UPDATE webvue_crm_settings SET round_robin_index = 1 WHERE id = %s', [row.id])
        leads = self._leads(1)
        self._service()._webvue_assign(leads)
        self.assertEqual(leads.user_id, self.agents[1])
        row.invalidate_recordset()
        self.assertEqual(row.round_robin_index, 2)
