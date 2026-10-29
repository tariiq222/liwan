# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2 import IntegrityError

from odoo import Command
from odoo.tests import tagged
from odoo.tools import mute_logger

from .common import WebVueCrmCase
from odoo.addons.webvue_api.tests.common import set_probe_feature

URL = '/api/v1/crm/opportunities'
AUDIT_URL = '/api/v1/crm/audit/views'
OPPORTUNITY_KEYS = {
    'id', 'contact_name', 'phone', 'email', 'stage', 'user', 'source', 'package', 'lost_reason', 'status',
    'list_price', 'discount_percent', 'final_price', 'expected_revenue', 'attempt_count', 'next_call_at',
    'cycle', 'recycle_at', 'needs_manager', 'active', 'created_at',
}
TRACKED = (
    'stage_id', 'user_id', 'contact_name', 'phone', 'email_from', 'webvue_package_id',
    'webvue_final_price', 'webvue_discount_percent', 'lost_reason_id', 'source_id',
)


@tagged('post_install', '-at_install', 'webvue')
class TestCrmOpportunities(WebVueCrmCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company.country_id = cls.env.ref('base.sa')
        cls.source = cls.env['utm.source'].create({'name': 'Walk-in'})

    def create(self, user, **body):
        return self.as_user(user).api('POST', URL, json={'contact_name': 'Customer', 'phone': '0501234567', **body})

    # Create

    def test_create_forces_opportunity_type_and_assigns_the_creator(self):
        self.agent.write({'group_ids': [Command.link(self.env.ref('crm.group_use_lead').id)]})
        response = self.create(self.agent, email='a@example.com', source_id=self.source.id)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(set(body), OPPORTUNITY_KEYS)
        lead = self.env['crm.lead'].browse(body['id'])
        self.assertEqual(lead.type, 'opportunity')
        self.assertEqual(lead.user_id, self.agent)
        self.assertEqual(lead.company_id, self.company)
        self.assertEqual(body['phone'], '+966501234567')
        self.assertEqual(body['source'], {'id': self.source.id, 'name': 'Walk-in'})
        self.assertEqual(body['user']['id'], self.agent.id)

    def test_the_agent_picker_lists_only_users_who_can_take_opportunities(self):
        listed = self.as_user(self.manager).api('GET', '/api/v1/crm/agents')
        self.assertEqual(listed.status_code, 200, listed.text)
        ids = {person['id'] for person in listed.json()}
        self.assertLessEqual({self.agent.id, self.agent2.id}, ids)
        self.assertNotIn(self.outsider.id, ids)
        self.assertEqual(set(listed.json()[0]), {'id', 'name', 'user_id'})
        found = self.as_user(self.manager).api('GET', '/api/v1/crm/agents?q=two').json()
        self.assertEqual([person['id'] for person in found], [self.agent2.id])
        self.assertEqual(self.as_user(self.agent).api('GET', '/api/v1/crm/agents').status_code, 403)

    def test_creating_for_another_agent_tells_that_agent_only(self):
        response = self.create(self.manager, user_id=self.agent2.id)
        self.assertEqual(response.status_code, 200, response.text)
        lead = self.env['crm.lead'].browse(response.json()['id'])
        self.assertEqual(len(self.bell_rows(self.agent2, lead, 'crm.assigned')), 1)
        self.assertFalse(self.bell_rows(self.manager, lead, 'crm.assigned'))
        self.assertFalse(self.assignment_mails(lead))
        mine = self.create(self.agent, phone='0507654321')
        self.assertEqual(mine.status_code, 200, mine.text)
        own = self.env['crm.lead'].browse(mine.json()['id'])
        self.assertFalse(self.bell_rows(self.agent, own, 'crm.assigned'))

    def test_phone_is_normalised_from_arabic_digits_and_local_form(self):
        cases = {
            '٠٥٠١٢٣٤٥٦٧': '+966501234567', '۰۵۰۷۶۵۴۳۲۱': '+966507654321', '+966 50 111 2222': '+966501112222',
            '501234567': '+966501234567', '00966501234567': '+966501234567', '966501234567': '+966501234567',
            '050-123-4567': '+966501234567', '\u200f\u202a0501234567\u202c': '+966501234567',
        }
        for raw, e164 in cases.items():
            self.assertEqual(self.env['crm.lead']._webvue_normalize_phone(raw, self.company), e164, raw)

    def test_phone_country_defaults_to_saudi_arabia(self):
        self.company.country_id = False
        self.assertEqual(self.env['crm.lead']._webvue_normalize_phone('0501234567', self.company), '+966501234567')

    def test_invalid_phone_is_refused(self):
        self.assertFalse(self.env['crm.lead']._webvue_normalize_phone('12', self.company))
        response = self.create(self.agent, phone='12')
        self.assertEqual((response.status_code, response.json()['field']), (422, 'phone'))
        self.assertEqual(response.json()['details'], {'reason': 'invalid_phone'})

    def test_duplicate_across_lost_and_archived_records_is_refused_without_disclosure(self):
        lost = self.make_lead(self.agent2, contact_name='Hidden', phone='+966501234567')
        lost.action_set_lost()
        lost.active = False
        response = self.create(self.agent, phone='٠٥٠١٢٣٤٥٦٧')
        self.assertEqual(response.status_code, 422)
        body = response.json()
        self.assertEqual(body['message'], 'duplicate phone')
        self.assertEqual(body['field'], 'phone')
        self.assertEqual(body['details'], {'reason': 'duplicate_phone'})
        text = response.text
        for leak in (str(lost.id), self.agent2.name, 'Hidden'):
            self.assertNotIn(leak, text)
        Lead = self.env['crm.lead'].with_context(active_test=False)
        self.assertEqual(Lead.search_count([('phone_sanitized', '=', '+966501234567')]), 1)

    def test_duplicate_written_between_check_and_create_is_refused_by_the_index(self):
        self.make_lead(self.agent2, phone='+966501234567')
        self.patch(type(self.env['crm.lead']), '_webvue_find_duplicate', lambda *_: False)
        with mute_logger('odoo.sql_db'):
            response = self.create(self.agent)
        self.assertEqual(response.status_code, 422)
        self.assertEqual((response.json()['message'], response.json()['field']), ('duplicate phone', 'phone'))
        self.assertEqual(response.json()['details'], {'reason': 'duplicate_phone'})
        Lead = self.env['crm.lead'].with_context(active_test=False)
        self.assertEqual(Lead.search_count([('phone_sanitized', '=', '+966501234567')]), 1)

    def test_one_phone_per_company_is_a_database_invariant(self):
        self.make_lead(self.agent, phone='+966501234567')
        with mute_logger('odoo.sql_db'), self.assertRaises(IntegrityError), self.env.cr.savepoint():
            self.make_lead(self.agent2, phone='+966501234567')
            self.env.flush_all()
        self.make_lead(None, company=self.other_company, phone='+966501234567')
        self.env.flush_all()

    def test_prices_and_discount_are_bounded(self):
        for vals in ({'webvue_discount_percent': 101}, {'webvue_discount_percent': -1},
                     {'webvue_list_price': -1}, {'webvue_final_price': -1}):
            with self.subTest(vals=vals), mute_logger('odoo.sql_db'), self.assertRaises(IntegrityError), \
                    self.env.cr.savepoint():
                self.make_lead(self.agent, **vals)
                self.env.flush_all()

    def test_duplicate_in_another_company_is_not_a_duplicate(self):
        self.make_lead(None, company=self.other_company, phone='+966501234567')
        self.assertEqual(self.create(self.agent).status_code, 200)

    def test_agent_cannot_assign_to_another_user(self):
        response = self.create(self.agent, user_id=self.agent2.id)
        self.assertEqual(response.status_code, 403)

    def test_manager_assigns_to_an_eligible_agent_or_to_the_pool(self):
        body = self.create(self.manager, user_id=self.agent2.id).json()
        self.assertEqual(body['user']['id'], self.agent2.id)
        body = self.create(self.manager, user_id=None, phone='0507654321').json()
        self.assertIsNone(body['user'])

    def test_manager_cannot_assign_to_an_ineligible_user(self):
        response = self.create(self.manager, user_id=self.outsider.id)
        self.assertEqual((response.status_code, response.json()['field']), (422, 'user_id'))

    def test_create_rejects_unknown_fields_and_missing_values(self):
        self.assertEqual(self.create(self.agent, stage_id=1).json()['field'], 'stage_id')
        response = self.as_agent().api('POST', URL, json={'contact_name': 'Customer'})
        self.assertEqual((response.status_code, response.json()['field']), (422, 'phone'))
        bad_email = self.create(self.agent, email='not-an-email').json()
        self.assertEqual((bad_email['field'], bad_email['details']), ('email', {'reason': 'invalid_email'}))
        self.assertEqual(self.create(self.agent, source_id=999999).json()['field'], 'source_id')

    def test_create_starts_in_the_first_open_stage_even_when_the_won_stage_sorts_first(self):
        self.env.ref('webvue_crm.stage_won').sequence = 1
        self.env.ref('webvue_crm.stage_new').active = False
        response = self.create(self.agent)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['stage']['id'], self.env.ref('webvue_crm.stage_contacted').id)

    def test_create_skips_a_new_stage_that_became_the_won_stage(self):
        self.env.ref('webvue_crm.stage_new').is_won = True
        self.env.ref('webvue_crm.stage_won').is_won = False
        contacted = self.env.ref('webvue_crm.stage_contacted')
        contacted.sequence = 0
        response = self.create(self.agent)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['stage']['id'], contacted.id)
        lead = self.env['crm.lead'].browse(response.json()['id'])
        lead.active = False
        lead._webvue_restart()
        self.assertEqual(lead.stage_id, contacted)

    # Detail, patch, list

    def test_patch_changes_whitelisted_fields_and_rechecks_the_phone(self):
        lead = self.env['crm.lead'].browse(self.create(self.agent).json()['id'])
        self.make_lead(self.agent2, phone='+966507654321')
        response = self.as_agent().api('PATCH', f'{URL}/{lead.id}', json={'phone': '0501234567', 'contact_name': 'New'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(lead.name, 'New')
        response = self.as_agent().api('PATCH', f'{URL}/{lead.id}', json={'phone': '0507654321'})
        self.assertEqual((response.status_code, response.json()['message']), (422, 'duplicate phone'))

    def test_patch_refuses_the_won_stage_and_unknown_fields(self):
        lead = self.make_lead(self.agent)
        response = self.as_agent().api('PATCH', f'{URL}/{lead.id}', json={'stage_id': self.env.ref('webvue_crm.stage_won').id})
        self.assertEqual((response.status_code, response.json()['field']), (422, 'stage_id'))
        response = self.as_agent().api('PATCH', f'{URL}/{lead.id}', json={'user_id': self.agent2.id})
        self.assertEqual((response.status_code, response.json()['field']), (422, 'user_id'))

    def test_list_filters(self):
        mine = self.make_lead(self.agent, contact_name='Alpha', webvue_needs_manager=True)
        pool = self.make_lead(None, contact_name='Beta')
        manager = self.as_manager()
        ids = {item['id'] for item in manager.api('GET', f'{URL}?unassigned=true').json()['items']}
        self.assertIn(pool.id, ids)
        self.assertNotIn(mine.id, ids)
        ids = {item['id'] for item in manager.api('GET', f'{URL}?needs_manager=true').json()['items']}
        self.assertEqual(ids & {mine.id, pool.id}, {mine.id})
        ids = {item['id'] for item in manager.api('GET', f'{URL}?q=Alph').json()['items']}
        self.assertEqual(ids & {mine.id, pool.id}, {mine.id})
        response = manager.api('GET', f'{URL}?due=maybe')
        self.assertEqual((response.status_code, response.json()['field']), (422, 'due'))

    def test_list_status_filter_defaults_to_open_and_finds_won_and_lost(self):
        open_lead = self.make_lead(self.agent, contact_name='Open')
        won = self.make_lead(self.agent, contact_name='Won')
        won.action_set_won()
        lost = self.make_lead(self.agent, contact_name='Lost')
        lost.action_set_lost()
        manager = self.as_manager()

        def ids(query=''):
            items = manager.api('GET', f'{URL}{query}').json()['items']
            return {item['id'] for item in items} & {open_lead.id, won.id, lost.id}

        self.assertEqual(ids(), {open_lead.id})
        self.assertEqual(ids('?status=open'), {open_lead.id})
        self.assertEqual(ids('?status=won'), {won.id})
        self.assertEqual(ids('?status=lost'), {lost.id})
        self.assertEqual(ids('?status=all'), {open_lead.id, won.id, lost.id})
        response = manager.api('GET', f'{URL}?status=maybe')
        self.assertEqual((response.status_code, response.json()['field']), (422, 'status'))
        self.assertEqual(self.as_agent().api('GET', f'{URL}?status=lost').json()['total'] >= 1, True)

    # View log

    def test_view_log_is_written_only_when_enabled(self):
        lead = self.make_lead(self.agent)
        Log = self.env['webvue.crm.view.log']
        self.assertEqual(self.as_agent().api('GET', f'{URL}/{lead.id}').status_code, 200)
        self.assertFalse(Log.search([('lead_id', '=', lead.id)]))
        self.set_visibility('own', view_log_enabled=True)
        self.assertEqual(self.as_agent().api('GET', f'{URL}/{lead.id}').status_code, 200)
        row = Log.search([('lead_id', '=', lead.id)])
        self.assertEqual((row.user_id, row.company_id), (self.agent, self.company))
        body = self.as_manager().api('GET', AUDIT_URL).json()
        self.assertEqual(body['total'], 1)
        self.assertEqual(set(body['items'][0]), {'id', 'user', 'opportunity_id', 'viewed_at'})
        self.assertEqual(body['items'][0]['opportunity_id'], lead.id)

    def test_view_log_is_readable_only_with_audit_read(self):
        self.assertEqual(self.as_agent().api('GET', AUDIT_URL).status_code, 403)
        self.assertFalse(self.env['webvue.crm.view.log'].with_user(self.agent).has_access('read'))

    # Gates

    def test_outsider_is_forbidden(self):
        for method, path in (('GET', URL), ('POST', URL), ('GET', AUDIT_URL)):
            response = self.as_user(self.outsider).api(method, path, json={} if method == 'POST' else None)
            self.assertEqual(response.status_code, 403, path)

    def test_closed_feature_refuses_every_route(self):
        lead = self.make_lead(self.agent)
        set_probe_feature(self, key='crm.enabled', enabled=False)
        routes = (('GET', URL), ('POST', URL), ('GET', f'{URL}/{lead.id}'), ('PATCH', f'{URL}/{lead.id}'), ('GET', AUDIT_URL))
        for method, path in routes:
            response = self.as_agent().api(method, path, json={} if method in ('POST', 'PATCH') else None)
            self.assertEqual(response.status_code, 403, f'{method} {path}')

    # Model

    def test_expected_revenue_is_the_final_price(self):
        lead = self.make_lead(self.agent, webvue_final_price=1500)
        self.assertEqual(lead.expected_revenue, 1500)
        lead.webvue_final_price = 700
        self.assertEqual(lead.expected_revenue, 700)

    def test_spec_fields_are_tracked(self):
        fields = self.env['crm.lead']._fields
        for name in TRACKED:
            self.assertTrue(fields[name].tracking, name)
