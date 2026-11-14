# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.tests.tenant_export_support import (
    assert_contribution,
    datasets_by_key,
)

KEYS = (
    'inbox_channels', 'inbox_contacts', 'inbox_conversations', 'inbox_messages', 'inbox_templates', 'inbox_campaigns',
    'inbox_campaign_recipients', 'inbox_settings',
)


@tagged('post_install', '-at_install', 'liwan')
class TestInboxTenantExport(TransactionCase):

    def test_the_datasets_read_and_hold_no_channel_credential(self):
        assert_contribution(self, KEYS, {'inbox_channels': ('id', 'name', 'kind', 'state')})
        header = datasets_by_key(self.env)['inbox_channels']['header']
        for secret in ('access_token_enc', 'app_secret_enc', 'verify_token_enc'):
            self.assertNotIn(secret, header)

    def test_messages_carry_their_files(self):
        self.assertTrue(datasets_by_key(self.env)['inbox_messages']['attachments'])
