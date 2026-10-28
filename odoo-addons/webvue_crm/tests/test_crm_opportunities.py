# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import tagged

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

    def test_phone_is_normalised_from_arabic_digits_and_local_form(self):
        cases = {'٠٥٠١٢٣٤٥٦٧': '+966501234567', '۰۵۰۷۶۵۴۳۲۱': '+966507654321', '+966 50 111 2222': '+966501112222'}
        for raw, e164 in cases.items():
            self.assertEqual(self.env['crm.lead']._webvue_normalize_phone(raw, self.company), e164, raw)

    def test_phone_country_defaults_to_saudi_arabia(self):
        self.company.country_id = False
        self.assertEqual(self.env['crm.lead']._webvue_normalize_phone('0501234567', self.company), '+966501234567')

    def test_invalid_phone_is_refused(self):
        self.assertFalse(self.env['crm.lead']._webvue_normalize_phone('12', self.company))
        response = self.create(self.agent, phone='12')
        self.assertEqual((response.status_code, response.json()['field']), (422, 'phone'))

    def test_duplicate_across_lost_and_archived_records_is_refused_without_disclosure(self):
        lost = self.make_lead(self.agent2, contact_name='Hidden', phone='+966501234567')
        lost.action_set_lost()
        lost.active = False
        response = self.create(self.agent, phone='٠٥٠١٢٣٤٥٦٧')
        self.assertEqual(response.status_code, 422)
        body = response.json()
        self.assertEqual(body['message'], 'duplicate phone')
        self.assertEqual(body['field'], 'phone')
        text = response.text
        for leak in (str(lost.id), self.agent2.name, 'Hidden'):
            self.assertNotIn(leak, text)
        Lead = self.env['crm.lead'].with_context(active_test=False)
        self.assertEqual(Lead.search_count([('phone_sanitized', '=', '+966501234567')]), 1)

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
        self.assertEqual(self.create(self.agent, email='not-an-email').json()['field'], 'email')
        self.assertEqual(self.create(self.agent, source_id=999999).json()['field'], 'source_id')

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
        for method, path in (('GET', URL), ('POST', URL), ('GET', f'{URL}/{lead.id}'), ('PATCH', f'{URL}/{lead.id}')):
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
