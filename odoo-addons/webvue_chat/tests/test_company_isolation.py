# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Request-scoped company isolation for the webvue_chat /api/v1 record routes.

discuss.channel carries company_id and the strict current-company record rule
hides every other company's conversation, so the chat service answers its
"not a member" forbidden (403) on every vector — never a 404 and, once the
request company is pinned, never a 200. On main the forged cids cookie, query
or body context leaks the conversation, so the hidden cases here must fail
there and pass once the pin runs on every route.
"""
from odoo.fields import Command
from odoo.tests import tagged
from odoo.tests.common import HOST

from odoo.addons.webvue_api.tests.common import (
    CompanyIsolationCase,
    cover_isolation_routes,
)
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT

# Every GET /api/v1 route of this addon carrying an <int:...> record id. The
# list routes (/api/v1/chat/conversations, /api/v1/chat/recipients) carry no
# record id; the conversations list is exercised by the list test below.
COVERED = (
    '/api/v1/chat/conversations/<int:conversation_id>',
    '/api/v1/chat/conversations/<int:conversation_id>/messages',
    '/api/v1/chat/conversations/<int:conversation_id>/members',
    '/api/v1/chat/conversations/<int:conversation_id>/attachments',
    '/api/v1/chat/conversations/<int:conversation_id>/attachments/<int:attachment_id>/download',
)


@tagged('post_install', '-at_install', 'webvue')
class ChatCompanyIsolationCase(CompanyIsolationCase):
    """One group conversation per company with iso_user as its only member."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        profile = cls.env.ref('webvue_platform.tenant_profile')
        profile._webvue_initialize_legacy_policy(
            cls.env['webvue.feature.registry']._webvue_installed_module_ids(),
        )
        profile.with_context(**{OPERATOR_CONTEXT: True}).write(
            {'features': {**(profile.features or {}), 'chat.enabled': True}},
        )
        cls.all_companies = (cls.company_p, cls.company_p1, cls.company_p2, cls.company_c)
        cls.conversations = {}
        cls.attachments = {}
        for company in cls.all_companies:
            channel = cls.env['discuss.channel'].create({
                'name': f'Iso conversation {company.name}',
                'channel_type': 'group',
                'company_id': company.id,
                'channel_member_ids': [Command.create({'partner_id': cls.iso_user.partner_id.id})],
            })
            message = channel.message_post(
                body='Isolation message', message_type='comment',
                subtype_xmlid='mail.mt_comment',
                attachments=[('iso-notes.txt', b'isolation attachment')],
            )
            cls.conversations[company.id] = channel
            cls.attachments[company.id] = message.attachment_ids[0]

    def assert_status_every_way(self, path, hidden_company_id, status):
        """The plain call and the three cids forgeries all answer `status`."""
        for response in self.api_forged('GET', path, hidden_company_id):
            self.assertEqual(
                response.status_code, status,
                f'{path} must answer {status} under forgery: {response.text[:200]}',
            )

    def assert_conversation_matrix(self, route):
        """current=P: own and member-branch conversations 200; current=P1: own 200, others 403.

        The chat record rule follows the pinned company set, so a member
        branch's conversation is visible from the parent; anything outside the
        set is reported by the service as a missing membership (403).
        """
        for current in (self.company_p, self.company_p1):
            self.env_in(current)
            self.assertVisible(route(current))
            for company in self.all_companies:
                if company == current:
                    continue
                branch = current == self.company_p and company in (self.company_p1, self.company_p2)
                self.assert_status_every_way(route(company), company.id, 403 if not branch else 200)

    def test_conversation_record_is_company_scoped(self):
        self.assert_conversation_matrix(
            lambda company: f'/api/v1/chat/conversations/{self.conversations[company.id].id}')

    def test_conversation_messages_are_company_scoped(self):
        self.assert_conversation_matrix(
            lambda company: f'/api/v1/chat/conversations/{self.conversations[company.id].id}/messages')

    def test_conversation_members_are_company_scoped(self):
        self.assert_conversation_matrix(
            lambda company: f'/api/v1/chat/conversations/{self.conversations[company.id].id}/members')

    def test_conversation_attachments_are_company_scoped(self):
        self.assert_conversation_matrix(
            lambda company: f'/api/v1/chat/conversations/{self.conversations[company.id].id}/attachments')
        self.assert_conversation_matrix(lambda company: (
            f'/api/v1/chat/conversations/{self.conversations[company.id].id}'
            f'/attachments/{self.attachments[company.id].id}/download'
        ))

    def test_conversations_list_is_company_scoped(self):
        """The list follows the pinned company set: P reads its branches, P1 only itself."""
        for current, visible in (
            (self.company_p, (self.company_p, self.company_p1, self.company_p2)),
            (self.company_p1, (self.company_p1,)),
        ):
            self.env_in(current)
            listed = self.assertVisible('/api/v1/chat/conversations')
            ids = [item['id'] for item in listed.json()['items']]
            for company in visible:
                self.assertIn(self.conversations[company.id].id, ids)
            for company in self.all_companies:
                if company not in visible:
                    self.assertNotIn(self.conversations[company.id].id, ids)
        # A forged cids cookie must not widen the list either.
        self.opener.cookies.set('cids', f'{self.company_c.id}-{self.company_p.id}', domain=HOST, path='/')
        try:
            forged = self.api('GET', '/api/v1/chat/conversations')
        finally:
            self.opener.cookies.clear(domain=HOST, path='/', name='cids')
        self.assertEqual(forged.status_code, 200)
        self.assertNotIn(
            self.conversations[self.company_c.id].id,
            [item['id'] for item in forged.json()['items']],
        )


cover_isolation_routes(COVERED, 'webvue_chat/tests/test_company_isolation.py')
