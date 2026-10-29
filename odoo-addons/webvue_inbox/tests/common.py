# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import os
from datetime import timedelta
from unittest.mock import MagicMock, patch

from odoo import Command, fields
from odoo.tests import new_test_user

from odoo.addons.webvue_api.tests.common import WebVueApiCase
from odoo.addons.webvue_inbox.models.secret_box import KEY_ENV

PASSWORD = 'inbox_pass_123'
PHONE_ID = '100000000001'
ACCESS_TOKEN = 'EAAB-access-token-0123456789'
APP_SECRET = 'app-secret-0123456789abcdef'
# Every key of InboxMessageSchema (packages/contracts/src/inbox/index.ts).
MESSAGE_KEYS = {
    'id', 'direction', 'kind', 'body', 'author', 'template_name', 'delivery_state', 'error', 'attachments', 'reply_to',
    'reactions', 'location', 'interactive', 'selected_option', 'created_at',
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
        cls.reader_only = new_test_user(
            cls.env, login='inbox_reader_only', password=PASSWORD, name='inbox_reader_only', groups='webvue_core.group_employee',
        )
        read_only_role = cls.env['webvue.access.role'].create({
            'key': 'inbox_read_only', 'name_ar': 'قراءة فقط', 'name_en': 'Read only', 'type': 'custom',
            'permission_ids': [Command.set(cls.env['webvue.access.permission'].search([('key', '=', 'inbox.conversations.read')]).ids)],
        })
        cls.env['webvue.access.service']._webvue_replace_assignments(
            cls.reader_only, [{'role_id': read_only_role.id, 'company_id': cls.env.company.id}],
        )
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
    def make_channel(cls, phone_id=PHONE_ID, **values):
        Channel = cls.env['webvue.inbox.channel']
        return Channel.create({
            'name': 'Main WhatsApp', 'phone_number_id': phone_id, 'business_account_id': '200000000001',
            'state': 'connected',
            **Channel._webvue_secret_values(access_token=ACCESS_TOKEN, app_secret=APP_SECRET), **values,
        })

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
