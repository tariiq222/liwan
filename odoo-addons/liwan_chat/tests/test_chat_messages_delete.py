# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64

from odoo import Command
from odoo.tests import tagged
from odoo.tests.common import new_test_user

from odoo.addons.liwan_api.tests.common import LiwanApiCase

PDF = base64.b64encode(b'%PDF-1.7\nchat fixture\n').decode()


@tagged('post_install', '-at_install', 'liwan')
class TestChatSettingsAndMessageDelete(LiwanApiCase):
    """CHT-64: the company chooses what deleting a message does, and the author deletes with the route made for it."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.peer = new_test_user(
            cls.env, login='del_peer', password='del_peer_pass_123', name='Peer', groups='liwan_core.group_employee',
        )
        cls.manager = new_test_user(
            cls.env, login='del_manager', password='del_manager_pass_123', name='Manager', groups='liwan_core.group_employee',
        )
        role = cls.env['liwan.access.role'].create({
            'key': 'chat_settings_manager', 'name_ar': 'chat settings', 'name_en': 'chat settings', 'type': 'custom',
            'permission_ids': [Command.set(cls.env['liwan.access.permission'].search([('key', '=', 'chat.settings.manage')]).ids)],
        })
        cls.env['liwan.access.service']._liwan_replace_assignments(
            cls.manager, [{'role_id': role.id, 'company_id': cls.env.company.id}],
        )

    def _conversation(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        created = self.api('POST', '/api/v1/chat/conversations', {'user_ids': [self.peer.id]}).json()
        return f"/api/v1/chat/conversations/{created['id']}"

    def _set_mode(self, mode):
        self.env['liwan.chat.settings'].create({'company_id': self.env.company.id, 'message_delete_mode': mode})

    def _send(self, path, **payload):
        sent = self.api('POST', f'{path}/messages', payload)
        self.assertEqual(sent.status_code, 201, sent.text)
        return sent.json()

    def _messages(self, path):
        return {item['id']: item for item in self.api('GET', f'{path}/messages').json()['items']}

    # settings

    def test_the_default_keeps_a_deleted_row(self):
        self.authenticate('del_manager', 'del_manager_pass_123')
        body = self.api('GET', '/api/v1/chat/settings').json()
        self.assertEqual(body, {
            'values': {'message_delete_mode': 'placeholder'}, 'defaults': {'message_delete_mode': 'placeholder'},
            'options': {'message_delete_mode': ['placeholder', 'permanent']}, 'revision': 0,
        })
        self.assertFalse(self.env['liwan.chat.settings'].search_count([]), 'reading the settings writes nothing')

    def test_the_settings_need_the_capability_and_carry_a_revision(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/chat/settings').status_code, 403)
        self.assertEqual(self.api('PATCH', '/api/v1/chat/settings', {'revision': 0, 'values': {'message_delete_mode': 'permanent'}}).status_code, 403)
        self.authenticate('del_manager', 'del_manager_pass_123')
        saved = self.api('PATCH', '/api/v1/chat/settings', {'revision': 0, 'values': {'message_delete_mode': 'permanent'}})
        self.assertEqual((saved.status_code, saved.json()['values'], saved.json()['revision']), (200, {'message_delete_mode': 'permanent'}, 1))
        stale = self.api('PATCH', '/api/v1/chat/settings', {'revision': 0, 'values': {'message_delete_mode': 'placeholder'}})
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'conflict'))
        for bad in (
            {'revision': 1, 'values': {'message_delete_mode': 'shred'}}, {'revision': 1, 'values': {}}, {'revision': 1, 'values': {'x': 1}},
            {'revision': -1, 'values': {'message_delete_mode': 'placeholder'}}, {'values': {'message_delete_mode': 'placeholder'}},
        ):
            self.assertEqual(self.api('PATCH', '/api/v1/chat/settings', bad).status_code, 422, bad)

    # delete

    def test_placeholder_mode_clears_the_text_and_the_files_and_keeps_the_row(self):
        path = self._conversation()
        keep = self._send(path, body='stay')
        gone = self._send(path, body='secret', attachment={'name': 'scan.pdf', 'mimetype': 'application/pdf', 'data': PDF})
        self.assertEqual(len(gone['attachments']), 1)
        deleted = self.api('DELETE', f"{path}/messages/{gone['id']}")
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertEqual((deleted.json()['mode'], deleted.json()['message']['deleted']), ('placeholder', True))
        rows = self._messages(path)
        self.assertEqual((rows[gone['id']]['body'], rows[gone['id']]['attachments'], rows[gone['id']]['deleted']), ('', [], True))
        self.assertFalse(rows[keep['id']]['deleted'])

    def test_permanent_mode_removes_the_message_for_everyone(self):
        self._set_mode('permanent')
        path = self._conversation()
        keep = self._send(path, body='stay')
        reply = self._send(path, body='answer', parent_id=keep['id'])
        deleted = self.api('DELETE', f"{path}/messages/{keep['id']}")
        self.assertEqual((deleted.status_code, deleted.json()), (200, {'mode': 'permanent', 'message': None}))
        rows = self._messages(path)
        self.assertNotIn(keep['id'], rows)
        self.assertIsNone(rows[reply['id']]['parent'])

    def test_only_the_author_deletes(self):
        path = self._conversation()
        mine = self._send(path, body='mine')
        self.authenticate('del_peer', 'del_peer_pass_123')
        self.assertEqual(self.api('DELETE', f"{path}/messages/{mine['id']}").status_code, 403)
        self.authenticate('del_manager', 'del_manager_pass_123')
        self.assertEqual(self.api('DELETE', f"{path}/messages/{mine['id']}").status_code, 403)
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('DELETE', f"{path}/messages/999999999").status_code, 404)

    def test_an_edit_cannot_empty_a_message(self):
        path = self._conversation()
        message = self._send(path, body='mine')
        refused = self.api('PATCH', f"{path}/messages/{message['id']}", {'body': '  '})
        self.assertEqual((refused.status_code, refused.json()['code'], refused.json()['field']), (422, 'invalid', 'body'))
        self.assertEqual(self._messages(path)[message['id']]['body'], 'mine')

    def test_a_deleted_row_cannot_be_revived_pinned_or_reacted_to_and_loses_its_pin_and_reactions(self):
        path = self._conversation()
        message = self._send(path, body='secret')
        url = f"{path}/messages/{message['id']}"
        self.assertEqual(self.api('POST', f'{url}/pin', {'pinned': True}).status_code, 200)
        self.assertEqual(self.api('POST', f'{url}/reactions', {'content': '👍', 'action': 'add'}).status_code, 200)
        self.assertEqual(self.api('DELETE', url).status_code, 200)
        row = self._messages(path)[message['id']]
        self.assertEqual((row['deleted'], row['pinned'], row['reactions']), (True, False, []))
        self.assertEqual(self.api('PATCH', url, {'body': 'back'}).status_code, 422)
        self.assertEqual(self.api('POST', f'{url}/pin', {'pinned': True}).status_code, 422)
        self.assertEqual(self.api('POST', f'{url}/reactions', {'content': '👍', 'action': 'add'}).status_code, 422)
