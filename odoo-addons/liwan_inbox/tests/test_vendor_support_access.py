# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import PASSWORD, LiwanInboxCase


@tagged('post_install', '-at_install', 'liwan')
class TestVendorSupportAccess(LiwanInboxCase):
    """INB-18: vendor support runs the channels and the settings and never reads the customers' conversations."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.vendor = new_test_user(
            cls.env, login='inbox_vendor_support', password=PASSWORD, name='Vendor support',
            groups='liwan_core.group_vendor_support',
        )
        cls.conversation = cls.make_conversation()

    def test_reaches_channels_and_settings(self):
        self.login(self.vendor)
        self.assertEqual(self.get('/api/v1/inbox/channels').status_code, 200)
        self.assertEqual(self.get('/api/v1/settings/inbox').status_code, 200)

    def test_cannot_read_conversations(self):
        self.login(self.vendor)
        self.assertError(self.get('/api/v1/inbox/conversations'), 403, 'forbidden')
        self.assertError(self.get(f'/api/v1/inbox/conversations/{self.conversation.id}'), 403, 'forbidden')
        self.assertError(self.get(f'/api/v1/inbox/conversations/{self.conversation.id}/messages'), 403, 'forbidden')

    def test_every_other_inbox_action_is_refused(self):
        self.login(self.vendor)
        path = f'/api/v1/inbox/conversations/{self.conversation.id}'
        self.assertError(self.api('POST', f'{path}/messages', {'body': 'hi'}), 403, 'forbidden')
        self.assertError(self.patch_conversation(self.conversation, {'priority': 'high'}), 403, 'forbidden')
        self.assertEqual(self.get('/api/v1/inbox/conversations/export.csv').status_code, 403)
        self.assertError(self.get('/api/v1/inbox/reports/overview'), 403, 'forbidden')
