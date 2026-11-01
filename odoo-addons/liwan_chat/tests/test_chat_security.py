# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64

from odoo.tests import tagged
from odoo.tests.common import new_test_user

from odoo.addons.liwan_api.tests.common import LiwanApiCase

PDF = b'%PDF-1.7\nprivate chat\n'


@tagged('post_install', '-at_install', 'liwan')
class TestChatSecurity(LiwanApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.peer = new_test_user(
            cls.env, login='sec_peer', password='sec_peer_pass_123',
            name='SecPeer', groups='liwan_core.group_employee',
        )
        cls.outsider = new_test_user(
            cls.env, login='sec_out', password='sec_out_pass_123',
            name='Outsider', groups='liwan_core.group_employee',
        )
        cls.liwan_admin = new_test_user(
            cls.env, login='sec_admin', password='sec_admin_pass_123',
            name='LiwanAdmin',
            groups='liwan_core.group_employee,liwan_core.group_access_admin,base.group_system',
        )
        cls.empty_role = cls.env['liwan.access.role']._liwan_access_create({
            'name_ar': 'Chat empty role',
        })
        cls.managed_empty = new_test_user(
            cls.env, login='sec_managed_empty', password='sec_managed_empty_pass_123',
            name='Managed empty', groups='base.group_user',
            company_id=cls.env.company.id,
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(
            cls.managed_empty,
            [{'role_id': cls.empty_role.id, 'company_id': cls.env.company.id}],
        )

    def _direct(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        return self.api('POST', '/api/v1/chat/conversations', {'user_ids': [self.peer.id]}).json()

    def test_non_member_and_admin_are_denied(self):
        conversation = self._direct()
        path = f"/api/v1/chat/conversations/{conversation['id']}"
        self.authenticate('sec_out', 'sec_out_pass_123')
        self.assertEqual(self.api('GET', path).status_code, 403)
        self.assertEqual(self.api('GET', f'{path}/messages').status_code, 403)
        self.assertEqual(self.api('POST', f'{path}/messages', {'body': 'nope'}).status_code, 403)
        # CHT-9, CHT-72, CHT-117: every route answers the documented sentence, never Odoo's text naming the model and the user.
        for method, suffix, body in (
            ('GET', '', None), ('GET', '/messages', None), ('POST', '/messages', {'body': 'nope'}),
            ('GET', '/members', None), ('GET', '/attachments', None), ('POST', '/read', {}),
        ):
            refused = self.api(method, path + suffix, body)
            self.assertEqual(
                (refused.status_code, refused.json()['code'], refused.json()['message']),
                (403, 'forbidden', 'You are not a member of this conversation.'), f'{method} {suffix}',
            )
        self.authenticate('sec_admin', 'sec_admin_pass_123')
        denied = self.api('GET', path)
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.json()['code'], 'forbidden')
        self.assertEqual(self.api('GET', f'{path}/members').status_code, 403)
        self.assertEqual(self.api('GET', f'{path}/attachments').status_code, 403)

    def test_read_rejects_foreign_message(self):
        first = self._direct()
        self.authenticate('api_emp', 'api_emp_pass_123')
        other = self.api('POST', '/api/v1/chat/conversations', {'user_ids': [self.outsider.id]}).json()
        foreign = self.api('POST', f"/api/v1/chat/conversations/{other['id']}/messages", {
            'body': 'other thread',
        }).json()
        rejected = self.api('POST', f"/api/v1/chat/conversations/{first['id']}/read", {
            'message_id': foreign['id'],
        })
        self.assertEqual(rejected.status_code, 404)
        missing = self.api('POST', f"/api/v1/chat/conversations/{first['id']}/read", {
            'message_id': 99999999,
        })
        self.assertEqual(missing.status_code, 404)

    def test_attachment_download_denied_for_non_member_and_after_revocation(self):
        conversation = self._direct()
        sent = self.api('POST', f"/api/v1/chat/conversations/{conversation['id']}/messages", {
            'body': 'secret',
            'attachment': {
                'name': 'secret.pdf',
                'mimetype': 'application/pdf',
                'data': base64.b64encode(PDF).decode(),
            },
        }).json()
        url = sent['attachments'][0]['url']
        self.authenticate('sec_out', 'sec_out_pass_123')
        self.assertEqual(url, f"/api/v1/chat/conversations/{conversation['id']}/attachments/{sent['attachments'][0]['id']}/download")
        blocked = self.api('GET', url)
        self.assertEqual(blocked.status_code, 403)
        self.authenticate('sec_peer', 'sec_peer_pass_123')
        allowed = self.api('GET', url)
        self.assertEqual(allowed.status_code, 200)
        member = self.env['discuss.channel.member'].search([
            ('channel_id', '=', conversation['id']),
            ('partner_id', '=', self.peer.partner_id.id),
        ])
        member.unlink()
        self.authenticate('sec_peer', 'sec_peer_pass_123')
        revoked_api = self.api('GET', f"/api/v1/chat/conversations/{conversation['id']}")
        self.assertEqual(revoked_api.status_code, 403)
        revoked_file = self.api('GET', url)
        self.assertEqual(revoked_file.status_code, 403)

    def test_non_member_system_admin_cannot_download(self):
        conversation = self._direct()
        sent = self.api('POST', f"/api/v1/chat/conversations/{conversation['id']}/messages", {
            'body': 'admin file',
            'attachment': {
                'name': 'admin.pdf',
                'mimetype': 'application/pdf',
                'data': base64.b64encode(PDF).decode(),
            },
        }).json()
        self.authenticate('admin', 'admin')
        download = self.api('GET', sent['attachments'][0]['url'])
        self.assertEqual(download.status_code, 403)

    def test_inactive_or_self_recipients_are_rejected(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('POST', '/api/v1/chat/conversations', {
            'user_ids': [self.employee.id],
        }).status_code, 422)
        self.peer.active = False
        self.assertEqual(self.api('POST', '/api/v1/chat/conversations', {
            'user_ids': [self.peer.id],
        }).status_code, 422)

    def test_empty_custom_role_assignment_is_chat_eligible_without_legacy_group(self):
        self.assertFalse(self.managed_empty.has_group('liwan_core.group_employee'))
        self.assertTrue(self.managed_empty.liwan_access_managed)
        self.assertFalse(self.empty_role.permission_ids)

        channel = self.env['discuss.channel'].with_user(self.employee)._get_or_create_chat(
            [self.managed_empty.partner_id.id],
        )
        self.authenticate('sec_managed_empty', 'sec_managed_empty_pass_123')

        listing = self.api('GET', '/api/v1/chat/conversations?filter=all')
        self.assertEqual(listing.status_code, 200)
        self.assertIn(channel.id, [item['id'] for item in listing.json()['items']])
        recipients = self.api('GET', '/api/v1/chat/recipients?q=Sara')
        self.assertEqual(recipients.status_code, 200)
        self.assertIn(self.employee.id, [item['id'] for item in recipients.json()['items']])
        sent = self.api('POST', f'/api/v1/chat/conversations/{channel.id}/messages', {
            'body': 'managed chat message',
        })
        self.assertEqual(sent.status_code, 201)

    def test_managed_account_creates_a_channel_and_is_its_member(self):
        self.assertFalse(self.managed_empty.has_group('liwan_core.group_employee'))
        self.authenticate('sec_managed_empty', 'sec_managed_empty_pass_123')
        created = self.api('POST', '/api/v1/chat/conversations', {
            'type': 'channel', 'name': 'قناة', 'user_ids': [],
        })
        self.assertEqual(created.status_code, 201, created.text)
        channel = self.env['discuss.channel'].browse(created.json()['id'])
        self.assertEqual(channel.channel_type, 'channel')
        self.assertIn(self.managed_empty.partner_id, channel.channel_member_ids.partner_id)
        sent = self.api('POST', f'/api/v1/chat/conversations/{channel.id}/messages', {'body': 'first'})
        self.assertEqual(sent.status_code, 201, sent.text)

    def test_managed_author_deletes_own_message_and_others_cannot_edit_or_delete(self):
        channel = self.env['discuss.channel'].with_user(self.employee)._get_or_create_chat(
            [self.managed_empty.partner_id.id],
        )
        path = f'/api/v1/chat/conversations/{channel.id}/messages'
        self.authenticate('sec_managed_empty', 'sec_managed_empty_pass_123')
        message = self.api('POST', path, {'body': 'see https://example.com/page'})
        self.assertEqual(message.status_code, 201, message.text)
        message_id = message.json()['id']
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('PATCH', f'{path}/{message_id}', {'body': 'hijacked'}).status_code, 403)
        self.assertEqual(self.api('DELETE', f'{path}/{message_id}').status_code, 403)
        self.authenticate('sec_managed_empty', 'sec_managed_empty_pass_123')
        # A message with a link preview is the case that needs the documented elevation: clearing it reads the previews.
        deleted = self.api('DELETE', f'{path}/{message_id}')
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertEqual((deleted.json()['mode'], deleted.json()['message']['body'], deleted.json()['message']['deleted']), ('placeholder', '', True))

    def test_member_cannot_read_channel_after_switching_company(self):
        conversation = self._direct()
        path = f"/api/v1/chat/conversations/{conversation['id']}"
        company_b = self.env['res.company'].create({'name': 'Chat company B'})
        self.employee.sudo().write({
            'company_ids': [(4, company_b.id)],
            'company_id': company_b.id,
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        denied = self.api('GET', path)
        self.assertEqual(denied.status_code, 403, denied.text)
