# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import LiwanCrmCase

URL = '/api/v1/crm/opportunities'


class CrmVisibilityCase(LiwanCrmCase):
    """Fixture shared by the three mode classes: one team (agent, agent2), an agent outside it.

    Each mode class proves read list, read detail, PATCH, attachment and message reads through
    the ORM, and the export domain helper, for the same five opportunities.
    """

    MODE = None

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.agent3 = cls._user('crm_agent3', 'CRM Agent Three', 'liwan_crm.role_crm_agent')
        cls.team_a = cls.env['crm.team'].create({
            'name': 'Team A', 'company_id': cls.company.id,
            'crm_team_member_ids': [Command.create({'user_id': cls.agent.id}), Command.create({'user_id': cls.agent2.id})],
        })
        cls.own = cls.make_lead(cls.agent, contact_name='Own customer')
        cls.mate = cls.make_lead(cls.agent2, contact_name='Teammate customer')
        cls.outside = cls.make_lead(cls.agent3, contact_name='Outside customer')
        cls.unassigned = cls.make_lead(None, contact_name='Pool customer')
        cls.foreign = cls.make_lead(None, company=cls.other_company, contact_name='Foreign customer')
        cls.fixture = cls.own | cls.mate | cls.outside | cls.unassigned | cls.foreign
        for lead in cls.fixture:
            cls.env['ir.attachment'].create({
                'name': f'file-{lead.id}.txt', 'raw': b'x', 'res_model': 'crm.lead', 'res_id': lead.id,
            })
            lead.message_post(body='note', message_type='comment', subtype_xmlid='mail.mt_note')
        if cls.MODE:
            cls.set_visibility(cls.MODE)

    # Readers

    def listed(self, user):
        body = self.as_user(user).api('GET', f'{URL}?limit=200').json()
        return {item['id'] for item in body['items']} & set(self.fixture.ids)

    def detail_status(self, user, lead):
        return self.as_user(user).api('GET', f'{URL}/{lead.id}').status_code

    def patch_status(self, user, lead):
        return self.as_user(user).api('PATCH', f'{URL}/{lead.id}', json={'contact_name': 'Renamed'}).status_code

    def attachment_leads(self, user):
        rows = self.orm(user, 'ir.attachment').search([
            ('res_model', '=', 'crm.lead'), ('res_id', 'in', self.fixture.ids),
        ])
        return set(rows.mapped('res_id'))

    def message_leads(self, user):
        rows = self.orm(user, 'mail.message').search([
            ('model', '=', 'crm.lead'), ('res_id', 'in', self.fixture.ids),
        ])
        return set(rows.mapped('res_id'))

    def orm(self, user, model):
        """``model`` as ``user`` with the main company as the only active one, as the API pins it."""
        return self.env[model].with_user(user).with_context(allowed_company_ids=[self.company.id])

    def exported(self, user):
        """The export domain helper, evaluated without rules, must equal what the rules let through."""
        pinned = self.env['liwan.crm.visibility'].with_context(allowed_company_ids=[self.company.id])
        mirror = set(self.env['crm.lead'].search(pinned._liwan_domain(user)).ids) & set(self.fixture.ids)
        ruled = self.orm(user, 'crm.lead').search([
            ('company_id', '=', self.company.id), ('type', '=', 'opportunity'),
        ])
        self.assertEqual(mirror, set(ruled.ids) & set(self.fixture.ids), 'domain helper and record rules differ')
        return mirror

    def assertReads(self, user, leads):
        expected = set(leads.ids)
        self.assertEqual(self.listed(user), expected)
        self.assertEqual(self.exported(user), expected)
        self.assertEqual(self.attachment_leads(user), expected)
        self.assertEqual(self.message_leads(user), expected)

    # Every mode

    def check_managers_read_every_company_opportunity(self):
        self.assertReads(self.manager, self.own | self.mate | self.outside | self.unassigned)
        self.assertEqual(self.patch_status(self.manager, self.mate), 200)

    def check_other_company_is_not_found_for_everyone(self):
        for user in (self.agent, self.manager):
            self.assertEqual(self.detail_status(user, self.foreign), 404)
            self.assertEqual(self.patch_status(user, self.foreign), 404)

    def check_unassigned_is_hidden_from_agents(self):
        self.assertEqual(self.detail_status(self.agent, self.unassigned), 404)
        self.assertEqual(self.patch_status(self.agent, self.unassigned), 404)

    def check_agent_writes_own(self):
        self.assertEqual(self.detail_status(self.agent, self.own), 200)
        self.assertEqual(self.patch_status(self.agent, self.own), 200)


