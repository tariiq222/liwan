# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import os
from datetime import timedelta
from unittest.mock import MagicMock, patch

import requests

from odoo import Command, fields
from odoo.tests import new_test_user

from odoo.addons.webvue_api.tests.common import WebVueApiCase
from odoo.addons.webvue_inbox.models.secret_box import KEY_ENV

PASSWORD = 'inbox_pass_123'
PHONE_ID = '100000000001'
BUSINESS_ACCOUNT_ID = '200000000001'
ACCESS_TOKEN = 'EAAB-access-token-0123456789'
APP_SECRET = 'app-secret-0123456789abcdef'
# Every key of InboxMessageSchema (packages/contracts/src/inbox/index.ts).
MESSAGE_KEYS = {
    'id', 'direction', 'kind', 'body', 'author', 'template', 'delivery_state', 'error', 'attachments', 'reply_to',
    'reactions', 'location', 'interactive', 'commerce', 'selected_option', 'flow_response', 'automated', 'created_at',
}


# Every key of InboxTemplateSchema.
TEMPLATE_KEYS = {
    'id', 'name', 'language', 'category', 'status', 'status_reason', 'quality', 'header', 'body', 'body_examples', 'footer',
    'buttons', 'add_security_recommendation', 'code_expiration_minutes', 'otp_button_text', 'param_count', 'editable',
    'supported',
}


class WebVueInboxCase(WebVueApiCase):
    """Agents, a supervisor and a manager, one department, one channel and a conversation factory."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        key = base64.urlsafe_b64encode(os.urandom(32)).decode()
        env_patch = patch.dict(os.environ, {KEY_ENV: key})
        env_patch.start()
        cls.addClassCleanup(env_patch.stop)
        cls.agent = cls._user('inbox_agent', 'inbox_agent')
        cls.agent2 = cls._user('inbox_agent2', 'inbox_agent')
        cls.supervisor = cls._user('inbox_supervisor', 'inbox_supervisor')
        cls.manager = cls._user('inbox_manager', 'inbox_manager')
        cls.reader_only = cls._capability_user('inbox_reader_only', 'inbox.conversations.read')
        cls.templates_only = cls._capability_user('inbox_templates_only', 'inbox.templates.manage')
        cls.outsider = new_test_user(
            cls.env, login='inbox_outsider', password=PASSWORD, name='No inbox access', groups='base.group_user',
        )
        cls.department = cls.env['webvue.inbox.department'].create({'name': 'Support', 'member_ids': [(6, 0, cls.agent.ids)]})
        cls.other_department = cls.env['webvue.inbox.department'].create({'name': 'Sales'})
        cls.channel = cls.make_channel()
        cls.settings = cls.env['webvue.inbox.settings']._get_for_company()
        cls.counter = 0

    def setUp(self):
        super().setUp()
        # Crons commit after every item; a test transaction must never commit, so the commit is counted instead.
        self.commits = MagicMock(return_value=float('inf'))
        patcher = patch.object(type(self.env['ir.cron']), '_commit_progress', self.commits)
        patcher.start()
        self.addCleanup(patcher.stop)

    @classmethod
    def _user(cls, login, role):
        user = new_test_user(cls.env, login=login, password=PASSWORD, name=login, groups='webvue_core.group_employee')
        cls.env['webvue.access.service']._webvue_replace_assignments(user, [{
            'role_id': cls.env.ref(f'webvue_inbox.role_{role}').id, 'company_id': cls.env.company.id,
        }])
        return user

    @classmethod
    def _capability_user(cls, login, key):
        """An employee whose only inbox grant is the capability `key`, through a custom role."""
        user = new_test_user(cls.env, login=login, password=PASSWORD, name=login, groups='webvue_core.group_employee')
        role = cls.env['webvue.access.role'].create({
            'key': login, 'name_ar': login, 'name_en': login, 'type': 'custom',
            'permission_ids': [Command.set(cls.env['webvue.access.permission'].search([('key', '=', key)]).ids)],
        })
        cls.env['webvue.access.service']._webvue_replace_assignments(user, [{'role_id': role.id, 'company_id': cls.env.company.id}])
        return user

    @classmethod
    def make_channel(cls, phone_id=PHONE_ID, **values):
        Channel = cls.env['webvue.inbox.channel']
        return Channel.create({
            'name': 'Main WhatsApp', 'phone_number_id': phone_id, 'business_account_id': BUSINESS_ACCOUNT_ID,
            'state': 'connected',
            **Channel._webvue_secret_values(access_token=ACCESS_TOKEN, app_secret=APP_SECRET), **values,
        })

    @classmethod
    def make_template(cls, channel=None, **values):
        """An approved template; `button_ids` and `example_ids` are given as plain dicts."""
        cls.counter += 1
        values = {
            'channel_id': (channel or cls.channel).id, 'name': f'template_{cls.counter}', 'language': 'ar',
            'category': 'utility', 'status': 'approved', 'body': 'Hello', 'provider_template_id': f'9{cls.counter:09d}', **values,
        }
        values['button_ids'] = [(0, 0, {'sequence': i, **button}) for i, button in enumerate(values.get('button_ids', ()))]
        values['example_ids'] = [(0, 0, {'position': i, 'example': e}) for i, e in enumerate(values.get('example_ids', ()), start=1)]
        return cls.env['webvue.inbox.template'].create(values)

    @classmethod
    def make_conversation(cls, channel=None, minutes_ago=5, **values):
        """A conversation with one inbound message `minutes_ago` minutes old."""
        cls.counter += 1
        channel = channel or cls.channel
        company = values.pop('company', channel.owner_company_id)
        contact = cls.env['webvue.inbox.contact'].create({
            'name': f'Customer {cls.counter}', 'phone': f'+96650000{cls.counter:04d}', 'company_id': company.id,
        })
        identity = cls.env['webvue.inbox.contact.identity'].create({
            'contact_id': contact.id, 'channel_kind': 'whatsapp', 'address': f'96650000{cls.counter:04d}',
            'company_id': company.id,
        })
        conversation = cls.env['webvue.inbox.conversation'].create({
            'channel_id': channel.id, 'contact_id': contact.id, 'identity_id': identity.id,
            'company_id': company.id, **values,
        })
        cls.env['webvue.inbox.message'].create({
            'conversation_id': conversation.id, 'company_id': company.id, 'direction': 'in',
            'body': f'Hello {cls.counter}', 'delivery_state': 'received',
            'date': fields.Datetime.now() - timedelta(minutes=minutes_ago),
        })
        return conversation

    def run_outbox_offline(self):
        """Run the outbox and prove it called Meta never (a reply that cannot be sent fails before any request)."""
        with patch.object(requests, 'request') as request:
            self.env['webvue.inbox.message']._webvue_run_outbox()
        self.assertEqual(request.call_count, 0)

    def login(self, user):
        self.authenticate(user.login, PASSWORD)

    def get(self, path):
        return self.api('GET', path)

    def assertError(self, response, status, code):
        self.assertEqual((response.status_code, response.json().get('code')), (status, code), response.text)

    def reload(self, *records):
        for record in records:
            record.invalidate_recordset()
        return records[0] if len(records) == 1 else records
