# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Customer Messages' contribution to the privacy hooks of liwan_customers: contacts, conversations and messages."""
import base64
import io
import json

import openpyxl

from odoo.tests import new_test_user, tagged

from . import whatsapp_payloads as wa
from .common import LiwanInboxCase
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_customers.models import privacy_hooks
from odoo.addons.liwan_inbox.models import privacy_hooks as inbox_hooks
from odoo.addons.liwan_inbox.serializers.conversation import dump_messages

WA_ID = '966501110001'
NAME = 'Sara Alqahtani'
PHONE = '+966501110001'
BODY = 'My address is Olaya street building 4'


@tagged('post_install', '-at_install', 'liwan')
class TestInboxPrivacy(LiwanInboxCase):
    """The privacy service is called as a user who holds the system administrator and the inbox manager roles."""

    @classmethod
    def _admin(cls, login, roles):
        user = new_test_user(cls.env, login=login, password=f'{login}_pass_123', name=login, groups='liwan_core.group_employee')
        cls.env['liwan.access.service']._liwan_replace_assignments(user, [
            {'role_id': cls.env.ref(role).id, 'company_id': cls.env.company.id} for role in roles
        ])
        return user

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = cls._admin('inbox_privacy_admin', ['liwan_core.role_system_admin', 'liwan_inbox.role_inbox_manager'])
        cls.customer = cls.env['liwan.customers.service']._liwan_create({'name': NAME, 'phone': PHONE, 'email': 'sara@example.test'})

    def setUp(self):
        super().setUp()
        self.deliver('wamid.PRIV1', BODY)
        self.identity = self.env['liwan.inbox.contact.identity'].search([('address', '=', WA_ID)])
        self.contact = self.identity.contact_id
        self.contact.write({'partner_id': self.customer.id, 'email': 'sara@example.test'})
        self.conversation = self.env['liwan.inbox.conversation'].search([('contact_id', '=', self.contact.id)])
        self.inbound = self.env['liwan.inbox.message'].search([('provider_message_id', '=', 'wamid.PRIV1')])
        self.queued = self.env['liwan.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'out', 'body': 'Hello Sara', 'delivery_state': 'queued',
            'template_params': ['Sara'],
        })
        self.media = self.env['ir.attachment'].create({
            'name': 'id-card.jpg', 'raw': b'jpeg-bytes', 'mimetype': 'image/jpeg', 'res_model': 'liwan.inbox.message',
            'res_id': self.inbound.id,
        })
        submission = self.env['liwan.inbox.flow.submission'].create({
            'conversation_id': self.conversation.id, 'message_id': self.inbound.id, 'submitted_at': self.inbound.date,
            'answer_ids': [(0, 0, {'key': 'full_name', 'label': 'Name', 'kind': 'unknown', 'value_text': NAME})],
        })
        self.answer = submission.answer_ids

    def deliver(self, provider_id, body):
        self.store_event(self.channel, wa.inbound_text(provider_id, wa_id=WA_ID, body=body, name=NAME))
        self.env['liwan.inbox.event']._liwan_run_events()

    @property
    def service(self):
        return self.env['liwan.customers.privacy.service'].with_user(self.admin)

    def items(self):
        return {item['key']: item for item in self.service._liwan_erase_preview(self.customer.id)['items']}

    def erase(self):
        token = self.service._liwan_erase_preview(self.customer.id)['token']
        return self.service._liwan_erase(self.customer.id, token, NAME, 'Request')

    def test_the_preview_counts_what_the_customer_has_in_customer_messages(self):
        items = self.items()
        expected = {
            inbox_hooks.CONTACT_KEY: ('erase', 1), inbox_hooks.CONVERSATION_KEY: ('retain', 1),
            inbox_hooks.MESSAGE_KEY: ('erase', 2), inbox_hooks.ATTACHMENT_KEY: ('erase', 1),
            inbox_hooks.ANSWER_KEY: ('erase', 1), inbox_hooks.CONSENT_KEY: ('retain', 0),
            inbox_hooks.RECIPIENT_KEY: ('erase', 0),
        }
        self.assertEqual({key: (items[key]['action'], items[key]['count']) for key in expected}, expected)
        self.assertTrue(all(items[key]['complete'] and items[key]['owner'] == 'liwan_inbox' for key in expected))
        self.assertIn('inbox_provider_events', self.service._liwan_erase_preview(self.customer.id)['not_covered'])

    def test_the_export_has_the_contact_and_messages_sheets(self):
        content, _filename, _logged = self.service._liwan_export(self.customer.id, 'Access request')
        workbook = openpyxl.load_workbook(io.BytesIO(content))
        contacts = list(workbook['Messaging contacts'].values)
        self.assertEqual((contacts[1][2], contacts[1][3]), (NAME, PHONE))
        messages = list(workbook['Messages'].values)
        self.assertEqual(messages[0], ('id', 'conversation_id', 'contact_id', 'date', 'direction', 'kind', 'text', 'delivery_state'))
        self.assertEqual({row[6] for row in messages[1:]}, {BODY, 'Hello Sara'})

    def test_an_erase_clears_the_contact_and_the_message_content_and_keeps_the_structure(self):
        date, state = self.inbound.date, self.inbound.delivery_state
        messages = self.env['mail.message'].search_count([('model', 'like', 'liwan.inbox%')])
        self.erase()
        self.env.invalidate_all()
        contact = self.contact
        self.assertEqual((contact.name, contact.phone, contact.email), (inbox_hooks.ERASED_CONTACT % contact.id, False, False))
        self.assertEqual(contact.partner_id, self.customer)
        self.assertEqual(self.identity.address, inbox_hooks.ERASED_ADDRESS % self.identity.id)
        for message in (self.inbound, self.queued):
            self.assertEqual(message.body, inbox_hooks.ERASED_MESSAGE)
        self.assertFalse(self.queued.template_params)
        self.assertEqual((self.inbound.date, self.inbound.direction, self.inbound.delivery_state, self.inbound.provider_message_id),
                         (date, 'in', state, 'wamid.PRIV1'))
        self.assertEqual(self.queued.delivery_state, 'failed')
        self.assertFalse(self.media.exists())
        self.assertFalse(self.answer.value_text)
        self.assertEqual((self.conversation.state, self.conversation.channel_id, self.conversation.contact_id),
                         ('closed', self.channel, contact))
        self.assertEqual(self.conversation.last_message_preview, inbox_hooks.ERASED_MESSAGE)
        self.assertEqual(self.env['mail.message'].search_count([('model', 'like', 'liwan.inbox%')]), messages)
        self.assertEqual(self.customer.with_context(active_test=False).name, privacy_hooks.ERASED_NAME % self.customer.id)

    def test_an_erase_removes_the_template_button_values_and_the_interactive_options_from_the_thread(self):
        interactive = self.env['liwan.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'out', 'kind': 'interactive', 'delivery_state': 'sent',
            'body': 'Pick a time', 'interactive_type': 'list', 'interactive_button': 'Times',
            'option_ids': [(0, 0, {'option_id': 'a', 'title': 'Tuesday at the Olaya branch', 'description': 'Sara Alqahtani only'})],
        })
        template = self.env['liwan.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'out', 'kind': 'template', 'delivery_state': 'sent',
            'body': 'Your code', 'template_name': 'otp',
            'template_button_ids': [(0, 0, {'position': 0, 'kind': 'copy_code', 'text': 'Copy', 'value': 'CODE-4821'})],
        })
        before = dump_messages(interactive | template)
        self.assertEqual(before[0]['interactive']['sections'][0]['rows'][0]['title'], 'Tuesday at the Olaya branch')
        self.assertEqual(before[1]['template']['buttons'][0]['text'], 'CODE-4821')
        self.erase()
        self.env.invalidate_all()
        after = dump_messages(interactive | template)
        self.assertEqual(after[0]['interactive']['sections'], [])
        self.assertEqual(after[1]['template']['buttons'], [])
        self.assertFalse(interactive.option_ids)
        self.assertFalse(template.template_button_ids)
        self.assertNotIn('Olaya', json.dumps(after))
        self.assertNotIn('CODE-4821', json.dumps(after))

    def test_the_same_person_writing_again_gets_a_new_contact_and_the_erased_data_is_not_restored(self):
        self.erase()
        self.deliver('wamid.PRIV2', 'Hello again')
        fresh = self.env['liwan.inbox.contact.identity'].search([('address', '=', WA_ID)]).contact_id
        self.assertNotEqual(fresh, self.contact)
        self.assertEqual((fresh.name, fresh.partner_id), (NAME, self.env['res.partner']))
        self.env.invalidate_all()
        self.assertEqual(self.contact.name, inbox_hooks.ERASED_CONTACT % self.contact.id)
        self.assertEqual(self.env['liwan.inbox.message'].search([('provider_message_id', '=', 'wamid.PRIV2')]).conversation_id.state, 'open')

    def test_a_caller_without_inbox_reach_is_refused_and_nothing_is_written(self):
        plain = self._admin('inbox_privacy_plain', ['liwan_core.role_system_admin'])
        service = self.env['liwan.customers.privacy.service'].with_user(plain)
        by_key = {item['key']: item for item in service._liwan_erase_preview(self.customer.id)['items']}
        self.assertEqual((by_key[inbox_hooks.MESSAGE_KEY]['complete'], by_key[inbox_hooks.MESSAGE_KEY]['count']), (False, 0))
        token = service._liwan_erase_preview(self.customer.id)['token']
        with self.assertRaises(LiwanAccessRule) as caught:
            service._liwan_erase(self.customer.id, token, NAME, 'Request')
        self.assertEqual((caught.exception.status, caught.exception.code), (409, 'erase_incomplete'))
        self.env.invalidate_all()
        self.assertEqual((self.contact.name, self.inbound.body), (NAME, BODY))

    def test_a_caller_with_part_of_the_reach_is_refused_before_anything_is_written(self):
        agent = self._admin('inbox_privacy_agent', ['liwan_core.role_system_admin', 'liwan_inbox.role_inbox_agent'])
        service = self.env['liwan.customers.privacy.service'].with_user(agent)
        token = service._liwan_erase_preview(self.customer.id)['token']
        with self.assertRaises(LiwanAccessRule) as caught:
            service._liwan_erase(self.customer.id, token, NAME, 'Request')
        self.assertEqual((caught.exception.status, caught.exception.code), (409, 'erase_incomplete'))
        self.env.invalidate_all()
        self.assertEqual((self.customer.name, self.contact.name, self.inbound.body), (NAME, NAME, BODY))
        self.assertTrue(base64.b64decode(self.media.datas))