@tagged('post_install', '-at_install', 'liwan')
class TestCrmVisibilityOwn(CrmVisibilityCase):
    MODE = 'own'

    def test_agent_reads_own_only(self):
        self.assertReads(self.agent, self.own)
        self.assertEqual(self.detail_status(self.agent, self.mate), 404)
        self.assertEqual(self.patch_status(self.agent, self.mate), 404)
        self.check_agent_writes_own()
        self.check_unassigned_is_hidden_from_agents()

    def test_manager_reads_all(self):
        self.check_managers_read_every_company_opportunity()

    def test_other_company(self):
        self.check_other_company_is_not_found_for_everyone()

    def test_stock_all_leads_group_never_widens_own(self):
        self.agent.write({'group_ids': [Command.link(self.env.ref('sales_team.group_sale_salesman_all_leads').id)]})
        self.assertTrue(self.agent.has_group('sales_team.group_sale_salesman_all_leads'))
        self.assertReads(self.agent, self.own)
        self.assertEqual(self.patch_status(self.agent, self.mate), 404)

    def test_no_settings_row_reads_as_own(self):
        self.env['liwan.crm.settings'].search([('company_id', '=', self.company.id)]).unlink()
        self.assertReads(self.agent, self.own)


@tagged('post_install', '-at_install', 'liwan')
class TestCrmVisibilityTeam(CrmVisibilityCase):
    MODE = 'team'

    def test_teammates_read_each_other_but_write_own(self):
        self.assertReads(self.agent, self.own | self.mate)
        self.assertReads(self.agent2, self.own | self.mate)
        self.assertEqual(self.detail_status(self.agent, self.mate), 200)
        self.assertEqual(self.patch_status(self.agent, self.mate), 403)
        self.assertEqual(self.mate.contact_name, 'Teammate customer')
        self.check_agent_writes_own()
        self.check_unassigned_is_hidden_from_agents()

    def test_agent_outside_the_team_reads_own_only(self):
        self.assertReads(self.agent3, self.outside)
        self.assertEqual(self.detail_status(self.agent3, self.own), 404)

    def test_archived_membership_no_longer_shares(self):
        self.env['crm.team.member'].search([('user_id', '=', self.agent2.id)]).write({'active': False})
        self.assertReads(self.agent, self.own)

    def test_archived_team_no_longer_shares(self):
        self.team_a.active = False
        self.assertReads(self.agent, self.own)

    def test_team_of_another_company_does_not_share(self):
        self.env['ir.config_parameter'].set_param('sales_team.membership_multi', True)
        for user in (self.agent, self.agent3):
            user.write({'company_ids': [Command.link(self.other_company.id)]})
        self.env['crm.team'].create({
            'name': 'Team B', 'company_id': self.other_company.id,
            'crm_team_member_ids': [Command.create({'user_id': self.agent.id}), Command.create({'user_id': self.agent3.id})],
        })
        self.assertReads(self.agent, self.own | self.mate)
        self.assertEqual(self.detail_status(self.agent, self.outside), 404)

    def test_manager_reads_all(self):
        self.check_managers_read_every_company_opportunity()

    def test_other_company(self):
        self.check_other_company_is_not_found_for_everyone()


@tagged('post_install', '-at_install', 'liwan')
class TestCrmVisibilityAll(CrmVisibilityCase):
    MODE = 'all'

    def test_everyone_reads_assigned_but_writes_own(self):
        self.assertReads(self.agent, self.own | self.mate | self.outside)
        self.assertEqual(self.detail_status(self.agent, self.outside), 200)
        self.assertEqual(self.patch_status(self.agent, self.outside), 403)
        self.assertEqual(self.patch_status(self.agent, self.mate), 403)
        self.check_agent_writes_own()
        self.check_unassigned_is_hidden_from_agents()

    def test_orm_write_on_another_agents_opportunity_is_refused(self):
        with self.assertRaises(AccessError):
            self.mate.with_user(self.agent).write({'contact_name': 'Hijacked'})

    def test_manager_reads_and_writes_all(self):
        self.check_managers_read_every_company_opportunity()

    def test_other_company(self):
        self.check_other_company_is_not_found_for_everyone()


