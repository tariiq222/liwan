# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-request company isolation for the Inbox GET record, list, export and attachment routes."""
import base64
import csv
import io
import os
from unittest.mock import patch

from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_api.tests.common import (
    CompanyIsolationCase,
    assert_isolation_discovery,
    cover_isolation_routes,
)
from odoo.addons.webvue_inbox.models.secret_box import KEY_ENV
from odoo.addons.webvue_inbox.tests.common import ACCESS_TOKEN, APP_SECRET

EXPECTED_GET_RECORD_ROUTES = 7
PASSWORD = 'iso_inbox_nocap_pass_123'
# Visible and hidden company tags per session company. iso_user holds the inbox manager role in the parent
# and both branches, so a parent session reads its branches; a branch session never reads the parent or a
# sibling, and the independent company C is hidden from every other session.
MATRIX = (
    ('p', ('p', 'p1', 'p2'), ('c',)),
    ('p1', ('p1',), ('p', 'p2', 'c')),
    ('p2', ('p2',), ('p', 'p1', 'c')),
    ('c', ('c',), ('p', 'p1', 'p2')),
)


@tagged('post_install', '-at_install', 'webvue')
class TestInboxCompanyIsolation(CompanyIsolationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        env_patch = patch.dict(os.environ, {KEY_ENV: base64.urlsafe_b64encode(os.urandom(32)).decode()})
        env_patch.start()
        cls.addClassCleanup(env_patch.stop)
        cls.by_tag = {'p': cls.company_p, 'p1': cls.company_p1, 'p2': cls.company_p2, 'c': cls.company_c}
        Assignment = cls.env['webvue.access.assignment'].sudo()
        manager = cls.env.ref('webvue_inbox.role_inbox_manager')
        for company in cls.by_tag.values():
            Assignment.create({'user_id': cls.iso_user.id, 'role_id': manager.id, 'company_id': company.id})
        cls.no_cap = new_test_user(
            cls.env, login='iso_inbox_nocap', password=PASSWORD, name='No inbox',
            groups='webvue_core.group_employee', company_id=cls.company_p.id,
        )
        cls.no_cap.company_ids = [(6, 0, [cls.company_p.id])]
        Assignment.create({
            'user_id': cls.no_cap.id, 'role_id': cls.env.ref('webvue_core.role_employee').id,
            'company_id': cls.company_p.id,
        })
        Channel = cls.env['webvue.inbox.channel']
        cls.recs = {}
        for i, (tag, company) in enumerate(cls.by_tag.items(), start=1):
            channel = Channel.create({
                'name': f'Channel {tag}', 'phone_number_id': f'90000000{i:04d}', 'business_account_id': '200000000001',
                'state': 'connected', 'owner_company_id': company.id,
                **Channel._webvue_secret_values(access_token=ACCESS_TOKEN, app_secret=APP_SECRET),
            })
            contact = cls.env['webvue.inbox.contact'].create({
                'name': f'Customer {tag.upper()}', 'phone': f'+96650000{i:04d}', 'company_id': company.id,
            })
            identity = cls.env['webvue.inbox.contact.identity'].create({
                'contact_id': contact.id, 'channel_kind': 'whatsapp', 'address': f'96650000{i:04d}',
                'company_id': company.id,
            })
            conversation = cls.env['webvue.inbox.conversation'].create({
                'channel_id': channel.id, 'contact_id': contact.id, 'identity_id': identity.id,
                'company_id': company.id,
            })
            message = cls.env['webvue.inbox.message'].create({
                'conversation_id': conversation.id, 'company_id': company.id, 'direction': 'in',
                'body': f'Hello {tag}', 'delivery_state': 'received',
            })
            attachment = cls.env['ir.attachment'].create({
                'name': f'file-{tag}.txt', 'datas': base64.b64encode(b'x'), 'res_model': message._name,
                'res_id': message.id,
            })
            cls.recs[tag] = {
                'channel': channel, 'contact': contact, 'conversation': conversation, 'message': message,
                'attachment': attachment,
            }

    @staticmethod
    def paths(rec):
        return {
            'channel': f'/api/v1/inbox/channels/{rec["channel"].id}',
            'templates': f'/api/v1/inbox/channels/{rec["channel"].id}/templates',
            'conversation': f'/api/v1/inbox/conversations/{rec["conversation"].id}',
            'messages': f'/api/v1/inbox/conversations/{rec["conversation"].id}/messages',
            'contact': f'/api/v1/inbox/contacts/{rec["contact"].id}',
            'download': f'/api/v1/inbox/messages/{rec["message"].id}/attachments/{rec["attachment"].id}/download',
        }

    def hidden_ids(self, kind, rec):
        return {
            'channel': rec['channel'], 'templates': rec['channel'], 'conversation': rec['conversation'],
            'messages': rec['conversation'], 'contact': rec['contact'], 'download': rec['message'],
        }[kind].id

    def test_record_matrix(self):
        """Visible companies answer 200 on every record route; every other company answers the not-found."""
        for current, visible, hidden in MATRIX:
            self.env_in(self.by_tag[current])
            for tag in visible:
                for kind, path in self.paths(self.recs[tag]).items():
                    with self.subTest(current=current, visible=tag, route=kind):
                        self.assertVisible(path)
            for tag in hidden:
                rec = self.recs[tag]
                for kind, path in self.paths(rec).items():
                    with self.subTest(current=current, hidden=tag, route=kind):
                        self.assertHiddenEveryWay('GET', path, self.hidden_ids(kind, rec))

    def test_lists_never_show_another_company(self):
        for current, visible, hidden in MATRIX:
            self.env_in(self.by_tag[current])
            for path, key in (('/api/v1/inbox/conversations', 'conversation'), ('/api/v1/inbox/channels', 'channel')):
                ids = {item['id'] for item in self.assertVisible(path).json()['items']}
                for tag in visible:
                    self.assertIn(self.recs[tag][key].id, ids, f'{path}: {tag} missing from {current}')
                for tag in hidden:
                    self.assertNotIn(self.recs[tag][key].id, ids, f'{path}: {tag} leaked into {current}')

    def test_export_never_includes_another_company(self):
        for current, visible, hidden in MATRIX:
            self.env_in(self.by_tag[current])
            response = self.assertVisible('/api/v1/inbox/conversations/export.csv')
            text = response.content.decode('utf-8-sig')
            names = {row[0] for row in csv.reader(io.StringIO(text))} | {cell for row in csv.reader(io.StringIO(text)) for cell in row}
            for tag in visible:
                self.assertIn(f'Customer {tag.upper()}', names)
            for tag in hidden:
                self.assertNotIn(f'Customer {tag.upper()}', names, f'{tag} leaked into {current}')

    def test_missing_capability_in_the_same_company_stays_forbidden(self):
        self.authenticate('iso_inbox_nocap', PASSWORD)
        rec = self.recs['p']
        for path in (*self.paths(rec).values(), '/api/v1/inbox/conversations/export.csv'):
            self.assertEqual(self.api('GET', path).status_code, 403, path)

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'webvue_inbox', EXPECTED_GET_RECORD_ROUTES)


cover_isolation_routes((
    '/api/v1/inbox/channels/<int:channel_id>',
    '/api/v1/inbox/channels/<int:channel_id>/templates',
    '/api/v1/inbox/conversations/<int:conversation_id>',
    '/api/v1/inbox/conversations/<int:conversation_id>/messages',
    '/api/v1/inbox/contacts/<int:contact_id>',
    '/api/v1/inbox/messages/<int:message_id>/attachments/<int:attachment_id>/download',
    '/api/v1/inbox/conversations/export.csv',
), source='webvue_inbox/tests/test_company_isolation.py')
