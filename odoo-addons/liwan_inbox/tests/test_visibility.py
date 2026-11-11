# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
from unittest.mock import patch

from odoo.tests import tagged

from .common import LiwanInboxCase
from odoo.addons.liwan_inbox.models.access_service import READ


@tagged('post_install', '-at_install', 'liwan')
class TestVisibilityPolicy(LiwanInboxCase):
    """Every policy hides the same way (404) on list, detail, reply, export and attachment download."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.mine = cls.make_conversation(assignee_id=cls.agent.id)
        cls.in_department = cls.make_conversation(department_id=cls.department.id)
        cls.unassigned = cls.make_conversation()
        cls.others = cls.make_conversation(assignee_id=cls.agent2.id, department_id=cls.other_department.id)
        cls.other_department_free = cls.make_conversation(department_id=cls.other_department.id)
        cls.everything = cls.mine | cls.in_department | cls.unassigned | cls.others | cls.other_department_free

    def set_policy(self, policy):
        self.settings.visibility_policy = policy

    def listed(self):
        items = self.get('/api/v1/inbox/conversations?limit=200').json()['items']
        return {row['id'] for row in items} & set(self.everything.ids)

    def expected(self, *conversations):
        return {c.id for c in conversations}

    def test_assigned_only(self):
        self.set_policy('assigned_only')
        self.login(self.agent)
        self.assertEqual(self.listed(), self.expected(self.mine))

    def test_department(self):
        self.set_policy('department')
        self.login(self.agent)
        self.assertEqual(self.listed(), self.expected(self.mine, self.in_department, self.unassigned))

    def test_all(self):
        self.set_policy('all')
        self.login(self.agent)
        self.assertEqual(self.listed(), set(self.everything.ids))

    def test_a_user_who_can_assign_sees_everything_in_every_mode(self):
        self.login(self.supervisor)
        for policy in ('assigned_only', 'department', 'all'):
            self.set_policy(policy)
            self.assertEqual(self.listed(), set(self.everything.ids), policy)

    def test_hidden_conversations_answer_404_everywhere(self):
        self.set_policy('assigned_only')
        self.login(self.agent)
        hidden = self.others
        message = hidden.message_ids[0]
        attachment = self.env['ir.attachment'].create({
            'name': 'secret.txt', 'raw': b'secret', 'mimetype': 'text/plain',
            'res_model': 'liwan.inbox.message', 'res_id': message.id,
        })
        base = f'/api/v1/inbox/conversations/{hidden.id}'
        for method, path, body in (
            ('GET', base, None),
            ('PATCH', base, {'state': 'pending'}),
            ('GET', f'{base}/messages', None),
            ('POST', f'{base}/messages', {'body': 'x'}),
            ('POST', f'{base}/notes', {'body': 'x'}),
            ('POST', f'/api/v1/inbox/messages/{message.id}/retry', None),
            ('GET', f'/api/v1/inbox/contacts/{hidden.contact_id.id}', None),
            ('GET', f'/api/v1/inbox/messages/{message.id}/attachments/{attachment.id}/download', None),
        ):
            self.assertError(self.api(method, path, body), 404, 'not_found')
        self.login(self.agent2)
        download = self.get(f'/api/v1/inbox/messages/{message.id}/attachments/{attachment.id}/download')
        self.assertEqual((download.status_code, download.content), (200, b'secret'))

    def bus_notices(self):
        """(partner id, payload) of the conversation notifications stored so far in this transaction."""
        notices = []
        for row in self.env['bus.bus'].sudo().search([], order='id'):
            channel, message = json.loads(row.channel), json.loads(row.message)
            if message['type'] == 'liwan/inbox' and message['payload'].get('event') == 'conversation':
                notices.append((channel[2], message['payload']))
        return notices

    def test_a_batch_of_conversations_sends_one_notification_per_reader(self):
        self.set_policy('all')
        conversations = self.everything
        conversations._liwan_notify_bus()
        self.env.cr.flush()  # the bus rows wait in precommit; flushing writes them
        notices = self.bus_notices()
        partners = [partner for partner, _payload in notices]
        self.assertEqual(len(partners), len(set(partners)), 'one notification per reader')
        self.assertIn(self.agent.partner_id.id, partners)
        self.assertNotIn(self.outsider.partner_id.id, partners)
        self.assertEqual([payload['event'] for _partner, payload in notices], ['conversation'] * len(notices))
        self.assertEqual(
            {tuple(payload['ids']) for _partner, payload in notices}, {tuple(sorted(conversations.ids))},
        )

    def test_a_mixed_batch_sends_each_reader_only_their_visible_ids(self):
        self.set_policy('department')
        self.everything._liwan_notify_bus()
        self.env.cr.flush()
        notices = dict(self.bus_notices())
        self.assertEqual(
            set(notices[self.agent.partner_id.id]['ids']),
            {self.mine.id, self.in_department.id, self.unassigned.id},
        )
        self.assertEqual(
            set(notices[self.agent2.partner_id.id]['ids']),
            {self.others.id, self.unassigned.id},
        )

    def test_the_reader_capability_is_checked_once_per_reader_not_once_per_conversation(self):
        self.set_policy('all')
        conversations = self.everything
        service_model = type(self.env['liwan.access.service'])
        original = service_model._liwan_has_capability
        checked = []

        def spy(model, user, capability, record=None, company=None):
            checked.append(capability)
            return original(model, user, capability, record=record, company=company)

        with patch.object(service_model, '_liwan_has_capability', autospec=True, side_effect=spy):
            conversations._liwan_notify_bus()
        readers = self.env.ref('liwan_inbox.group_cap_inbox_conversations_read').all_user_ids.filtered('active')
        self.assertGreater(len(readers), 1)
        # One read-capability check per reader, however many conversations the batch carries.
        self.assertEqual(checked.count(READ), len(readers))

    def test_visible_attachment_downloads(self):
        self.set_policy('assigned_only')
        message = self.mine.message_ids[0]
        attachment = self.env['ir.attachment'].create({
            'name': 'photo.txt', 'raw': b'bytes', 'mimetype': 'text/plain',
            'res_model': 'liwan.inbox.message', 'res_id': message.id,
        })
        path = f'/api/v1/inbox/messages/{message.id}/attachments/{attachment.id}/download'
        self.login(self.agent)
        response = self.get(path)
        self.assertEqual((response.status_code, response.content), (200, b'bytes'))
        self.assertEqual(response.headers['Cache-Control'], 'private, no-store')
        self.assertEqual(self.get(f'/api/v1/inbox/messages/{message.id}/attachments/999999/download').status_code, 404)
        listed = self.get(f'/api/v1/inbox/conversations/{self.mine.id}/messages').json()['items'][0]['attachments']
        self.assertEqual(listed, [{'id': attachment.id, 'name': 'photo.txt', 'mimetype': 'text/plain', 'size': 5}])

    def test_export_applies_the_policy_and_needs_the_capability(self):
        self.set_policy('assigned_only')
        self.login(self.agent)
        self.assertError(self.get('/api/v1/inbox/conversations/export.csv'), 403, 'forbidden')
        self.login(self.supervisor)
        full = self.get('/api/v1/inbox/conversations/export.csv')
        self.assertEqual(full.status_code, 200)
        self.assertTrue(full.headers['Content-Type'].startswith('text/csv'))
        self.assertIn(self.others.contact_id.name, full.text)
        filtered = self.get(f'/api/v1/inbox/conversations/export.csv?assignee={self.agent.id}')
        self.assertIn(self.mine.contact_id.name, filtered.text)
        self.assertNotIn(self.others.contact_id.name, filtered.text)

    def test_export_neutralises_spreadsheet_formulas(self):
        self.mine.contact_id.name = '=HYPERLINK("http://x")'
        self.set_policy('all')
        self.login(self.supervisor)
        self.assertIn("'=HYPERLINK", self.get('/api/v1/inbox/conversations/export.csv').text)

    def test_form_answers_follow_the_conversation_visibility(self):
        flow = self.env['liwan.inbox.flow'].create({
            'channel_id': self.channel.id, 'name': 'Visible form', 'category': 'other', 'status': 'published',
            'provider_flow_id': '811000001',
        })
        by_conversation = {}
        for conversation in self.everything:
            message = self.env['liwan.inbox.message'].create({
                'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'in',
                'kind': 'flow_response', 'body': 'Visible form', 'delivery_state': 'received',
            })
            by_conversation[conversation.id] = self.env['liwan.inbox.flow.submission'].create({
                'conversation_id': conversation.id, 'flow_id': flow.id, 'message_id': message.id, 'submitted_at': message.date,
            })

        def listed():
            items = self.get(f'/api/v1/inbox/flows/{flow.id}/submissions?limit=200').json()['items']
            return {row['conversation_id'] for row in items}

        def counted():
            return self.get(f'/api/v1/inbox/flows/{flow.id}').json()['submission_count']

        expectations = {
            'assigned_only': (self.agent, [self.mine]),
            'department': (self.agent, [self.mine, self.in_department, self.unassigned]),
            'all': (self.agent, list(self.everything)),
        }
        for policy, (user, visible) in expectations.items():
            self.set_policy(policy)
            self.login(user)
            self.assertEqual(listed(), {c.id for c in visible}, policy)
            self.assertEqual(counted(), len(visible), policy)
            for conversation in self.everything:
                response = self.get(f'/api/v1/inbox/conversations/{conversation.id}/flow-submissions')
                if conversation in visible:
                    self.assertEqual(response.json()['items'][0]['id'], by_conversation[conversation.id].id, policy)
                else:
                    self.assertError(response, 404, 'not_found')
        self.login(self.supervisor)
        for policy in ('assigned_only', 'department', 'all'):
            self.set_policy(policy)
            self.assertEqual(listed(), set(self.everything.ids), policy)