@tagged('post_install', '-at_install', 'liwan')
class TestCrmVisibilityChanges(CrmVisibilityCase):
    """Policy changes apply on the next request, with no restart (the rule cache stays correct)."""

    MODE = 'own'

    def test_settings_mode_change_applies_on_the_next_request(self):
        self.assertEqual(self.listed(self.agent), {self.own.id})
        response = self.as_manager().api('GET', '/api/v1/crm/settings')
        revision = response.json()['revision']
        response = self.as_manager().api('PATCH', '/api/v1/crm/settings', json={
            'revision': revision, 'values': {'visibility': 'all'},
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.listed(self.agent), {self.own.id, self.mate.id, self.outside.id})

    def test_revoking_assign_applies_on_the_next_request(self):
        self.assertIn(self.unassigned.id, self.listed(self.manager))
        self.env['liwan.access.service']._liwan_replace_assignments(self.manager, [{
            'role_id': self.env.ref('liwan_crm.role_crm_agent').id,
            'company_id': self.company.id,
        }])
        self.assertEqual(self.listed(self.manager), set())
        self.assertEqual(self.detail_status(self.manager, self.unassigned), 404)

    def test_granting_assign_applies_on_the_next_request(self):
        self.assertEqual(self.listed(self.agent), {self.own.id})
        self.env['liwan.access.service']._liwan_replace_assignments(self.agent, [{
            'role_id': self.env.ref('liwan_crm.role_crm_manager').id,
            'company_id': self.company.id,
        }])
        self.assertEqual(self.listed(self.agent), {self.own.id, self.mate.id, self.outside.id, self.unassigned.id})


@tagged('post_install', '-at_install', 'liwan')
class TestCrmVisibilityCompanyMembership(LiwanCrmCase):
    """A CRM role in company A grants nothing in company B, where the user is only a member.

    Capability groups are the union over every company of the user, so the record rules must
    scope each branch (own, all, team, assign) to the companies where the user holds
    crm.leads.read. An own opportunity in such a company is hidden as well: no CRM capability
    there means no CRM data there.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env['ir.config_parameter'].set_param('sales_team.membership_multi', True)
        cls.company_b = cls.other_company
        # agent and agent2 hold the agent role in A only; agent3 holds it in A and B.
        cls.agent3 = cls._user('crm_agent3', 'CRM Agent Three', 'liwan_crm.role_crm_agent')
        for user in (cls.agent, cls.agent2, cls.agent3, cls.manager):
            user.write({'company_ids': [Command.link(cls.company_b.id)]})
        cls.env['liwan.access.assignment'].create({
            'user_id': cls.agent3.id, 'role_id': cls.env.ref('liwan_crm.role_crm_agent').id,
            'company_id': cls.company_b.id,
        })
        cls.env['crm.team'].create({
            'name': 'Team B', 'company_id': cls.company_b.id,
            'crm_team_member_ids': [Command.create({'user_id': user.id}) for user in (cls.agent, cls.agent2, cls.agent3)],
        })
        cls.own_b = cls.make_lead(cls.agent, company=cls.company_b, contact_name='Own in B')
        cls.mate_b = cls.make_lead(cls.agent2, company=cls.company_b, contact_name='Teammate in B')
        cls.pool_b = cls.make_lead(None, company=cls.company_b, contact_name='Pool in B')
        cls.leads_b = cls.own_b | cls.mate_b | cls.pool_b
        for lead in cls.leads_b:
            cls.env['ir.attachment'].create({
                'name': f'file-{lead.id}.txt', 'raw': b'x', 'res_model': 'crm.lead', 'res_id': lead.id,
            })
            lead.message_post(body='note', message_type='comment', subtype_xmlid='mail.mt_note')

    def orm(self, user, model):
        """``model`` as ``user`` with company B as the current company and A also active."""
        return self.env[model].with_user(user).with_context(allowed_company_ids=[self.company_b.id, self.company.id])

    def read_b(self, user):
        """Opportunities of company B reachable through the ORM: records, attachments, messages."""
        ids = self.leads_b.ids
        leads = set(self.orm(user, 'crm.lead').search([('id', 'in', ids)]).ids)
        attachments = set(self.orm(user, 'ir.attachment').search([
            ('res_model', '=', 'crm.lead'), ('res_id', 'in', ids),
        ]).mapped('res_id'))
        messages = set(self.orm(user, 'mail.message').search([
            ('model', '=', 'crm.lead'), ('res_id', 'in', ids),
        ]).mapped('res_id'))
        return leads, attachments, messages

    def test_every_mode_hides_company_b_from_a_user_without_a_role_there(self):
        for mode in ('own', 'team', 'all'):
            with self.subTest(mode=mode):
                self.set_visibility(mode, company=self.company_b)
                for user in (self.agent, self.manager):
                    self.assertEqual(self.read_b(user), (set(), set(), set()), user.login)
                with self.assertRaises(AccessError):
                    self.own_b.with_user(self.agent).with_context(
                        allowed_company_ids=[self.company_b.id, self.company.id],
                    ).write({'contact_name': 'Changed'})
                domain = self.env['liwan.crm.visibility'].with_company(self.company_b)._liwan_domain(self.agent)
                self.assertFalse(self.env['crm.lead'].search(domain))

    def test_a_role_in_company_b_applies_the_mode_there(self):
        # agent3 owns nothing in B; Team B holds agent, agent2 and agent3.
        assigned = {self.own_b.id, self.mate_b.id}
        expected = {'own': set(), 'team': assigned, 'all': assigned}
        for mode, ids in expected.items():
            with self.subTest(mode=mode):
                self.set_visibility(mode, company=self.company_b)
                self.assertEqual(self.read_b(self.agent3), (ids, ids, ids))
                domain = self.env['liwan.crm.visibility'].with_company(self.company_b)._liwan_domain(self.agent3)
                self.assertEqual(set(self.env['crm.lead'].search(domain).ids), ids)
