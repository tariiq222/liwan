# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64

from markupsafe import Markup

from odoo.tests import tagged
from odoo.tests.common import new_test_user

from odoo.addons.nasq_api.tests.common import NasqApiCase
from odoo.addons.nasq_chat.models.chat_service import MAX_LIMIT
from odoo.addons.nasq_chat.serializers.chat import (
    ATTACHMENT_KEYS,
    CONVERSATION_KEYS,
    MEMBER_KEYS,
    MESSAGE_KEYS,
    RECIPIENT_KEYS,
)

PDF = b'%PDF-1.7\nchat fixture\n'


@tagged('post_install', '-at_install', 'nasq')
class TestChat(NasqApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.peer = new_test_user(
            cls.env, login='api_peer', password='api_peer_pass_123',
            name='Peer', groups='nasq_core.group_employee',
        )
        cls.third = new_test_user(
            cls.env, login='api_third', password='api_third_pass_123',
            name='Third', groups='nasq_core.group_employee',
        )

    def _create_direct(self):
        return self.api('POST', '/api/v1/chat/conversations', {
            'user_ids': [self.peer.id],
        })

    def test_direct_delivery_between_two_users(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        created = self._create_direct()
        self.assertEqual(created.status_code, 201)
        conversation = created.json()
        self.assertEqual(set(conversation), set(CONVERSATION_KEYS))
        self.assertEqual(conversation['type'], 'direct')
        self.assertEqual(conversation['name'], 'Peer')

        sent = self.api('POST', f"/api/v1/chat/conversations/{conversation['id']}/messages", {
            'body': 'hello <peer>\nsecond line',
        })
        self.assertEqual(sent.status_code, 201)
        message = sent.json()
        self.assertEqual(set(message), set(MESSAGE_KEYS))
        self.assertEqual(message['body'], 'hello <peer>\nsecond line')
        self.assertEqual(message['author']['id'], self.employee.id)

        listing = self.api('GET', '/api/v1/chat/conversations?filter=all')
        self.assertEqual(listing.status_code, 200)
        body = listing.json()
        self.assertEqual(set(body), {'items', 'total'})
        self.assertGreaterEqual(body['total'], 1)
        self.assertEqual(set(body['items'][0]), set(CONVERSATION_KEYS))

        self.authenticate('api_peer', 'api_peer_pass_123')
        peer_list = self.api('GET', '/api/v1/chat/conversations?filter=unread')
        self.assertEqual(peer_list.status_code, 200)
        self.assertGreaterEqual(peer_list.json()['total'], 1)
        unread_ids = [item['id'] for item in peer_list.json()['items']]
        self.assertIn(conversation['id'], unread_ids)

        messages = self.api('GET', f"/api/v1/chat/conversations/{conversation['id']}/messages")
        self.assertEqual(messages.status_code, 200)
        payload = messages.json()
        self.assertEqual(set(payload), {'items', 'total'})
        self.assertEqual(payload['items'][0]['body'], 'hello <peer>\nsecond line')
        still_unread = self.api('GET', f"/api/v1/chat/conversations/{conversation['id']}")
        self.assertGreater(still_unread.json()['unread_count'], 0)

        marked = self.api('POST', f"/api/v1/chat/conversations/{conversation['id']}/read", {
            'message_id': payload['items'][0]['id'],
        })
        self.assertEqual(marked.status_code, 200)
        self.assertEqual(marked.json()['unread_count'], 0)

    def test_group_requires_two_other_users_and_includes_creator(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        too_few = self.api('POST', '/api/v1/chat/conversations', {
            'user_ids': [self.peer.id],
            'name': 'Skip',
        })
        self.assertEqual(too_few.status_code, 422)
        created = self.api('POST', '/api/v1/chat/conversations', {
            'user_ids': [self.peer.id, self.third.id],
            'name': 'Ops',
        })
        self.assertEqual(created.status_code, 201)
        conversation = created.json()
        self.assertEqual(conversation['type'], 'group')
        self.assertEqual(conversation['name'], 'Ops')
        members = self.api('GET', f"/api/v1/chat/conversations/{conversation['id']}/members")
        self.assertEqual(members.status_code, 200)
        member_ids = {item['id'] for item in members.json()['items']}
        self.assertEqual(set(members.json()['items'][0]), set(MEMBER_KEYS))
        self.assertEqual(member_ids, {self.employee.id, self.peer.id, self.third.id})
        paged = self.api('GET', f"/api/v1/chat/conversations/{conversation['id']}/members?limit=1&offset=1")
        self.assertEqual(paged.status_code, 200)
        self.assertEqual(paged.json()['total'], 3)
        self.assertEqual(len(paged.json()['items']), 1)

    def test_recipients_are_internal_current_company_users(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/chat/recipients?q=Peer')
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(set(body), {'items', 'total'})
        self.assertTrue(body['items'])
        self.assertEqual(set(body['items'][0]), set(RECIPIENT_KEYS))
        self.assertTrue(all(item['id'] != self.employee.id for item in body['items']))

    def test_native_html_is_plain_and_input_is_escaped(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        conversation = self._create_direct().json()
        channel = self.env['discuss.channel'].browse(conversation['id'])
        channel.with_user(self.employee).message_post(
            body=Markup('<p>native <img src="https://evil.example/x.png"/> html</p>'),
            message_type='comment',
            subtype_xmlid='mail.mt_comment',
        )
        messages = self.api('GET', f"/api/v1/chat/conversations/{conversation['id']}/messages").json()
        self.assertTrue(messages['items'])
        self.assertNotIn('<img', messages['items'][-1]['body'])
        self.assertNotIn('evil.example', messages['items'][-1]['body'])
        sent = self.api('POST', f"/api/v1/chat/conversations/{conversation['id']}/messages", {
            'body': '<script>alert(1)</script>',
        })
        self.assertEqual(sent.json()['body'], '<script>alert(1)</script>')

    def test_attachment_upload_lists_and_downloads_for_member(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        conversation = self._create_direct().json()
        sent = self.api('POST', f"/api/v1/chat/conversations/{conversation['id']}/messages", {
            'body': 'file',
            'attachment': {
                'name': 'brief.pdf',
                'mimetype': 'application/pdf',
                'data': base64.b64encode(PDF).decode(),
            },
        })
        self.assertEqual(sent.status_code, 201)
        attachment = sent.json()['attachments'][0]
        self.assertEqual(set(attachment), set(ATTACHMENT_KEYS))
        listing = self.api('GET', f"/api/v1/chat/conversations/{conversation['id']}/attachments")
        self.assertEqual(listing.json()['total'], 1)
        download = self.api('GET', attachment['url'])
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download.content, PDF)

    def test_invalid_upload_does_not_create_a_message(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        conversation = self._create_direct().json()
        before = self.api('GET', f"/api/v1/chat/conversations/{conversation['id']}/messages").json()['total']
        rejected = self.api('POST', f"/api/v1/chat/conversations/{conversation['id']}/messages", {
            'body': 'nope',
            'attachment': {
                'name': 'evil.bin',
                'mimetype': 'application/octet-stream',
                'data': base64.b64encode(b'\x00\x01not-a-real-type').decode(),
            },
        })
        self.assertEqual(rejected.status_code, 422)
        after = self.api('GET', f"/api/v1/chat/conversations/{conversation['id']}/messages").json()['total']
        self.assertEqual(after, before)

    def test_unread_filter_applies_before_paging(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        first = self._create_direct().json()
        second = self.api('POST', '/api/v1/chat/conversations', {
            'user_ids': [self.third.id],
        }).json()
        self.api('POST', f"/api/v1/chat/conversations/{first['id']}/messages", {'body': 'ping'})
        self.authenticate('api_peer', 'api_peer_pass_123')
        unread = self.api('GET', '/api/v1/chat/conversations?filter=unread&limit=1&offset=0')
        self.assertEqual(unread.status_code, 200)
        body = unread.json()
        self.assertEqual(body['total'], 1)
        self.assertEqual(len(body['items']), 1)
        self.assertEqual(body['items'][0]['id'], first['id'])
        self.assertNotEqual(body['items'][0]['id'], second['id'])

    def test_messages_page_by_stable_ids(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        conversation = self._create_direct().json()
        ids = []
        for index in range(3):
            sent = self.api('POST', f"/api/v1/chat/conversations/{conversation['id']}/messages", {
                'body': f'm{index}',
            })
            ids.append(sent.json()['id'])
        older = self.api('GET', f"/api/v1/chat/conversations/{conversation['id']}/messages?before={ids[-1]}&limit=2")
        self.assertEqual([item['id'] for item in older.json()['items']], ids[:2])
        newer = self.api('GET', f"/api/v1/chat/conversations/{conversation['id']}/messages?after={ids[0]}&limit=10")
        self.assertEqual([item['id'] for item in newer.json()['items']], ids[1:])
        both = self.api('GET', f"/api/v1/chat/conversations/{conversation['id']}/messages?before={ids[-1]}&after={ids[0]}")
        self.assertEqual(both.status_code, 422)

    def test_after_cursor_returns_every_new_message_in_batches(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        conversation = self._create_direct().json()
        channel = self.env['discuss.channel'].browse(conversation['id']).with_user(self.employee)
        cursor = channel.message_post(
            body='cursor', message_type='comment', subtype_xmlid='mail.mt_comment',
        )
        expected_ids = []
        for index in range(MAX_LIMIT * 2 + 7):
            message = channel.message_post(
                body=f'batch-{index}', message_type='comment', subtype_xmlid='mail.mt_comment',
            )
            expected_ids.append(message.id)

        path = f"/api/v1/chat/conversations/{conversation['id']}/messages"
        latest = self.api('GET', f'{path}?limit=3').json()
        self.assertEqual([item['id'] for item in latest['items']], expected_ids[-3:])
        older = self.api('GET', f'{path}?before={expected_ids[-1]}&limit=3').json()
        self.assertEqual([item['id'] for item in older['items']], expected_ids[-4:-1])

        first = self.api('GET', f'{path}?after={cursor.id}&limit={MAX_LIMIT}')
        self.assertEqual(first.status_code, 200)
        first_ids = [item['id'] for item in first.json()['items']]
        self.assertEqual(first_ids, expected_ids[:MAX_LIMIT])
        second = self.api('GET', f'{path}?after={first_ids[-1]}&limit={MAX_LIMIT}')
        self.assertEqual(second.status_code, 200)
        second_ids = [item['id'] for item in second.json()['items']]
        self.assertEqual(second_ids, expected_ids[MAX_LIMIT:MAX_LIMIT * 2])
        third = self.api('GET', f'{path}?after={second_ids[-1]}&limit={MAX_LIMIT}')
        self.assertEqual(third.status_code, 200)
        third_ids = [item['id'] for item in third.json()['items']]
        self.assertEqual(third_ids, expected_ids[MAX_LIMIT * 2:])
        collected = first_ids + second_ids + third_ids
        self.assertEqual(collected, expected_ids)
        self.assertEqual(len(collected), len(set(collected)))
