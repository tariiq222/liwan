# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The uses the inbox makes of a provider connection: a WhatsApp channel holds a Meta account, a TikTok channel a TikTok one."""
from odoo import api, models

from .constants import (
    CHANNEL_FEATURES,
    CHANNEL_USES,
    HOOK_PATHS,
    TIKTOK_REQUIRED_SCOPES,
)

OWNER = 'liwan_inbox'
USE_PROVIDERS = {'whatsapp': 'meta', 'tiktok': 'tiktok'}
USE_SCOPES = {'whatsapp': (), 'tiktok': TIKTOK_REQUIRED_SCOPES}


class LiwanInboxIntegrationRegistry(models.AbstractModel):
    _inherit = 'liwan.integration.registry'

    @api.model
    def _liwan_use_definitions(self):
        return (*super()._liwan_use_definitions(), *(
            {
                'key': CHANNEL_USES[kind], 'provider': USE_PROVIDERS[kind], 'owner': OWNER,
                'feature_key': CHANNEL_FEATURES[kind], 'scopes': USE_SCOPES[kind], 'webhook_path': HOOK_PATHS[kind],
            }
            for kind in CHANNEL_USES
        ))

    @api.model
    def _liwan_connection_uses(self, connection):
        """The uses of the channels that hold ``connection``.

        Read with SQL on the inbox's own table: a channel is visible only to the inbox capabilities, and an
        integrations administrator without them must still be refused the removal of an account a channel uses.
        """
        self.env['liwan.inbox.channel'].flush_model(['connection_id', 'kind'])
        self.env.cr.execute(
            'SELECT DISTINCT kind FROM liwan_inbox_channel WHERE connection_id = %s ORDER BY kind', [connection.id],
        )
        return (*super()._liwan_connection_uses(connection), *(CHANNEL_USES[kind] for kind, in self.env.cr.fetchall()))
