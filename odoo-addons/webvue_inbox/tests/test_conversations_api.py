# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from .common import MESSAGE_KEYS, TEMPLATE_KEYS, WebVueInboxCase
from odoo.addons.webvue_api.tests.common import set_probe_feature

CONVERSATION_KEYS = {
    'id', 'contact', 'channel', 'department', 'assignee', 'state', 'priority', 'tags', 'last_message_at',
    'last_message_preview', 'unread', 'reply_window_ends_at',
}


@tagged('post_install', '-at_install', 'webvue')
class TestConversationsApi(WebVueInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.settings.visibility_policy = 'all'
        cls.conversation = cls.make_conversation(unread=True)
        cls.template = cls.env['webvue.inbox.template'].create({
            'channel_id': cls.channel.id, 'name': 'order_ready', 'language': 'ar', 'category': 'utility',
            'status': 'approved', 'body': 'Hi {{1}}, order {{2}} is ready',
        })

    def path(self, suffix=''):
        return f'/api/v1/inbox/conversations/{self.conversation.id}{suffix}'

    def test_list_returns_the_whitelisted_shape_and_filters(self):
        self.login(self.agent)
        body = self.get('/api/v1/inbox/conversations').json()
        self.assertGreaterEqual(body['total'], 1)
        item = next(row for row in body['items'] if row['id'] == self.conversation.id)
        self.assertEqual(set(item), CONVERSATION_KEYS)
        self.assertEqual(set(item['contact']), {'id', 'name', 'phone', 'email'})
        self.assertEqual(item['last_message_preview'], self.conversation.last_message_preview)
        closed = self.get('/api/v1/inbox/conversations?state=closed').json()
        self.assertNotIn(self.conversation.id, [row['id'] for row in closed['items']])
        by_query = self.get(f'/api/v1/inbox/conversations?q={self.conversation.contact_id.name}').json()
        self.assertEqual([row['id'] for row in by_query['items']], [self.conversation.id])
        self.assertError(self.get('/api/v1/inbox/conversations?state=bogus'), 422, 'invalid')
        self.assertError(self.get('/api/v1/inbox/conversations?limit=-1'), 422, 'invalid')

    def test_assignee_filters(self):
        mine = self.make_conversation(assignee_id=self.agent.id)
        self.login(self.agent)
        ids = lambda query: {r['id'] for r in self.get(f'/api/v1/inbox/conversations?{query}').json()['items']}  # noqa: E731
        self.assertIn(mine.id, ids('assignee=me'))
        self.assertNotIn(self.conversation.id, ids('assignee=me'))
        self.assertIn(self.conversation.id, ids('assignee=unassigned'))
        self.assertEqual(ids(f'assignee={self.agent.id}') & {mine.id}, {mine.id})

    def test_detail_reports_capabilities_and_read_clears_the_flag(self):
        self.login(self.agent)
        body = self.get(self.path()).json()
        self.assertEqual(set(body), CONVERSATION_KEYS | {'can_reply', 'can_assign'})
        self.assertEqual((body['can_reply'], body['can_assign']), (True, False))
        self.assertTrue(self.reload(self.conversation).unread, 'opening a conversation is a pure read')
        self.assertEqual(self.api('POST', self.path('/read')).status_code, 204)
        self.assertFalse(self.reload(self.conversation).unread)
        self.login(self.supervisor)
        self.assertTrue(self.get(self.path()).json()['can_assign'])

    def test_unknown_and_other_company_conversations_are_not_found(self):
        other = self.env['res.company'].create({'name': 'Other inbox company'})
        foreign_channel = self.make_channel(phone_id='100000000099', owner_company_id=other.id)
        foreign = self.make_conversation(channel=foreign_channel)
        self.login(self.manager)
        self.assertError(self.get('/api/v1/inbox/conversations/999999999'), 404, 'not_found')
        self.assertError(self.get(f'/api/v1/inbox/conversations/{foreign.id}'), 404, 'not_found')
        listed = {r['id'] for r in self.get('/api/v1/inbox/conversations').json()['items']}
        self.assertNotIn(foreign.id, listed)

    def test_no_capability_and_closed_feature_are_403(self):
        self.login(self.outsider)
        self.assertError(self.get('/api/v1/inbox/conversations'), 403, 'forbidden')
        self.login(self.agent)
        set_probe_feature(self, key='inbox.enabled', enabled=False)
        self.assertEqual(self.get('/api/v1/inbox/conversations').status_code, 403)

    def test_patch_by_capability(self):
        tag = self.env['webvue.inbox.tag'].create({'name': 'VIP'})
        self.login(self.agent)
        result = self.api('PATCH', self.path(), {'state': 'pending', 'priority': 'high', 'tag_ids': [tag.id]})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual((result.json()['state'], result.json()['priority']), ('pending', 'high'))
        self.assertEqual(result.json()['tags'], [{'id': tag.id, 'name': 'VIP'}])
        self.assertError(self.api('PATCH', self.path(), {'assignee_id': self.agent.id}), 403, 'forbidden')
        self.assertError(self.api('PATCH', self.path(), {'state': 'nope'}), 422, 'invalid')
        self.assertError(self.api('PATCH', self.path(), {'tag_ids': [999999]}), 422, 'invalid')
        self.assertError(self.api('PATCH', self.path(), {'bogus': 1}), 422, 'invalid')
        self.assertError(self.api('PATCH', self.path(), {}), 422, 'invalid')

    def test_assignment_needs_an_agent_and_sends_one_bell_row(self):
        self.login(self.supervisor)
        self.assertError(self.api('PATCH', self.path(), {'assignee_id': self.outsider.id}), 422, 'invalid')
        result = self.api('PATCH', self.path(), {'assignee_id': self.agent.id, 'department_id': self.department.id})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['assignee']['id'], self.agent.id)
        self.assertEqual(result.json()['department']['id'], self.department.id)
        bell = self.env['mail.message'].search([
            ('webvue_notification_kind', '=', 'inbox.assigned'), ('webvue_inbox_conversation_id', '=', self.conversation.id),
        ])
        self.assertEqual(bell.partner_ids, self.agent.partner_id)
        self.login(self.agent)
        rows = self.get('/api/v1/notifications').json()['items']
        self.assertEqual([r['conversation_id'] for r in rows if r['kind'] == 'inbox.assigned'], [self.conversation.id])
        self.login(self.supervisor)
        self.api('PATCH', self.path(), {'assignee_id': self.supervisor.id})
        self.assertEqual(self.env['mail.message'].search_count([('webvue_notification_kind', '=', 'inbox.assigned')]), 1)
        self.assertError(self.api('PATCH', self.path(), {'department_id': 999999}), 422, 'invalid')

    def test_messages_are_chronological_and_paged_from_the_newest(self):
        for index in range(3):
            self.env['webvue.inbox.message'].create({
                'conversation_id': self.conversation.id, 'direction': 'note', 'body': f'note {index}',
                'delivery_state': 'sent', 'date': fields.Datetime.now() + timedelta(seconds=index + 1),
            })
        self.login(self.agent)
        everything = self.get(self.path('/messages')).json()
        self.assertEqual(everything['total'], 4)
        self.assertEqual(set(everything['items'][0]), MESSAGE_KEYS)
        self.assertEqual([m['body'] for m in everything['items']][1:], ['note 0', 'note 1', 'note 2'])
        newest_two = self.get(self.path('/messages?limit=2')).json()
        self.assertEqual([m['body'] for m in newest_two['items']], ['note 1', 'note 2'])
        older = self.get(self.path('/messages?limit=2&offset=2')).json()
        self.assertEqual([m['body'] for m in older['items']], [self.conversation.message_ids[0].body, 'note 0'])
        self.assertError(self.get(self.path('/messages?limit=0')), 422, 'invalid')

    def test_free_text_reply_is_queued_inside_the_window(self):
        self.login(self.agent)
        result = self.api('POST', self.path('/messages'), {'body': 'We are on it'})
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual((body['direction'], body['delivery_state'], body['author']['id']), ('out', 'queued', self.agent.id))
        message = self.env['webvue.inbox.message'].browse(body['id'])
        self.assertTrue(message.next_attempt_at)

    def test_free_text_after_the_window_is_422_and_a_template_works(self):
        late = self.make_conversation(minutes_ago=25 * 60)
        self.login(self.agent)
        path = f'/api/v1/inbox/conversations/{late.id}/messages'
        self.assertError(self.api('POST', path, {'body': 'Too late'}), 422, 'invalid')
        result = self.api('POST', path, {'template_id': self.template.id, 'params': ['Sara', '42']})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['body'], 'Hi Sara, order 42 is ready')
        self.assertEqual(result.json()['template']['name'], 'order_ready')

    def test_template_rules(self):
        self.login(self.agent)
        path = self.path('/messages')
        self.assertError(self.api('POST', path, {'template_id': self.template.id, 'params': ['only one']}), 422, 'invalid')
        self.template.status = 'pending'
        self.assertError(self.api('POST', path, {'template_id': self.template.id, 'params': ['a', 'b']}), 422, 'invalid')
        self.template.status = 'approved'
        other_channel = self.make_channel(phone_id='100000000055')
        foreign = self.env['webvue.inbox.template'].create({
            'channel_id': other_channel.id, 'name': 'x', 'language': 'ar', 'status': 'approved', 'body': 'x',
        })
        self.assertError(self.api('POST', path, {'template_id': foreign.id, 'params': []}), 422, 'invalid')
        self.assertError(self.api('POST', path, {'body': 'a', 'params': []}), 422, 'invalid')
        self.assertError(self.api('POST', path, {'body': ''}), 422, 'invalid')

    def test_reply_note_and_retry_need_the_reply_capability(self):
        self.login(self.outsider)
        self.assertError(self.api('POST', self.path('/messages'), {'body': 'x'}), 403, 'forbidden')
        self.assertError(self.api('POST', self.path('/notes'), {'body': 'x'}), 403, 'forbidden')
        self.assertError(self.api('PATCH', self.path(), {'state': 'pending'}), 403, 'forbidden')

    def test_closed_conversation_refuses_a_reply(self):
        closed = self.make_conversation(state='closed')
        self.login(self.agent)
        self.assertError(self.api('POST', f'/api/v1/inbox/conversations/{closed.id}/messages', {'body': 'x'}), 422, 'invalid')

    def test_note_and_retry(self):
        self.login(self.agent)
        note = self.api('POST', self.path('/notes'), {'body': 'internal'})
        self.assertEqual((note.status_code, note.json()['direction']), (200, 'note'))
        self.assertError(self.api('POST', self.path('/notes'), {'body': ''}), 422, 'invalid')
        failed = self.env['webvue.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'out', 'body': 'x', 'delivery_state': 'failed',
            'attempts': 5, 'error': 'boom',
        })
        retried = self.api('POST', f'/api/v1/inbox/messages/{failed.id}/retry')
        self.assertEqual((retried.status_code, retried.json()['delivery_state'], retried.json()['error']), (200, 'queued', None))
        self.assertError(self.api('POST', f'/api/v1/inbox/messages/{failed.id}/retry'), 422, 'invalid')
        self.assertError(self.api('POST', '/api/v1/inbox/messages/999999999/retry'), 404, 'not_found')

    def test_contact_read_and_patch(self):
        contact = self.conversation.contact_id
        self.login(self.agent)
        self.assertEqual(self.get(f'/api/v1/inbox/contacts/{contact.id}').json()['name'], contact.name)
        result = self.api('PATCH', f'/api/v1/inbox/contacts/{contact.id}', {'name': 'Renamed', 'email': 'Sara@Example.com'})
        self.assertEqual((result.status_code, result.json()['name'], result.json()['email']), (200, 'Renamed', 'sara@example.com'))
        self.assertError(self.api('PATCH', f'/api/v1/inbox/contacts/{contact.id}', {'email': 'not-an-email'}), 422, 'invalid')
        self.assertError(self.get('/api/v1/inbox/contacts/999999999'), 404, 'not_found')

    def test_canned_replies_and_templates_lists(self):
        self.env['webvue.inbox.canned.reply'].create({'shortcut': 'hi', 'body': 'Hello!'})
        self.env['webvue.inbox.template'].create({
            'channel_id': self.channel.id, 'name': 'pending_one', 'language': 'ar', 'status': 'pending', 'body': 'x',
        })
        self.login(self.agent)
        canned = self.get('/api/v1/inbox/canned-replies').json()
        self.assertEqual(canned['items'][0], {'id': canned['items'][0]['id'], 'shortcut': 'hi', 'body': 'Hello!'})
        templates = self.get(f'/api/v1/inbox/channels/{self.channel.id}/templates?status=approved').json()
        self.assertEqual([t['name'] for t in templates['items']], ['order_ready'])
        self.assertEqual(set(templates['items'][0]), TEMPLATE_KEYS)
        self.assertError(self.get('/api/v1/inbox/channels/999999999/templates'), 404, 'not_found')

    def test_agents_lists_active_users_who_can_reply(self):
        self.login(self.agent)
        body = self.get('/api/v1/inbox/agents').json()
        names = {row['name'] for row in body['items']}
        self.assertTrue({'inbox_agent', 'inbox_agent2', 'inbox_supervisor', 'inbox_manager'} <= names)
        self.assertNotIn('inbox_outsider', names)
        self.assertEqual(set(body['items'][0]), {'id', 'name'})
        filtered = self.get('/api/v1/inbox/agents?q=SUPERV').json()
        self.assertEqual([row['name'] for row in filtered['items']], ['inbox_supervisor'])
        self.login(self.outsider)
        self.assertError(self.get('/api/v1/inbox/agents'), 403, 'forbidden')
