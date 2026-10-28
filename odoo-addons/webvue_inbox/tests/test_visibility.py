# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import WebVueInboxCase


@tagged('post_install', '-at_install', 'webvue')
class TestVisibilityPolicy(WebVueInboxCase):
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
            'res_model': 'webvue.inbox.message', 'res_id': message.id,
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

    def test_visible_attachment_downloads(self):
        self.set_policy('assigned_only')
        message = self.mine.message_ids[0]
        attachment = self.env['ir.attachment'].create({
            'name': 'photo.txt', 'raw': b'bytes', 'mimetype': 'text/plain',
            'res_model': 'webvue.inbox.message', 'res_id': message.id,
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
