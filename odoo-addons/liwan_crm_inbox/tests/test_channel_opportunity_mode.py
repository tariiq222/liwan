# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .common import CrmInboxCase
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_inbox.tests import whatsapp_payloads as wa
from odoo.addons.liwan_inbox.tests.health_common import process

SETTINGS = '/api/v1/inbox/channels/{}/crm-settings'
SETTINGS_KEYS = {'channel_id', 'opportunity_mode'}
WA_ID = '966501112222'
PHONE = f'+{WA_ID}'
CRM_MANAGER = ['crm.settings.manage', 'crm.settings.read', 'crm.leads.assign', 'crm.leads.read']
MANAGERS = ['inbox.channels.manage', *CRM_MANAGER]


@tagged('post_install', '-at_install', 'liwan')
class TestChannelOpportunityMode(CrmInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.rep = cls.both_user('crm_mode_rep')
        cls.admin = cls.both_user('crm_mode_admin', MANAGERS)
        cls.settings_row = cls.env['liwan.crm.settings'].search([('company_id', '=', cls.env.company.id)])

    def setUp(self):
        super().setUp()
        self.channel.crm_opportunity_mode = 'auto_first_message'

    def receive(self, provider_id='wamid.CRM1', wa_id=WA_ID, channel=None):
        channel = channel or self.channel
        process(self, channel, wa.inbound_text(provider_id=provider_id, wa_id=wa_id, phone_id=channel.phone_number_id))
        return self.env['liwan.inbox.message'].search([('provider_message_id', '=', provider_id)])

    def leads(self):
        return self.env['crm.lead'].with_context(active_test=False).search([('phone_sanitized', '=', PHONE)])

    def test_a_new_channel_is_manual_and_creates_nothing(self):
        channel = self.make_channel(phone_id='100000000077', business_account_id='200000000077')
        self.assertEqual(channel.crm_opportunity_mode, 'manual')
        message = self.receive('wamid.MANUAL1', channel=channel)
        self.assertEqual(message.conversation_id.channel_id, channel)
        self.assertFalse(message.conversation_id.lead_id)
        self.assertFalse(self.leads())

    def test_auto_creates_the_opportunity_of_a_new_conversation(self):
        message = self.receive()
        lead = message.conversation_id.lead_id
        self.assertEqual(self.leads(), lead)
        self.assertEqual((lead.type, lead.phone_sanitized, lead.contact_name), ('opportunity', PHONE, 'Sara'))
        self.assertEqual(lead.company_id, self.env.company)
        self.assertEqual(lead.source_id, self.env.ref('liwan_crm.source_whatsapp'))
        self.assertEqual(lead.stage_id, self.env['crm.lead']._liwan_first_stage())
        self.assertEqual(lead.won_status, 'pending')

    def test_the_opportunity_follows_the_company_distribution(self):
        self.settings_row.distribution_mode = 'round_robin'
        lead = self.receive('wamid.RR1').conversation_id.lead_id
        eligible = self.env['liwan.crm.distribution']._liwan_eligible_agents(self.env.company)
        self.assertIn(lead.user_id, eligible)
        self.settings_row.distribution_mode = 'manual'
        other = self.receive('wamid.RR2', wa_id='966501113333').conversation_id.lead_id
        self.assertTrue(other)
        self.assertFalse(other.user_id)

    def test_an_open_opportunity_with_the_phone_is_linked_not_duplicated(self):
        existing = self.make_lead(self.rep, phone=PHONE)
        conversation = self.receive().conversation_id
        self.assertEqual(conversation.lead_id, existing)
        self.assertEqual(self.leads(), existing)

    def test_a_closed_opportunity_with_the_phone_gets_a_new_one(self):
        lost = self.make_lead(self.rep, phone=PHONE)
        lost.action_set_lost()
        lead = self.receive().conversation_id.lead_id
        self.assertTrue(lead)
        self.assertNotEqual(lead, lost)
        self.assertEqual(len(self.leads()), 2)

    def test_only_the_first_message_of_a_conversation_creates(self):
        first = self.receive('wamid.FIRST1').conversation_id
        first.lead_id.unlink()
        self.assertFalse(first.lead_id)
        again = self.receive('wamid.FIRST2')
        self.assertEqual(again.conversation_id, first)
        self.assertFalse(first.lead_id)
        self.assertFalse(self.leads())

    def test_a_different_customer_on_the_open_opportunity_is_not_linked(self):
        service = self.env['liwan.customers.service']
        first = service._liwan_create({'name': 'First customer', 'phone': '+966501110031'})
        second = service._liwan_create({'name': 'Second customer', 'phone': '+966501110032'})
        existing = self.make_lead(self.rep)
        existing.partner_id = second
        existing.phone = PHONE
        self.assertEqual(existing.phone_sanitized, PHONE)
        self.env['liwan.inbox.contact.identity'].create({
            'contact_id': self.env['liwan.inbox.contact'].create({
                'name': 'Sara', 'phone': PHONE, 'company_id': self.env.company.id, 'partner_id': first.id,
            }).id,
            'channel_kind': 'whatsapp', 'address': WA_ID, 'company_id': self.env.company.id,
        })
        conversation = self.receive().conversation_id
        self.assertFalse(conversation.lead_id)
        self.assertEqual(self.leads(), existing)

    def test_the_contact_customer_goes_on_the_new_opportunity(self):
        customer = self.env['liwan.customers.service']._liwan_create({'name': 'Known customer', 'phone': PHONE})
        self.env['liwan.inbox.contact.identity'].create({
            'contact_id': self.env['liwan.inbox.contact'].create({
                'name': 'Sara', 'phone': PHONE, 'company_id': self.env.company.id, 'partner_id': customer.id,
            }).id,
            'channel_kind': 'whatsapp', 'address': WA_ID, 'company_id': self.env.company.id,
        })
        self.assertEqual(self.receive().conversation_id.lead_id.partner_id, customer)

    def test_an_error_creating_the_opportunity_never_loses_the_message(self):
        with patch(
            'odoo.addons.liwan_crm.models.intake.LiwanCrmIntake._liwan_create_unique', side_effect=ValidationError(PHONE),
        ), self.assertLogs('odoo.addons.liwan_crm_inbox.models.conversation_lead', 'WARNING') as logs:
            message = self.receive('wamid.BOOM1')
        self.assertEqual(message.direction, 'in')
        self.assertTrue(message.conversation_id)
        self.assertFalse(message.conversation_id.lead_id)
        self.assertFalse(self.leads())
        self.assertNotIn(PHONE, '\n'.join(logs.output))
        self.assertNotIn('Sara', '\n'.join(logs.output))

    def test_a_closed_crm_feature_creates_nothing(self):
        set_probe_feature(self, key='crm.enabled', enabled=False)
        message = self.receive('wamid.OFF1')
        self.assertTrue(message)
        self.assertFalse(message.conversation_id.lead_id)
        set_probe_feature(self, key='crm.enabled', enabled=True)

    def test_a_tiktok_conversation_takes_the_tiktok_source(self):
        conversation = self.make_conversation(channel=self.make_tiktok_channel())
        self.assertEqual(
            conversation._liwan_opportunity_details()['source_id'], self.env.ref('liwan_crm_inbox.source_tiktok').id,
        )

    def test_a_channel_kind_without_a_source_gives_the_opportunity_no_source(self):
        conversation = self.make_conversation()
        with patch.dict('odoo.addons.liwan_crm_inbox.models.conversation_lead.CHANNEL_SOURCES', clear=True):
            self.assertNotIn('source_id', conversation._liwan_opportunity_details())

    def test_an_unexpected_error_is_logged_with_its_traceback_and_keeps_the_message(self):
        with patch(
            'odoo.addons.liwan_crm.models.intake.LiwanCrmIntake._liwan_create_unique', side_effect=RuntimeError(PHONE),
        ), self.assertLogs('odoo.addons.liwan_crm_inbox.models.conversation_lead', 'ERROR') as logs:
            message = self.receive('wamid.BOOM2')
        self.assertTrue(message.conversation_id)
        self.assertFalse(message.conversation_id.lead_id)
        self.assertEqual(len(logs.records), 1)
        self.assertNotIn(PHONE, logs.records[0].getMessage())

    def test_the_setting_reads_and_writes_through_the_route(self):
        self.channel.crm_opportunity_mode = 'manual'
        self.as_user(self.admin)
        path = SETTINGS.format(self.channel.id)
        shown = self.api('GET', path)
        self.assertEqual((shown.status_code, shown.json()), (200, {'channel_id': self.channel.id, 'opportunity_mode': 'manual'}))
        changed = self.api('PATCH', path, {'opportunity_mode': 'auto_first_message'})
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual(set(changed.json()), SETTINGS_KEYS)
        self.assertEqual(self.channel.crm_opportunity_mode, 'auto_first_message')
        self.assertEqual(self.api('GET', path).json()['opportunity_mode'], 'auto_first_message')
        self.assertEqual(self.api('PATCH', path, {'opportunity_mode': 'manual'}).json()['opportunity_mode'], 'manual')

    def test_the_body_is_checked(self):
        self.as_user(self.admin)
        path = SETTINGS.format(self.channel.id)
        for body, field in (({}, 'opportunity_mode'), ({'opportunity_mode': 'sometimes'}, 'opportunity_mode'),
                            ({'opportunity_mode': None}, 'opportunity_mode'), ({'opportunity_mode': 'manual', 'name': 'x'}, 'name'),
                            ({'name': 'x'}, 'name')):
            response = self.api('PATCH', path, body)
            self.assertEqual(response.status_code, 422, (body, response.text))
            self.assertEqual(response.json().get('field'), field, body)
        self.assertEqual(self.channel.crm_opportunity_mode, 'auto_first_message')

    def test_both_capabilities_are_needed(self):
        path = SETTINGS.format(self.channel.id)
        for login, keys in (('crm_mode_only_inbox', ['inbox.channels.manage']), ('crm_mode_only_crm', CRM_MANAGER),
                            ('crm_mode_reader', ['inbox.channels.manage', 'crm.settings.read'])):
            with self.subTest(login=login):
                self.as_user(self.both_user(login, keys))
                for method in ('GET', 'PATCH'):
                    response = self.api(method, path, {'opportunity_mode': 'manual'} if method == 'PATCH' else None)
                    self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'), (login, method))
        self.as_user(self.outsider)
        self.assertEqual(self.api('GET', path).status_code, 403)
        self.assertEqual(self.channel.crm_opportunity_mode, 'auto_first_message')

    def test_each_closed_feature_refuses_both_routes(self):
        path = SETTINGS.format(self.channel.id)
        for key in ('crm.enabled', 'inbox.enabled'):
            with self.subTest(feature=key):
                set_probe_feature(self, key=key, enabled=False)
                self.as_user(self.admin)
                for method in ('GET', 'PATCH'):
                    response = self.api(method, path, {'opportunity_mode': 'manual'} if method == 'PATCH' else None)
                    self.assertEqual((response.status_code, response.json()['code']), (403, 'feature_not_included'), (key, method))
                set_probe_feature(self, key=key, enabled=True)
        self.assertEqual(self.as_user(self.admin).api('GET', path).status_code, 200)

    def test_a_channel_of_another_company_is_not_found(self):
        other = self.env['res.company'].create({'name': 'Other mode company'})
        foreign = self.make_channel(phone_id='100000000088', business_account_id='200000000088', owner_company_id=other.id)
        self.as_user(self.admin)
        hidden = self.api('GET', SETTINGS.format(foreign.id))
        missing = self.api('GET', SETTINGS.format(999999999))
        self.assertEqual((hidden.status_code, hidden.content), (404, missing.content))
        self.assertEqual(self.api('PATCH', SETTINGS.format(foreign.id), {'opportunity_mode': 'auto_first_message'}).status_code, 404)
        self.assertEqual(foreign.crm_opportunity_mode, 'manual')
