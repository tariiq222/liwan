# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import new_test_user, tagged
from odoo.tools import html2plaintext

from .common import WebVueCrmCase
from odoo.addons.webvue_api.controllers.common import ApiError


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

    def _rotation(self, company=None):
        return self.env['webvue.crm.rotation'].search([('company_id', '=', (company or self.company).id)])

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

    def test_each_agent_gets_one_bell_for_the_batch_and_a_lone_lead_keeps_its_own_name(self):
        self._settings(**self._pool(self.agents))
        leads = self._leads(6)
        self._service().with_user(self.manager)._webvue_assign(leads)
        for index, agent in enumerate(self.agents):
            mine = leads.filtered(lambda lead, agent=agent: lead.user_id == agent)
            rows = self.env['mail.message'].search([
                ('model', '=', 'crm.lead'), ('res_id', 'in', mine.ids), ('webvue_notification_kind', '=', 'crm.assigned'),
                ('partner_ids', 'in', agent.partner_id.id),
            ])
            self.assertEqual((len(rows), rows.res_id), (1, mine[0].id), index)
            self.assertEqual(html2plaintext(rows.body).strip(), mine[0].name, 'the body is the name only, no prose')
            self.assertEqual(rows.webvue_crm_count, len(mine))
        lone = self._leads(1)
        self._service().with_user(self.manager)._webvue_assign(lone)
        lone_row = self.bell_rows(lone.user_id, lone, 'crm.assigned')
        self.assertEqual(html2plaintext(lone_row.body).strip(), lone.name)
        self.assertEqual(lone_row.webvue_crm_count, 1)

    def test_rotation_continues_across_calls(self):
        self._settings(**self._pool(self.agents))
        first, second = self._leads(2), self._leads(2)
        service = self._service()
        service._webvue_assign(first)
        service._webvue_assign(second)
        self.assertEqual(self._owners(first | second), [*self.agents.ids, self.agents[0].id])
        self.assertEqual(self._rotation().last_user_id, self.agents[0])

    def test_next_agent_is_the_first_id_after_the_last_one_wrapping_to_the_lowest(self):
        self._settings(**self._pool(self.agents))
        a, b, c = self.agents
        self.env['webvue.crm.rotation'].create({'company_id': self.company.id, 'last_user_id': b.id})
        leads = self._leads(3)
        self._service()._webvue_assign(leads)
        self.assertEqual(self._owners(leads), [c.id, a.id, b.id])

    def test_removing_an_agent_loses_nobody_a_turn_and_repeats_nobody(self):
        settings = self._settings(**self._pool(self.agents))
        a, b, c = self.agents
        service = self._service()
        service._webvue_assign(self._leads(1))
        self.assertEqual(self._rotation().last_user_id, a)
        settings.distribution_user_ids = [Command.set((b | c).ids)]
        step = self._leads(2)
        service._webvue_assign(step)
        self.assertEqual(self._owners(step), [b.id, c.id])
        settings.distribution_user_ids = [Command.set((a | b).ids)]
        wrapped = self._leads(2)
        service._webvue_assign(wrapped)
        self.assertEqual(self._owners(wrapped), [a.id, b.id])

    def test_adding_an_agent_gives_the_newcomer_their_turn_in_id_order(self):
        settings = self._settings(**self._pool(self.agents[:2]))
        a, b, c = self.agents
        service = self._service()
        service._webvue_assign(self._leads(1))
        settings.distribution_user_ids = [Command.set(self.agents.ids)]
        leads = self._leads(3)
        service._webvue_assign(leads)
        self.assertEqual(self._owners(leads), [b.id, c.id, a.id])

    def test_a_removed_last_agent_does_not_break_the_rotation(self):
        self._settings(**self._pool(self.agents))
        a, b, c = self.agents
        self.env['webvue.crm.rotation'].create({'company_id': self.company.id, 'last_user_id': b.id})
        self.agent2.active = False
        self.env['webvue.crm.rotation'].invalidate_model()
        leads = self._leads(2)
        self._service()._webvue_assign(leads)
        self.assertEqual(self._owners(leads), [c.id, a.id])

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

    def _assert_import_refused(self, agent):
        leads = self._leads(1)
        with self.assertRaises(ApiError) as caught:
            self._service()._webvue_assign(leads, mode='on_import', agent=agent)
        self.assertEqual(caught.exception.status, 422)
        self.assertEqual(caught.exception.code, 'invalid')
        self.assertEqual(caught.exception.field, 'user_id')
        self.assertFalse(leads.user_id)

    def test_on_import_with_an_agent_without_the_capability_is_422(self):
        self._settings(**self._pool(self.agents))
        self._assert_import_refused(self.outsider)

    def test_on_import_with_an_agent_who_lost_the_capability_is_422(self):
        self._settings(**self._pool(self.agents))
        self.env['webvue.access.service']._webvue_replace_assignments(self.manager, [])
        self._assert_import_refused(self.manager)

    def test_on_import_with_an_agent_outside_the_pool_is_422(self):
        self._settings(**self._pool(self.agent | self.agent2))
        self._assert_import_refused(self.agent3)

    def test_on_import_without_an_agent_leaves_leads_unassigned(self):
        self._settings(**self._pool(self.agents))
        leads = self._leads(2)
        self._service()._webvue_assign(leads, mode='on_import')
        self.assertFalse(leads.user_id)

    def test_leads_of_two_companies_use_their_own_pool_and_rotation(self):
        self._settings(**self._pool(self.agents))
        other_agent = new_test_user(
            self.env, login='crm_other_agent', name='Other company agent', groups='webvue_core.group_employee',
            company_id=self.other_company.id, company_ids=[Command.set(self.other_company.ids)],
        )
        self.env['webvue.access.service']._webvue_replace_assignments(other_agent, [{
            'role_id': self.env.ref('webvue_crm.role_crm_agent').id, 'company_id': self.other_company.id,
        }])
        eligible = self._service()._webvue_eligible_agents(self.other_company)
        self.assertEqual(eligible, other_agent)
        mine, theirs = self._leads(2), self._leads(2, company=self.other_company)
        self._service().with_user(1)._webvue_assign(mine | theirs)
        self.assertEqual(self._owners(mine), [self.agents[0].id, self.agents[1].id])
        self.assertEqual(self._owners(theirs), [other_agent.id, other_agent.id])
        self.assertEqual(self._rotation(self.other_company).last_user_id, other_agent)
        self.assertEqual(self._rotation().last_user_id, self.agents[1])

    def test_a_lead_without_a_company_stays_unassigned(self):
        self._settings(**self._pool(self.agents))
        leads = self._leads(2)
        orphan = self.env['crm.lead'].create({'name': 'No company', 'company_id': False, 'user_id': False})
        for service in (self._service(), self._service().with_user(1)):
            service._webvue_assign(orphan)
            service._webvue_assign(orphan, mode='on_import', agent=self.agent)
            self.assertFalse(orphan.user_id)
        self._service()._webvue_assign(leads | orphan)
        self.assertEqual(self._owners(leads), self.agents.ids[:2])
        self.assertFalse(orphan.user_id)

    def test_distribution_never_creates_the_settings_row_and_defaults_stay_current(self):
        Settings = self.env['webvue.crm.settings']
        before = Settings._webvue_effective()
        leads = self._leads(2)
        self._service(self.agent)._webvue_assign(leads)
        self.assertFalse(Settings.search([('company_id', '=', self.company.id)]))
        self.assertEqual(Settings._webvue_effective(), before)
        self.assertEqual(len(self._rotation()), 1)
        self.assertEqual(len(leads.user_id), 2)

    def test_a_create_race_on_first_use_rereads_the_other_transactions_row(self):
        self._settings(**self._pool(self.agents))
        winner = self.env['webvue.crm.rotation'].create({'company_id': self.company.id})
        model = type(self.env['webvue.crm.rotation'])
        real_search = model.search
        lookups = []

        def blind_first_lookup(records, domain, *args, **kwargs):
            lookups.append(domain)
            return records.browse() if len(lookups) == 1 else real_search(records, domain, *args, **kwargs)

        self.patch(model, 'search', blind_first_lookup)
        leads = self._leads(1)
        self._service(self.agent)._webvue_assign(leads)
        self.assertGreaterEqual(len(lookups), 2)
        self.assertEqual(self._rotation(), winner)
        self.assertEqual(winner.last_user_id, self.agents[0])
        self.assertEqual(self._owners(leads), [self.agents[0].id])

    def test_assignment_runs_as_the_superuser_without_a_user(self):
        self._settings(**self._pool(self.agents))
        leads = self._leads(3)
        self.env['webvue.crm.distribution'].with_user(1).with_company(self.company)._webvue_assign(leads)
        self.assertEqual(self._owners(leads), self.agents.ids)

    def test_the_rotation_row_is_locked_before_the_last_agent_is_read_and_moved(self):
        self._settings(**self._pool(self.agents))
        self.env['webvue.crm.rotation'].create({'company_id': self.company.id})
        table = self.env['webvue.crm.rotation']._table
        statements = []
        original = type(self.env.cr).execute

        def spy(cursor, query, params=None, *args, **kwargs):
            statements.append(query.code if hasattr(query, 'code') else str(query))
            return original(cursor, query, params, *args, **kwargs)

        self.patch(type(self.env.cr), 'execute', spy)
        self._service()._webvue_assign(self._leads(1))
        self.env.flush_all()
        locks = [i for i, text in enumerate(statements) if 'FOR UPDATE' in text and table in text]
        moves = [i for i, text in enumerate(statements) if 'UPDATE' in text and table in text and 'FOR UPDATE' not in text]
        self.assertTrue(locks)
        self.assertTrue(moves)
        self.assertLess(locks[0], moves[0])

    def test_last_agent_is_read_from_the_database_after_the_lock(self):
        # What a concurrent transaction does: it moves the row after this one cached it.
        self._settings(**self._pool(self.agents))
        row = self.env['webvue.crm.rotation'].create({'company_id': self.company.id})
        self.assertFalse(row.last_user_id)
        self.env.cr.execute(
            'UPDATE webvue_crm_rotation SET last_user_id = %s WHERE id = %s', [self.agents[1].id, row.id],
        )
        leads = self._leads(1)
        self._service()._webvue_assign(leads)
        self.assertEqual(leads.user_id, self.agents[2])
        row.invalidate_recordset()
        self.assertEqual(row.last_user_id, self.agents[2])
