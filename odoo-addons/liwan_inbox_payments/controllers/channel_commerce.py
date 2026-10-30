# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import fields, http

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_inbox.adapters import whatsapp
from odoo.addons.liwan_inbox.controllers.helpers import get_channel, holds
from odoo.addons.liwan_inbox.models.access_service import REPLY
from odoo.addons.liwan_inbox_payments.adapters import meta_catalog
from odoo.addons.liwan_inbox_payments.controllers.parsing import (
    parse_commerce_patch,
    provider_failure,
)
from odoo.addons.liwan_inbox_payments.models.access_service import CATALOG_MANAGE
from odoo.addons.liwan_inbox_payments.models.constants import CATALOG_FEATURE
from odoo.addons.liwan_inbox_payments.serializers.catalog import dump_channel_commerce

_logger = logging.getLogger(__name__)


class ChannelCommerceController(http.Controller):

    @http.route('/api/v1/inbox/channels/<int:channel_id>/commerce', type='json2', auth='user', methods=['GET'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='read')
    @requires_capability(REPLY)
    def read_commerce(self, channel_id, **_):
        """The channel's catalog and Meta's cart and catalog button settings (refreshed by a catalog manager when stale)."""
        channel = get_channel(channel_id, REPLY)
        if channel._liwan_catalog() and holds(CATALOG_MANAGE, channel.owner_company_id):
            try:
                channel._liwan_read_commerce()
            except whatsapp.ProviderError as error:
                # The stored mirror is shown; the catalog sync records the provider error on the catalog.
                _logger.warning('commerce settings of channel %s not refreshed: %s', channel.id, type(error).__name__)
        return dump_channel_commerce(channel)

    @http.route('/api/v1/inbox/channels/<int:channel_id>/commerce', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='write')
    @requires_capability(CATALOG_MANAGE)
    def patch_commerce(self, channel_id, **payload):
        """Switch the cart and the catalog button at Meta first; nothing is kept when Meta refuses."""
        channel = get_channel(channel_id, CATALOG_MANAGE)
        flags, notice = parse_commerce_patch(payload)
        if flags:
            if not channel._liwan_catalog():
                raise ApiError(409, 'no_catalog', 'connect a catalog to this WhatsApp account first')
            try:
                meta_catalog.set_commerce_settings(channel._liwan_credentials(), **flags)
                if not channel.commerce_settings_read_at:
                    # A flag the body does not name must not be shown as off just because it was never read.
                    channel._liwan_read_commerce(force=True)
            except whatsapp.ProviderError as error:
                provider_failure(error)
            notice.update({
                'commerce_settings_read_at': fields.Datetime.now(),
                **{f'commerce_{key}': value for key, value in flags.items()},
            })
        channel.write(notice)
        return dump_channel_commerce(channel)
