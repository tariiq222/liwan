# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import Command, fields
from odoo.exceptions import ValidationError
from odoo.tests import new_test_user, tagged

from .common import MESSAGE_KEYS, PASSWORD, TEMPLATE_KEYS, LiwanInboxCase
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_inbox.models.constants import AUTOMATION_FEATURE
from odoo.addons.liwan_inbox.models.privacy_hooks import ERASED_CONTACT

CONVERSATION_KEYS = {
    'id', 'contact', 'channel', 'department', 'assignee', 'state', 'priority', 'tags', 'revision', 'last_message_at',
    'waiting_since', 'waiting_overdue', 'last_message_preview', 'last_message_kind', 'unread', 'reply_window_ends_at', 'csat',
    'referral_source', 'referral_ref',
}


@tagged('post_install', '-at_install', 'liwan')
class TestConversationsApi(LiwanInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.settings.visibility_policy = 'all'
        cls.conversation = cls.make_conversation(unread=True)
        cls.template = cls.env['liwan.inbox.template'].create({
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
        self.assertEqual(set(item['contact']), {'id', 'name', 'phone', 'email', 'erased'})
        self.assertEqual(item['last_message_preview'], self.conversation.last_message_preview)
        closed = self.get('/api/v1/inbox/conversations?state=closed').json()
        self.assertNotIn(self.conversation.id, [row['id'] for row in closed['items']])
        by_query = self.get(f'/api/v1/inbox/conversations?q={self.conversation.contact_id.name}').json()
        self.assertEqual([row['id'] for row in by_query['items']], [self.conversation.id])
        self.assertError(self.get('/api/v1/inbox/conversations?state=bogus'), 422, 'invalid')
        self.assertError(self.get('/api/v1/inbox/conversations?limit=-1'), 422, 'invalid')

    def answered_conversation(self, minutes_ago):
        """A conversation whose customer message an agent already answered: nobody waits."""
        conversation = self.make_conversation(minutes_ago=minutes_ago)
        self.env['liwan.inbox.message'].create({
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'out',
            'author_id': self.agent.id, 'body': 'Answer', 'delivery_state': 'sent', 'date': fields.Datetime.now(),
        })
        return conversation

    def listed(self, query=''):
        return self.get(f'/api/v1/inbox/conversations?{query}').json()

    def test_list_reports_the_wait_and_when_it_is_overdue(self):
        waiting = self.make_conversation(minutes_ago=30)
        answered = self.answered_conversation(minutes_ago=30)
        self.login(self.agent)
        rows = {row['id']: row for row in self.listed()['items']}
        self.assertEqual(rows[waiting.id]['waiting_since'], fields.Datetime.to_datetime(waiting.waiting_since).isoformat(timespec='seconds') + 'Z')
        self.assertIsNone(rows[answered.id]['waiting_since'])
        self.assertEqual((rows[waiting.id]['waiting_overdue'], rows[answered.id]['waiting_overdue']), (False, False), 'the alert is off by default')
        self.settings.first_response_alert_minutes = 20
        rows = {row['id']: row for row in self.listed()['items']}
        self.assertTrue(rows[waiting.id]['waiting_overdue'])
        self.assertFalse(rows[answered.id]['waiting_overdue'])
        self.assertFalse(rows[self.conversation.id]['waiting_overdue'], 'five minutes is before the threshold')
        self.assertTrue(self.get(f'/api/v1/inbox/conversations/{waiting.id}').json()['waiting_overdue'])

    def test_waiting_overdue_follows_a_reply_without_a_manual_invalidation(self):
        self.settings.first_response_alert_minutes = 20
        conversation = self.make_conversation(minutes_ago=30)
        self.assertTrue(conversation.waiting_overdue)
        self.env['liwan.inbox.message'].create({
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'out',
            'author_id': self.agent.id, 'body': 'Answer', 'delivery_state': 'sent', 'date': fields.Datetime.now(),
        })
        self.assertFalse(conversation.waiting_overdue)

    def test_waiting_overdue_is_off_without_the_automation_feature(self):
        self.settings.first_response_alert_minutes = 20
        conversation = self.make_conversation(minutes_ago=30)
        set_probe_feature(self, key=AUTOMATION_FEATURE, enabled=False)
        self.assertFalse(conversation.waiting_overdue)

    def test_sort_waiting_puts_the_longest_wait_first_and_the_rest_last(self):
        oldest = self.make_conversation(minutes_ago=50)
        newer = self.make_conversation(minutes_ago=10)
        answered = self.answered_conversation(minutes_ago=90)
        mine = {oldest.id, newer.id, answered.id, self.conversation.id}
        self.login(self.agent)
        expected = [oldest.id, newer.id, self.conversation.id, answered.id]
        ordered = [row['id'] for row in self.listed('sort=waiting')['items'] if row['id'] in mine]
        self.assertEqual(ordered, expected, 'longest wait first, the answered conversation last')
        total = self.listed('sort=waiting')['total']
        pages = [row['id'] for offset in range(total) for row in self.listed(f'sort=waiting&limit=1&offset={offset}')['items']]
        self.assertEqual([i for i in pages if i in mine], expected, 'one-row pages follow the same order')
        self.assertEqual(self.listed('sort=waiting')['total'], self.listed()['total'])

    def test_default_order_is_the_most_recent_message(self):
        older = self.make_conversation(minutes_ago=50)
        newest = self.make_conversation(minutes_ago=1)
        self.login(self.agent)
        mine = {older.id, newest.id, self.conversation.id}
        for query in ('', 'sort=recent'):
            ordered = [row['id'] for row in self.listed(query)['items'] if row['id'] in mine]
            self.assertEqual(ordered, [newest.id, self.conversation.id, older.id])

    def test_an_unknown_sort_is_422(self):
        self.login(self.agent)
        self.assertError(self.get('/api/v1/inbox/conversations?sort=oldest'), 422, 'invalid')

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
        self.assertEqual(set(body), CONVERSATION_KEYS | {'can_reply', 'can_assign', 'image_send_capable'})
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
        tag = self.env['liwan.inbox.tag'].create({'name': 'VIP'})
        self.login(self.agent)
        result = self.patch_conversation(self.conversation, {'state': 'pending', 'priority': 'high', 'tag_ids': [tag.id]})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual((result.json()['state'], result.json()['priority']), ('pending', 'high'))
        self.assertEqual(result.json()['tags'], [{'id': tag.id, 'name': 'VIP'}])
        self.assertError(self.patch_conversation(self.conversation, {'assignee_id': self.agent.id}), 403, 'forbidden')
        self.assertError(self.patch_conversation(self.conversation, {'state': 'nope'}), 422, 'invalid')
        self.assertError(self.patch_conversation(self.conversation, {'tag_ids': [999999]}), 422, 'invalid')
        self.assertError(self.patch_conversation(self.conversation, {'bogus': 1}), 422, 'invalid')
        self.assertError(self.patch_conversation(self.conversation, {}), 422, 'invalid')

    def test_a_patch_names_the_revision_it_was_made_from(self):
        """INB-114: the second editor is told the conversation changed, and the first edit stays."""
        self.login(self.supervisor)
        first = self.conversation.revision
        self.assertEqual(self.patch_conversation(self.conversation, {'priority': 'high'}).json()['revision'], first + 1)
        stale = self.patch_conversation(self.conversation, {'priority': 'low'}, revision=first)
        self.assertError(stale, 409, 'stale_write')
        self.assertEqual((stale.json()['field'], stale.json()['details']), ('revision', {'reason': 'inbox_conversation_stale'}))
        self.assertEqual(self.reload(self.conversation).priority, 'high')
        self.assertError(self.api('PATCH', self.path(), {'priority': 'low'}), 422, 'invalid')
        self.assertError(self.patch_conversation(self.conversation, {'priority': 'low'}, revision='1'), 422, 'invalid')
        self.assertError(self.patch_conversation(self.conversation, {'priority': 'low'}, revision=0), 422, 'invalid')

    def test_every_change_of_an_edited_field_is_a_revision_and_nothing_else_is(self):
        before = self.conversation.revision
        self.conversation.unread = False
        self.assertEqual(self.reload(self.conversation).revision, before)
        self.conversation.write({'state': 'pending'})
        self.assertEqual(self.reload(self.conversation).revision, before + 1)
        self.conversation.write({'state': 'pending', 'tag_ids': [(6, 0, [])]})
        self.assertEqual(self.reload(self.conversation).revision, before + 1, 'the same values are not a new revision')
        self.conversation.write({'assignee_id': self.agent.id})
        self.assertEqual(self.reload(self.conversation).revision, before + 2)

    def test_priority_filter(self):
        urgent = self.make_conversation(priority='urgent')
        self.login(self.agent)
        ids = {row['id'] for row in self.get('/api/v1/inbox/conversations?priority=urgent').json()['items']}
        self.assertIn(urgent.id, ids)
        self.assertNotIn(self.conversation.id, ids)
        self.assertError(self.get('/api/v1/inbox/conversations?priority=critical'), 422, 'invalid')

    def test_channel_kind_filter(self):
        tiktok = self.make_conversation(channel=self.make_tiktok_channel(), priority='urgent')
        urgent_whatsapp = self.make_conversation(priority='urgent')
        self.login(self.agent)

        def ids(query):
            return {row['id'] for row in self.get(f'/api/v1/inbox/conversations?{query}').json()['items']}

        self.assertEqual(ids('channel_kind=tiktok'), {tiktok.id})
        self.assertEqual(ids('channel_kind=whatsapp'), {self.conversation.id, urgent_whatsapp.id})
        self.assertEqual(ids('channel_kind=whatsapp&priority=urgent'), {urgent_whatsapp.id})
        self.assertEqual(ids('channel_kind=tiktok&priority=normal'), set())
        self.assertError(self.get('/api/v1/inbox/conversations?channel_kind=sms'), 422, 'invalid')

    def test_export_honours_the_channel_kind_filter(self):
        tiktok = self.make_conversation(channel=self.make_tiktok_channel())
        self.login(self.supervisor)
        export = self.get('/api/v1/inbox/conversations/export.csv?channel_kind=tiktok')
        self.assertIn(f'{tiktok.contact_id.name},', export.text)
        self.assertNotIn(f'{self.conversation.contact_id.name},', export.text)  # the comma: 'Customer 1' is a prefix of 'Customer 13'
        whatsapp_export = self.get('/api/v1/inbox/conversations/export.csv?channel_kind=whatsapp')
        self.assertIn(f'{self.conversation.contact_id.name},', whatsapp_export.text)
        self.assertNotIn(f'{tiktok.contact_id.name},', whatsapp_export.text)
        self.assertError(self.get('/api/v1/inbox/conversations/export.csv?channel_kind=sms'), 422, 'invalid')

    def test_reopening_beside_a_newer_open_conversation_is_a_clear_refusal(self):
        """INB-113: the one-open-conversation-per-customer rule answers with a code the page maps, not SQL text."""
        closed = self.make_conversation(state='closed')
        self.env['liwan.inbox.conversation'].create({
            'channel_id': closed.channel_id.id, 'contact_id': closed.contact_id.id, 'identity_id': closed.identity_id.id,
            'company_id': closed.company_id.id, 'state': 'open',
        })
        self.login(self.supervisor)
        refused = self.patch_conversation(closed, {'state': 'open'})
        self.assertError(refused, 422, 'invalid')
        self.assertEqual((refused.json()['field'], refused.json()['details']), ('state', {'reason': 'inbox_customer_has_open_conversation'}))
        self.assertEqual(self.reload(closed).state, 'closed')

    def test_a_file_without_a_caption_has_no_preview_text_and_names_its_kind(self):
        message = self.conversation.message_ids[0]
        message.write({'kind': 'image', 'body': '[image]'})
        self.login(self.agent)
        item = next(row for row in self.get('/api/v1/inbox/conversations').json()['items'] if row['id'] == self.conversation.id)
        self.assertEqual((item['last_message_preview'], item['last_message_kind']), (None, 'image'))
        message.write({'body': 'the scan'})
        item = next(row for row in self.get('/api/v1/inbox/conversations').json()['items'] if row['id'] == self.conversation.id)
        self.assertEqual((item['last_message_preview'], item['last_message_kind']), ('the scan', 'image'))

    def test_assignment_needs_an_agent_and_sends_one_bell_row(self):
        self.login(self.supervisor)
        self.assertError(self.patch_conversation(self.conversation, {'assignee_id': self.outsider.id}), 422, 'invalid')
        result = self.patch_conversation(self.conversation, {'assignee_id': self.agent.id, 'department_id': self.department.id})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['assignee']['id'], self.agent.id)
        self.assertEqual(result.json()['department']['id'], self.department.id)
        bell = self.env['mail.message'].search([
            ('liwan_notification_kind', '=', 'inbox.assigned'), ('liwan_inbox_conversation_id', '=', self.conversation.id),
        ])
        self.assertEqual(bell.partner_ids, self.agent.partner_id)
        self.login(self.agent)
        rows = self.get('/api/v1/notifications').json()['items']
        self.assertEqual([r['conversation_id'] for r in rows if r['kind'] == 'inbox.assigned'], [self.conversation.id])
        self.login(self.supervisor)
        self.patch_conversation(self.conversation, {'assignee_id': self.supervisor.id})
        self.assertEqual(self.env['mail.message'].search_count([('liwan_notification_kind', '=', 'inbox.assigned')]), 1)
        self.assertError(self.patch_conversation(self.conversation, {'department_id': 999999}), 422, 'invalid')

    def test_a_department_or_tag_of_another_company_is_refused(self):
        branch = self.env['res.company'].create({'name': 'Lists branch company', 'parent_id': self.env.company.id})
        user = new_test_user(
            self.env, login='inbox_two_companies', password=PASSWORD, name='Two companies', groups='liwan_core.group_employee',
            company_id=self.env.company.id, company_ids=[(6, 0, (self.env.company | branch).ids)],
        )
        role = self.env.ref('liwan_inbox.role_inbox_supervisor')
        for company in self.env.company | branch:
            self.env['liwan.access.assignment'].create({'user_id': user.id, 'company_id': company.id, 'role_id': role.id})
        foreign_department = self.env['liwan.inbox.department'].create({'name': 'Branch desk', 'company_id': branch.id})
        foreign_tag = self.env['liwan.inbox.tag'].create({'name': 'Branch tag', 'company_id': branch.id})
        own_tag = self.env['liwan.inbox.tag'].create({'name': 'Own tag'})
        self.login(user)
        self.assertError(self.patch_conversation(self.conversation, {'department_id': foreign_department.id}), 422, 'invalid')
        self.assertError(self.patch_conversation(self.conversation, {'tag_ids': [foreign_tag.id]}), 422, 'invalid')
        own = self.patch_conversation(self.conversation, {'department_id': self.department.id, 'tag_ids': [own_tag.id]})
        self.assertEqual(own.status_code, 200, own.text)
        with self.assertRaises(ValidationError):
            self.conversation.write({'department_id': foreign_department.id})
        with self.assertRaises(ValidationError):
            self.conversation.write({'tag_ids': [(4, foreign_tag.id)]})

    def test_a_branch_conversation_takes_the_department_and_tags_of_its_own_company(self):
        branch = self.env['res.company'].create({'name': 'Parent session branch', 'parent_id': self.env.company.id})
        user = new_test_user(
            self.env, login='inbox_parent_session', password=PASSWORD, name='Parent session', groups='liwan_core.group_employee',
            company_id=self.env.company.id, company_ids=[(6, 0, (self.env.company | branch).ids)],
        )
        role = self.env.ref('liwan_inbox.role_inbox_supervisor')
        for company in self.env.company | branch:
            self.env['liwan.access.assignment'].create({'user_id': user.id, 'company_id': company.id, 'role_id': role.id})
        branch_channel = self.make_channel(phone_id='100000000098', owner_company_id=branch.id)
        conversation = self.make_conversation(channel=branch_channel)
        branch_department = self.env['liwan.inbox.department'].create({'name': 'Branch desk', 'company_id': branch.id})
        branch_tag = self.env['liwan.inbox.tag'].create({'name': 'Branch tag', 'company_id': branch.id})
        self.login(user)  # the session's current company is the parent
        own = self.patch_conversation(conversation, {'department_id': branch_department.id, 'tag_ids': [branch_tag.id]})
        self.assertEqual(own.status_code, 200, own.text)
        self.assertEqual((conversation.department_id, conversation.tag_ids), (branch_department, branch_tag))
        self.assertError(self.patch_conversation(conversation, {'department_id': self.department.id}), 422, 'invalid')

    def branch_conversation_user(self, login, parent_role, branch_role, phone_id):
        """A parent-session user with `parent_role` in the parent and `branch_role` in a branch, and a branch conversation with a pending receipt."""
        branch = self.env['res.company'].create({'name': f'{login} branch', 'parent_id': self.env.company.id})
        user = new_test_user(
            self.env, login=login, password=PASSWORD, name=login, groups='liwan_core.group_employee',
            company_id=self.env.company.id, company_ids=[(6, 0, (self.env.company | branch).ids)],
        )
        read = self.env['liwan.access.permission'].search([('key', '=', 'inbox.conversations.read')])
        supervisor = self.env.ref('liwan_inbox.role_inbox_supervisor')
        for company, role in ((self.env.company, parent_role), (branch, branch_role)):
            # A custom role belongs to one company, so a read-only role is made in the company it is assigned in.
            held = supervisor if role == 'supervisor' else self.env['liwan.access.role'].with_company(company).create({
                'key': f'{login}_{company.id}', 'name_ar': login, 'name_en': login, 'permission_ids': [Command.set(read.ids)],
            })
            self.env['liwan.access.assignment'].create({'user_id': user.id, 'company_id': company.id, 'role_id': held.id})
        channel = self.make_channel(phone_id=phone_id, owner_company_id=branch.id)
        conversation = self.make_conversation(channel=channel, unread=True)
        conversation.message_ids[0].provider_message_id = f'wamid.{login}'
        return user, conversation

    def test_a_branch_conversation_checks_reply_and_assign_in_its_own_company(self):
        # The capability is held in the conversation's company only: the working (parent) company is irrelevant.
        user, conversation = self.branch_conversation_user('inbox_branch_only', 'reader', 'supervisor', '100000000071')
        self.login(user)
        detail = self.get(f'/api/v1/inbox/conversations/{conversation.id}').json()
        self.assertEqual((detail['can_reply'], detail['can_assign']), (True, True))
        self.assertEqual(self.api('POST', f'/api/v1/inbox/conversations/{conversation.id}/read').status_code, 204)
        self.assertEqual(self.reload(conversation.message_ids[0]).read_receipt, 'pending')

    def test_a_branch_conversation_is_not_replied_to_on_the_working_company_grant(self):
        # The capability is held in the working (parent) company only: it does not reach the branch conversation.
        user, conversation = self.branch_conversation_user('inbox_parent_only', 'supervisor', 'reader', '100000000072')
        self.login(user)
        detail = self.get(f'/api/v1/inbox/conversations/{conversation.id}').json()
        self.assertEqual((detail['can_reply'], detail['can_assign']), (False, False))
        self.assertEqual(self.api('POST', f'/api/v1/inbox/conversations/{conversation.id}/read').status_code, 204)
        self.assertFalse(self.reload(conversation.message_ids[0]).read_receipt)
        self.assertFalse(self.reload(conversation).unread)

    def test_a_branch_conversation_is_patched_only_with_the_grant_of_its_own_company(self):
        parent_only, conversation = self.branch_conversation_user('inbox_patch_parent', 'supervisor', 'reader', '100000000073')
        self.login(parent_only)
        for payload in ({'priority': 'high'}, {'state': 'pending'}, {'assignee_id': self.agent.id}):
            self.assertError(self.patch_conversation(conversation, payload), 403, 'forbidden')
        self.assertEqual((conversation.priority, conversation.assignee_id), ('normal', self.env['res.users']))
        branch_only, conversation = self.branch_conversation_user('inbox_patch_branch', 'reader', 'supervisor', '100000000074')
        self.login(branch_only)
        self.assertEqual(self.patch_conversation(conversation, {'priority': 'high'}).status_code, 200)
        self.assertEqual(conversation.priority, 'high')

    def test_messages_are_chronological_and_paged_from_the_newest(self):
        for index in range(3):
            self.env['liwan.inbox.message'].create({
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
        message = self.env['liwan.inbox.message'].browse(body['id'])
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
        foreign = self.env['liwan.inbox.template'].create({
            'channel_id': other_channel.id, 'name': 'x', 'language': 'ar', 'status': 'approved', 'body': 'x',
        })
        self.assertError(self.api('POST', path, {'template_id': foreign.id, 'params': []}), 422, 'invalid')
        self.assertError(self.api('POST', path, {'body': 'a', 'params': []}), 422, 'invalid')
        self.assertError(self.api('POST', path, {'body': ''}), 422, 'invalid')

    def test_reply_note_and_retry_need_the_reply_capability(self):
        self.login(self.outsider)
        self.assertError(self.api('POST', self.path('/messages'), {'body': 'x'}), 403, 'forbidden')
        self.assertError(self.api('POST', self.path('/notes'), {'body': 'x'}), 403, 'forbidden')
        self.assertError(self.patch_conversation(self.conversation, {'state': 'pending'}), 403, 'forbidden')

    def test_closed_conversation_refuses_a_reply(self):
        closed = self.make_conversation(state='closed')
        self.login(self.agent)
        self.assertError(self.api('POST', f'/api/v1/inbox/conversations/{closed.id}/messages', {'body': 'x'}), 422, 'invalid')

    def test_note_and_retry(self):
        self.login(self.agent)
        note = self.api('POST', self.path('/notes'), {'body': 'internal'})
        self.assertEqual((note.status_code, note.json()['direction']), (200, 'note'))
        self.assertError(self.api('POST', self.path('/notes'), {'body': ''}), 422, 'invalid')
        failed = self.env['liwan.inbox.message'].create({
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

    def test_an_erased_contact_cannot_be_edited(self):
        contact = self.conversation.contact_id
        contact.write({'name': ERASED_CONTACT % contact.id})
        self.login(self.agent)
        self.assertError(self.api('PATCH', f'/api/v1/inbox/contacts/{contact.id}', {'name': 'Renamed'}), 409, 'contact_erased')
        self.assertEqual(contact.name, ERASED_CONTACT % contact.id)

    def test_a_contact_cannot_be_renamed_to_the_erased_marker(self):
        contact = self.conversation.contact_id
        name = contact.name
        self.login(self.agent)
        self.assertError(self.api('PATCH', f'/api/v1/inbox/contacts/{contact.id}', {'name': ERASED_CONTACT % contact.id}), 422, 'invalid')
        self.assertEqual(contact.name, name)

    def test_only_a_file_kind_treats_its_name_in_brackets_as_a_placeholder(self):
        message = self.conversation.message_ids[0]
        message.write({'kind': 'text', 'body': '[text]'})
        self.assertEqual(message._liwan_caption(), '[text]')
        message.write({'kind': 'image', 'body': '[image]'})
        self.assertFalse(message._liwan_caption())

    def test_canned_replies_and_templates_lists(self):
        self.env['liwan.inbox.canned.reply'].create({'shortcut': 'hi', 'body': 'Hello!'})
        self.env['liwan.inbox.template'].create({
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
        self.assertEqual(set(body['items'][0]), {'id', 'name', 'available', 'in_shift', 'effective_available'})
        filtered = self.get('/api/v1/inbox/agents?q=SUPERV').json()
        self.assertEqual([row['name'] for row in filtered['items']], ['inbox_supervisor'])
        self.login(self.outsider)
        self.assertError(self.get('/api/v1/inbox/agents'), 403, 'forbidden')
