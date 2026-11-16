# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_sales.models.access_service import READ, SETTINGS_MANAGE
from odoo.addons.liwan_sales.serializers.settings import (
    dump_presets,
    dump_settings,
    parse_settings_patch,
)


def dump_current():
    settings = request.env['liwan.sales.settings']
    return dump_settings(settings._liwan_current(), settings._liwan_can_manage())


class SalesSettingsController(http.Controller):

    @http.route('/api/v1/sales/settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('sales.enabled', operation='read')
    @requires_capability(READ, SETTINGS_MANAGE, match='any')
    def read_settings(self, **_):
        return dump_current()

    @http.route('/api/v1/sales/settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('sales.enabled', operation='write')
    @requires_capability(SETTINGS_MANAGE)
    def write_settings(self, **payload):
        settings = request.env['liwan.sales.settings']
        values, revision = parse_settings_patch(payload, settings._liwan_patch_parsers())
        settings._liwan_current()._liwan_apply(values, revision)
        return dump_current()

    @http.route('/api/v1/sales/settings/presets', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('sales.enabled', operation='read')
    @requires_capability(SETTINGS_MANAGE)
    def read_presets(self, **_):
        """The sector presets: structured values the caller applies with an ordinary ``PATCH /settings``."""
        return dump_presets(request.env['liwan.sales.settings']._liwan_current())
