# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-request company isolation for the routes that join a conversation and an opportunity."""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import (
    CompanyIsolationCase,
    assert_isolation_discovery,
    cover_isolation_routes,
)

LIST = '/api/v1/crm/opportunities/{}/conversations'
LINK = '/api/v1/inbox/conversations/{}/opportunity'
EXPECTED_GET_RECORD_ROUTES = 3
# Session company -> the companies whose records it reads (a parent reads its branches; the rest read their own).
SEES = {'p': ('p', 'p1', 'p2'), 'p1': ('p1',), 'p2': ('p2',), 'c': ('c',)}
KEYS = [
    'crm.leads.read', 'crm.leads.work', 'inbox.conversations.read', 'inbox.conversations.reply',
    'inbox.channels.manage', 'crm.settings.manage', 'crm.settings.read', 'crm.leads.assign',
]
SETTINGS = '/api/v1/inbox/channels/{}/crm-settings'


@tagged('post_install', '-at_install', 'liwan')
class TestCrmInboxCompanyIsolation(CompanyIsolationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.by_tag = {'p': cls.company_p, 'p1': cls.company_p1, 'p2': cls.company_p2, 'c': cls.company_c}
        Assignment = cls.env['liwan.access.assignment'].sudo()
        permissions = cls.env['liwan.access.permission'].search([('key', 'in', KEYS)])
        Lead = cls.env['crm.lead'].with_context(mail_auto_subscribe_no_notify=True)
        cls.leads, cls.conversations, cls.channels = {}, {}, {}
        for i, (tag, company) in enumerate(cls.by_tag.items(), start=1):
            role = cls.env['liwan.access.role'].with_company(company).create({
                'key': f'iso_crm_inbox_{tag}', 'name_ar': f'iso_crm_inbox_{tag}', 'name_en': f'iso_crm_inbox_{tag}',
                'type': 'custom', 'assignable': True, 'company_id': company.id,
                'permission_ids': [(6, 0, permissions.ids)],
            })
            Assignment.create({'user_id': cls.iso_user.id, 'role_id': role.id, 'company_id': company.id})
            cls.env['liwan.inbox.settings'].with_company(company)._get_for_company().visibility_policy = 'all'
            cls.env['liwan.crm.settings'].create({'company_id': company.id, 'visibility': 'all'})
            cls.leads[tag] = Lead.with_company(company).create({
                'name': f'Lead {tag}', 'type': 'opportunity', 'company_id': company.id, 'user_id': cls.iso_user.id,
            })
            connection = cls.env['liwan.integration.connection'].create({
                'company_id': company.id, 'provider': 'meta', 'external_id': '200000000001', 'state': 'connected',
            })
            channel = cls.env['liwan.inbox.channel'].create({
                'name': f'Channel {tag}', 'phone_number_id': f'90000000{i:04d}', 'connection_id': connection.id,
                'state': 'connected', 'owner_company_id': company.id,
            })
            cls.channels[tag] = channel
            contact = cls.env['liwan.inbox.contact'].create({
                'name': f'Customer {tag}', 'phone': f'+96650000{i:04d}', 'company_id': company.id,
            })
            identity = cls.env['liwan.inbox.contact.identity'].create({
                'contact_id': contact.id, 'channel_kind': 'whatsapp', 'address': f'96650000{i:04d}',
                'company_id': company.id,
            })
            cls.conversations[tag] = cls.env['liwan.inbox.conversation'].create({
                'channel_id': channel.id, 'contact_id': contact.id, 'identity_id': identity.id,
                'company_id': company.id, 'lead_id': cls.leads[tag].id,
            })

    def test_every_route_follows_the_company_of_its_record(self):
        # An opportunity is read in its own company only; a conversation is also read by the parent of its company.
        for current, company in self.by_tag.items():
            self.env_in(company)
            for tag in self.by_tag:
                lead, conversation = self.leads[tag], self.conversations[tag]
                if tag == current:
                    self.assertVisible(LIST.format(lead.id))
                    self.assertEqual(self.assertVisible(LINK.format(conversation.id)).json()['id'], lead.id)
                    self.assertEqual(self.api('PUT', LINK.format(conversation.id), {'opportunity_id': lead.id}).status_code, 200)
                    continue
                self.assertHiddenEveryWay('GET', LIST.format(lead.id), self.by_tag[tag].id)
                body = {'opportunity_id': lead.id}
                if tag in SEES[current]:
                    # The conversation is visible, its opportunity is not: no name, no write.
                    self.assertIsNone(self.assertVisible(LINK.format(conversation.id)).json())
                    self.assertEqual(self.api('PUT', LINK.format(conversation.id), body).status_code, 404)
                    self.assertEqual(self.api('DELETE', LINK.format(conversation.id)).status_code, 404)
                else:
                    self.assertHiddenEveryWay('GET', LINK.format(conversation.id), self.by_tag[tag].id)
                    self.assertEqual(self.api('PUT', LINK.format(conversation.id), body).status_code, 404)
                    self.assertEqual(self.api('DELETE', LINK.format(conversation.id)).status_code, 404)
                self.assertEqual(conversation.lead_id, lead)

    def test_the_channel_setting_follows_the_company_of_its_channel(self):
        for current, company in self.by_tag.items():
            self.env_in(company)
            for tag, channel in self.channels.items():
                path = SETTINGS.format(channel.id)
                if tag in SEES[current]:
                    self.assertEqual(self.assertVisible(path).json()['channel_id'], channel.id)
                else:
                    self.assertHiddenEveryWay('GET', path, self.by_tag[tag].id)
                    self.assertEqual(self.api('PATCH', path, {'opportunity_mode': 'auto_first_message'}).status_code, 404)
                    self.assertEqual(channel.crm_opportunity_mode, 'manual')

    def test_a_parent_session_refuses_to_join_records_of_two_companies(self):
        self.env_in(self.company_p)
        conversation = self.conversations['p1']
        conversation.lead_id = False
        response = self.api('PUT', LINK.format(conversation.id), {'opportunity_id': self.leads['p'].id})
        self.assertEqual((response.status_code, response.json().get('field')), (422, 'opportunity_id'), response.text)
        self.assertFalse(conversation.lead_id)

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'liwan_crm_inbox', EXPECTED_GET_RECORD_ROUTES)


cover_isolation_routes((
    '/api/v1/crm/opportunities/<int:opportunity_id>/conversations',
    '/api/v1/inbox/conversations/<int:conversation_id>/opportunity',
    '/api/v1/inbox/channels/<int:channel_id>/crm-settings',
), source='liwan_crm_inbox/tests/test_company_isolation.py')
