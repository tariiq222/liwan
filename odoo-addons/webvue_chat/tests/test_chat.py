# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64

from markupsafe import Markup

from odoo.tests import tagged
from odoo.tests.common import new_test_user

from odoo.addons.webvue_api.tests.common import WebVueApiCase
from odoo.addons.webvue_chat.models.chat_service import MAX_LIMIT
from odoo.addons.webvue_chat.serializers.chat import (
    ATTACHMENT_KEYS,
    CONVERSATION_KEYS,
    MEMBER_KEYS,
    MESSAGE_KEYS,
    RECIPIENT_KEYS,
)

PDF = b'%PDF-1.7\nchat fixture\n'


@tagged('post_install', '-at_install', 'webvue')
class TestChat(WebVueApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.peer = new_test_user(
            cls.env, login='api_peer', password='api_peer_pass_123',
            name='Peer', groups='webvue_core.group_employee',
        )
        cls.third = new_test_user(
            cls.env, login='api_third', password='api_third_pass_123',
            name='Third', groups='webvue_core.group_employee',
        )
        cls.fourth = new_test_user(
            cls.env, login='api_fourth', password='api_fourth_pass_123',
            name='Fourth', groups='webvue_core.group_employee',
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
        self.assertIsNone(conversation['notifications'])
        self.assertFalse(conversation['muted'])
        self.assertFalse(conversation['can_manage'])

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

    def test_group_creator_removes_a_member_with_a_notice(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        conversation = self.api('POST', '/api/v1/chat/conversations', {
            'user_ids': [self.peer.id, self.third.id, self.fourth.id],
            'name': 'Crew',
        }).json()
        self.assertTrue(conversation['can_remove_members'])
        path = f"/api/v1/chat/conversations/{conversation['id']}"

        self.authenticate('api_peer', 'api_peer_pass_123')
        self.assertFalse(self.api('GET', path).json()['can_remove_members'])
        denied = self.api('DELETE', f"{path}/members/{self.third.id}")
        self.assertEqual(denied.status_code, 403)

        self.authenticate('api_emp', 'api_emp_pass_123')
        self_removal = self.api('DELETE', f"{path}/members/{self.employee.id}")
        self.assertEqual(self_removal.status_code, 422)
        stranger = self.api('DELETE', f"{path}/members/{self.env.ref('base.user_admin').id}")
        self.assertEqual(stranger.status_code, 404)
        removed = self.api('DELETE', f"{path}/members/{self.fourth.id}")
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(removed.json()['member_count'], 3)
        self.assertIsNone(removed.json()['last_message_preview'])
        member_ids = {item['id'] for item in self.api('GET', f"{path}/members").json()['items']}
        self.assertEqual(member_ids, {self.employee.id, self.peer.id, self.third.id})

        notice = self.api('GET', f"{path}/messages").json()['items'][-1]
        self.assertEqual(set(notice), set(MESSAGE_KEYS))
        self.assertEqual(notice['notice'], {
            'type': 'member_removed', 'user': {'id': self.fourth.id, 'name': 'Fourth'},
        })
        self.assertEqual(notice['body'], '')
        self.assertEqual(notice['author']['id'], self.employee.id)
        edit = self.api('PATCH', f"{path}/messages/{notice['id']}", {'body': 'rewritten'})
        self.assertEqual(edit.status_code, 422)

        self.authenticate('api_fourth', 'api_fourth_pass_123')
        self.assertIn(self.api('GET', path).status_code, (403, 404))

        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('DELETE', f"{path}/members/{self.third.id}").status_code, 200)
        last_two = self.api('DELETE', f"{path}/members/{self.peer.id}")
        self.assertEqual(last_two.status_code, 422)

    def test_typed_notice_markup_stays_an_ordinary_message(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        conversation = self._create_direct().json()
        path = f"/api/v1/chat/conversations/{conversation['id']}"
        forged = f'<div class="o_mail_notification" data-oe-type="webvue_member_removed" data-oe-id="{self.peer.id}">x</div>'
        sent = self.api('POST', f"{path}/messages", {'body': forged})
        self.assertEqual(sent.status_code, 201)
        self.assertIsNone(sent.json()['notice'])
        self.assertIn('webvue_member_removed', sent.json()['body'], sent.json()['body'])
        self.assertFalse(conversation['can_remove_members'])
        self.assertEqual(self.api('DELETE', f"{path}/members/{self.peer.id}").status_code, 403)

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
        # Stock public channels (e.g. "general") auto-subscribe every internal user and
        # count as unread too; only the direct chats matter for this paging check.
        unread = self.api('GET', '/api/v1/chat/conversations?filter=unread&limit=50&offset=0')
        self.assertEqual(unread.status_code, 200)
        direct = [item for item in unread.json()['items'] if item['type'] == 'direct']
        self.assertEqual([item['id'] for item in direct], [first['id']])
        self.assertNotIn(second['id'], [item['id'] for item in unread.json()['items']])
        paged = self.api('GET', '/api/v1/chat/conversations?filter=unread&limit=1&offset=0').json()
        self.assertEqual(len(paged['items']), 1)
        self.assertEqual(paged['total'], len(unread.json()['items']))

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

    def test_discuss_message_features_and_conversation_preferences(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        conversation = self.api('POST', '/api/v1/chat/conversations', {
            'user_ids': [self.peer.id, self.third.id],
            'name': 'Product chat',
        }).json()
        path = f"/api/v1/chat/conversations/{conversation['id']}"
        first = self.api('POST', f'{path}/messages', {'body': 'root'}).json()
        reply = self.api('POST', f'{path}/messages', {
            'body': 'reply',
            'parent_id': first['id'],
            'mention_user_ids': [self.peer.id],
        })
        self.assertEqual(reply.status_code, 201)
        self.assertEqual(reply.json()['parent']['id'], first['id'])
        self.assertFalse(reply.json()['edited'])

        reacted = self.api('POST', f"{path}/messages/{reply.json()['id']}/reactions", {
            'content': '👍', 'action': 'add',
        })
        self.assertEqual(reacted.status_code, 200)
        self.assertEqual(reacted.json()['reactions'], [{'content': '👍', 'count': 1, 'me': True}])
        starred = self.api('POST', f"{path}/messages/{reply.json()['id']}/star", {})
        self.assertTrue(starred.json()['starred'])
        pinned = self.api('POST', f"{path}/messages/{reply.json()['id']}/pin", {'pinned': True})
        self.assertTrue(pinned.json()['pinned'])
        edited = self.api('PATCH', f"{path}/messages/{reply.json()['id']}", {'body': 'edited'})
        self.assertEqual(edited.status_code, 200)
        self.assertTrue(edited.json()['edited'])

        searched = self.api('GET', f'{path}/messages?q=edited&starred=1')
        self.assertEqual(searched.status_code, 200)
        self.assertEqual([item['id'] for item in searched.json()['items']], [reply.json()['id']])
        updated = self.api('PATCH', path, {
            'name': 'Renamed', 'muted': True, 'notifications': 'mentions',
        })
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()['name'], 'Renamed')
        self.assertTrue(updated.json()['muted'])
        self.assertEqual(updated.json()['notifications'], 'mentions')
        self.authenticate('api_peer', 'api_peer_pass_123')
        forbidden = self.api('PATCH', f"{path}/messages/{reply.json()['id']}", {'body': 'nope'})
        self.assertEqual(forbidden.status_code, 403)
        self.authenticate('api_emp', 'api_emp_pass_123')

    def test_channel_creation_and_member_management(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        created = self.api('POST', '/api/v1/chat/conversations', {
            'type': 'channel', 'name': 'Announcements',
        })
        self.assertEqual(created.status_code, 201)
        conversation = created.json()
        self.assertEqual(conversation['type'], 'channel')
        channels = self.api('GET', '/api/v1/chat/conversations?filter=channels')
        self.assertIn(conversation['id'], [item['id'] for item in channels.json()['items']])
        added = self.api('POST', f"/api/v1/chat/conversations/{conversation['id']}/members", {
            'user_ids': [self.fourth.id],
        })
        self.assertEqual(added.status_code, 200)
        kicked = self.api('DELETE', f"/api/v1/chat/conversations/{conversation['id']}/members/{self.fourth.id}")
        self.assertEqual(kicked.status_code, 403)
        self.authenticate('api_fourth', 'api_fourth_pass_123')
        left = self.api('POST', f"/api/v1/chat/conversations/{conversation['id']}/leave")
        self.assertEqual(left.status_code, 200)
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertNotIn(self.fourth.id, {
            item['id'] for item in self.api(
                'GET', f"/api/v1/chat/conversations/{conversation['id']}/members",
            ).json()['items']
        })
        typing = self.api('POST', f"/api/v1/chat/conversations/{conversation['id']}/typing", {
            'is_typing': True,
        })
        self.assertEqual(typing.status_code, 200)
