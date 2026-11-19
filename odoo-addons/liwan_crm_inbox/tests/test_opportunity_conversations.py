# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import BOTH, CrmInboxCase
from odoo.addons.liwan_api.tests.common import set_probe_feature

LIST = '/api/v1/crm/opportunities/{}/conversations'
LINK = '/api/v1/inbox/conversations/{}/opportunity'
REF_KEYS = {'id', 'contact_name', 'stage', 'status', 'active'}


@tagged('post_install', '-at_install', 'liwan')
class TestOpportunityConversations(CrmInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.rep = cls.both_user('crm_inbox_rep')
        cls.rep2 = cls.both_user('crm_inbox_rep2')
        cls.lead = cls.make_lead(cls.rep, contact_name='Linked Lead')
        cls.conversation = cls.make_conversation()

    def link(self, conversation, lead):
        return self.api('PUT', LINK.format(conversation.id), {'opportunity_id': lead.id})

    def test_creates_from_the_contact_and_links_once(self):
        conversation = self.make_conversation()
        self.as_user(self.rep)
        path = LINK.format(conversation.id)
        result = self.api('POST', path, {})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(set(result.json()), REF_KEYS)
        lead = conversation.lead_id
        self.assertEqual(lead.id, result.json()['id'])
        self.assertEqual(lead.contact_name, conversation.contact_id.name)
        self.assertEqual(lead.phone, conversation.contact_id.phone)
        self.assertEqual(lead.user_id, self.rep)
        repeated = self.api('POST', path, {})
        self.assertEqual((repeated.status_code, repeated.json()['code']), (409, 'already_linked'))
        self.assertEqual(self.api('GET', LIST.format(lead.id)).json()['total'], 1)

    def test_the_opportunity_takes_the_source_of_the_conversation_channel(self):
        self.as_user(self.rep)
        whatsapp = self.make_conversation()
        self.assertEqual(self.api('POST', LINK.format(whatsapp.id), {}).status_code, 200)
        self.assertEqual(whatsapp.lead_id.source_id, self.env.ref('liwan_crm.source_whatsapp'))
        tiktok = self.make_conversation(channel=self.make_tiktok_channel())
        self.assertEqual(self.api('POST', LINK.format(tiktok.id), {}).status_code, 200)
        self.assertEqual(tiktok.lead_id.source_id, self.env.ref('liwan_crm_inbox.source_tiktok'))

    def test_the_opportunity_takes_the_customer_of_the_contact(self):
        self.as_user(self.rep)
        linked = self.make_conversation()
        customer = self.env['liwan.customers.service']._liwan_create({'name': 'Contact customer', 'phone': '+966501110021'})
        linked.contact_id.partner_id = customer
        self.assertEqual(self.api('POST', LINK.format(linked.id), {}).status_code, 200)
        self.assertEqual(linked.lead_id.partner_id, customer)
        alone = self.make_conversation()
        self.assertEqual(self.api('POST', LINK.format(alone.id), {}).status_code, 200)
        self.assertFalse(alone.lead_id.partner_id)

    def test_manual_distribution_refuses_an_agent_and_lets_an_assigner_create_unassigned(self):
        self.env['liwan.crm.settings'].search([('company_id', '=', self.env.company.id)]).distribution_mode = 'manual'
        assigner = self.both_user('crm_inbox_assigner', [*BOTH, 'crm.leads.assign'])
        refused = self.make_conversation()
        self.as_user(self.rep)
        result = self.api('POST', LINK.format(refused.id), {})
        self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'), result.text)
        self.assertFalse(refused.lead_id)
        allowed = self.make_conversation()
        self.as_user(assigner)
        result = self.api('POST', LINK.format(allowed.id), {})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertFalse(allowed.lead_id.user_id)
        self.assertEqual(allowed.lead_id.id, result.json()['id'])
        self.assertEqual(self.api('GET', LINK.format(allowed.id)).json()['id'], allowed.lead_id.id)

    def test_round_robin_lets_an_agent_create_from_the_conversation(self):
        self.env['liwan.crm.settings'].search([('company_id', '=', self.env.company.id)]).distribution_mode = 'round_robin'
        conversation = self.make_conversation()
        self.as_user(self.rep)
        result = self.api('POST', LINK.format(conversation.id), {})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(conversation.lead_id.id, result.json()['id'])
        self.assertEqual(conversation.lead_id.user_id, self.rep)

    def test_duplicate_phone_leaves_the_conversation_unlinked(self):
        conversation = self.make_conversation()
        existing = self.make_lead(self.rep, phone=conversation.contact_id.phone)
        self.as_user(self.rep)
        path = LINK.format(conversation.id)
        result = self.api('POST', path, {})
        self.assertEqual((result.status_code, result.json()['details']['reason']), (422, 'duplicate_phone'))
        self.assertFalse(conversation.lead_id)
        self.assertEqual(self.link(conversation, existing).status_code, 200)

    def test_closed_opportunities_with_the_phone_do_not_block_a_new_one(self):
        conversation = self.make_conversation()
        lost = self.make_lead(self.rep, phone=conversation.contact_id.phone)
        lost.action_set_lost()
        self.as_user(self.rep)
        result = self.api('POST', LINK.format(conversation.id), {})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertNotEqual(conversation.lead_id, lost)

    def test_link_read_list_and_unlink(self):
        self.as_user(self.rep)
        self.assertIsNone(self.api('GET', LINK.format(self.conversation.id)).json())
        linked = self.link(self.conversation, self.lead)
        self.assertEqual(linked.status_code, 200, linked.text)
        self.assertEqual(set(linked.json()), REF_KEYS)
        self.assertEqual((linked.json()['id'], linked.json()['contact_name'], linked.json()['active']), (self.lead.id, 'Linked Lead', True))
        self.assertEqual(self.conversation.lead_id, self.lead)
        self.assertEqual(self.api('GET', LINK.format(self.conversation.id)).json(), linked.json())
        listed = self.api('GET', LIST.format(self.lead.id))
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(set(listed.json()), {'items', 'total'})
        self.assertEqual([item['id'] for item in listed.json()['items']], [self.conversation.id])
        self.assertEqual(listed.json()['total'], 1)
        self.assertEqual(self.api('GET', LIST.format(self.lead.id) + '?limit=1&offset=1').json()['items'], [])
        self.assertEqual(self.link(self.conversation, self.lead).status_code, 200)
        removed = self.api('DELETE', LINK.format(self.conversation.id))
        self.assertEqual(removed.status_code, 204, removed.text)
        self.assertFalse(self.conversation.lead_id)
        self.assertEqual(self.api('DELETE', LINK.format(self.conversation.id)).status_code, 204)
        self.assertEqual(self.api('GET', LIST.format(self.lead.id)).json()['total'], 0)
        self.assertEqual(self.env['crm.lead'].search_count([('contact_name', '=', self.conversation.contact_id.name)]), 0)

    def test_a_conversation_keeps_one_opportunity_until_it_is_unlinked(self):
        other = self.make_lead(self.rep)
        conversation = self.make_conversation()
        self.as_user(self.rep)
        self.assertEqual(self.link(conversation, self.lead).status_code, 200)
        refused = self.link(conversation, other)
        self.assertEqual((refused.status_code, refused.json()['code']), (409, 'already_linked'), refused.text)
        self.assertEqual(conversation.lead_id, self.lead)

    def test_the_body_is_checked(self):
        self.as_user(self.rep)
        path = LINK.format(self.conversation.id)
        for body in ({}, {'opportunity_id': 'x'}, {'opportunity_id': 0}, {'opportunity_id': True}):
            response = self.api('PUT', path, body)
            self.assertEqual((response.status_code, response.json()['field']), (422, 'opportunity_id'), body)
        extra = self.api('PUT', path, {'opportunity_id': self.lead.id, 'lead_id': 1})
        self.assertEqual((extra.status_code, extra.json()['field']), (422, 'lead_id'))
        self.assertEqual(self.api('PUT', path, {'opportunity_id': 999999999}).status_code, 404)
        self.assertFalse(self.conversation.lead_id)

    def test_an_archived_opportunity_cannot_be_linked_and_a_linked_one_keeps_its_link(self):
        archived = self.make_lead(self.rep)
        archived.active = False
        self.as_user(self.rep)
        refused = self.link(self.conversation, archived)
        self.assertEqual((refused.status_code, refused.json()['field']), (422, 'opportunity_id'), refused.text)
        conversation = self.make_conversation()
        lead = self.make_lead(self.rep)
        self.assertEqual(self.link(conversation, lead).status_code, 200)
        lead.active = False
        self.assertEqual(conversation.lead_id, lead)
        shown = self.api('GET', LINK.format(conversation.id)).json()
        self.assertEqual((shown['id'], shown['active']), (lead.id, False))
        self.assertEqual(self.api('DELETE', LINK.format(conversation.id)).status_code, 204)

    def test_deleting_the_opportunity_keeps_the_conversation_and_clears_the_link(self):
        conversation = self.make_conversation()
        lead = self.make_lead(self.rep)
        self.as_user(self.rep)
        self.link(conversation, lead)
        lead.unlink()
        self.assertTrue(conversation.exists())
        self.assertFalse(conversation.lead_id)

    def test_an_opportunity_of_another_company_is_not_found(self):
        foreign = self.make_lead(None, company=self.env['res.company'].create({'name': 'Other bridge company'}))
        self.as_user(self.rep)
        self.assertEqual(self.link(self.conversation, foreign).status_code, 404)
        self.assertEqual(self.api('GET', LIST.format(foreign.id)).status_code, 404)
        self.assertFalse(self.conversation.lead_id)

    def test_two_different_customers_conflict_and_one_customer_is_never_copied(self):
        service = self.env['liwan.customers.service']
        first = service._liwan_create({'name': 'First customer', 'phone': '+966501110001'})
        second = service._liwan_create({'name': 'Second customer', 'phone': '+966501110002'})
        conversation = self.make_conversation()
        lead = self.make_lead(self.rep)
        conversation.contact_id.partner_id, lead.partner_id = first, second
        self.as_user(self.rep)
        refused = self.link(conversation, lead)
        self.assertEqual((refused.status_code, refused.json()['code']), (409, 'conflict'), refused.text)
        details = refused.json()['details']
        self.assertEqual(details['contact_customer']['id'], first.id)
        self.assertEqual(details['opportunity_customer']['id'], second.id)
        self.assertFalse(conversation.lead_id)
        lead.partner_id = first
        self.assertEqual(self.link(conversation, lead).status_code, 200)
        only_contact = self.make_conversation()
        only_contact.contact_id.partner_id = first
        bare = self.make_lead(self.rep)
        self.assertEqual(self.link(only_contact, bare).status_code, 200)
        self.assertFalse(bare.partner_id)
        only_lead = self.make_conversation()
        self.assertEqual(self.link(only_lead, lead).status_code, 200)
        self.assertFalse(only_lead.contact_id.partner_id)

    def test_each_closed_feature_refuses_every_route(self):
        calls = (('GET', LIST.format(self.lead.id)), ('GET', LINK.format(self.conversation.id)),
                 ('POST', LINK.format(self.conversation.id)), ('PUT', LINK.format(self.conversation.id)), ('DELETE', LINK.format(self.conversation.id)))
        for key in ('crm.enabled', 'inbox.enabled'):
            with self.subTest(feature=key):
                set_probe_feature(self, key=key, enabled=False)
                self.as_user(self.rep)
                for method, path in calls:
                    response = self.api(method, path, {'opportunity_id': self.lead.id} if method == 'PUT' else None)
                    self.assertEqual((response.status_code, response.json()['code']), (403, 'feature_not_included'), (key, method))
                set_probe_feature(self, key=key, enabled=True)
        self.assertEqual(self.as_user(self.rep).api('GET', LIST.format(self.lead.id)).status_code, 200)

    def test_the_capabilities_of_both_applications_are_needed(self):
        cases = {
            'ci_only_crm': ['crm.leads.read', 'crm.leads.work'],
            'ci_only_inbox': ['inbox.conversations.read', 'inbox.conversations.reply'],
            'ci_no_work': ['crm.leads.read', 'inbox.conversations.read', 'inbox.conversations.reply'],
            'ci_no_reply': ['crm.leads.read', 'crm.leads.work', 'inbox.conversations.read'],
        }
        for login, keys in cases.items():
            with self.subTest(login=login):
                user = self.both_user(login, keys)
                self.as_user(user)
                self.assertEqual(self.api('GET', LIST.format(self.lead.id)).status_code,
                                 200 if {'crm.leads.read', 'inbox.conversations.read'} <= set(keys) else 403)
                self.assertEqual(self.api('GET', LINK.format(self.conversation.id)).status_code,
                                 200 if {'crm.leads.read', 'inbox.conversations.read'} <= set(keys) else 403)
                for method in ('POST', 'PUT', 'DELETE'):
                    response = self.api(method, LINK.format(self.conversation.id), {'opportunity_id': self.lead.id})
                    self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'), (login, method))
        self.assertFalse(self.conversation.lead_id)
        self.as_user(self.outsider)
        self.assertEqual(self.api('GET', LIST.format(self.lead.id)).status_code, 403)
        self.assertLessEqual(set(BOTH), set(self.env['liwan.access.permission'].search([]).mapped('key')))

    def test_another_agents_opportunity_is_hidden_or_refused(self):
        lead = self.make_lead(self.rep)
        conversation = self.make_conversation()
        self.set_crm_visibility('own')
        self.as_user(self.rep2)
        hidden = self.link(conversation, lead)
        missing = self.api('PUT', LINK.format(conversation.id), {'opportunity_id': 999999999})
        self.assertEqual((hidden.status_code, hidden.content), (404, missing.content))
        self.assertEqual(self.api('GET', LIST.format(lead.id)).status_code, 404)
        self.set_crm_visibility('all')
        refused = self.link(conversation, lead)
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'forbidden'), refused.text)
        self.assertFalse(conversation.lead_id)

    def test_a_caller_who_cannot_see_the_opportunity_gets_no_name(self):
        lead = self.make_lead(self.rep, contact_name='Secret Name')
        conversation = self.make_conversation()
        self.as_user(self.rep)
        self.link(conversation, lead)
        self.set_crm_visibility('own')
        self.as_user(self.rep2)
        shown = self.api('GET', LINK.format(conversation.id))
        self.assertEqual((shown.status_code, shown.json()), (200, None))
        self.assertNotIn('Secret Name', shown.text)
        self.assertEqual(self.api('DELETE', LINK.format(conversation.id)).status_code, 404)
        self.assertEqual(conversation.lead_id, lead)
        self.set_crm_visibility('all')

    def test_a_conversation_the_caller_cannot_see_is_not_found(self):
        self.settings.visibility_policy = 'assigned_only'
        self.as_user(self.rep)
        hidden = self.api('GET', LINK.format(self.conversation.id))
        missing = self.api('GET', LINK.format(999999999))
        self.assertEqual((hidden.status_code, hidden.content), (404, missing.content))
        self.assertEqual(self.link(self.conversation, self.lead).status_code, 404)
        self.settings.visibility_policy = 'all'

    def test_the_list_holds_only_the_conversations_the_caller_sees(self):
        lead = self.make_lead(self.rep)
        mine, theirs = self.make_conversation(assignee_id=self.rep.id), self.make_conversation(assignee_id=self.rep2.id)
        mine.lead_id = theirs.lead_id = lead
        self.settings.visibility_policy = 'assigned_only'
        self.as_user(self.rep)
        listed = self.api('GET', LIST.format(lead.id)).json()
        self.assertEqual(([item['id'] for item in listed['items']], listed['total']), ([mine.id], 1))
        self.settings.visibility_policy = 'all'

    def test_a_customer_the_caller_cannot_see_is_not_named_in_the_conflict(self):
        service = self.env['liwan.customers.service']
        self.env['liwan.customers.settings']._liwan_current().sharing = 'branch'
        other_company = self.env['res.company'].create({'name': 'Other conflict company'})
        hidden = service.with_company(other_company)._liwan_create({'name': 'Hidden Name', 'phone': '+966501110009'})
        second = service._liwan_create({'name': 'Second customer', 'phone': '+966501110010'})
        conversation = self.make_conversation()
        lead = self.make_lead(self.rep)
        conversation.contact_id.partner_id, lead.partner_id = hidden, second
        refused = self.as_user(self.rep).link(conversation, lead)
        self.assertEqual((refused.status_code, refused.json()['code']), (409, 'conflict'), refused.text)
        self.assertEqual(refused.json()['details'], {
            'contact_customer': None, 'opportunity_customer': {'id': second.id, 'name': 'Second customer'},
        })
        self.assertNotIn('Hidden Name', refused.text)
