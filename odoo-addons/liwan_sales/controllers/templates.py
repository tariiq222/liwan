# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_sales.models.access_service import (
    QUOTATIONS_MANAGE,
    SETTINGS_MANAGE,
)
from odoo.addons.liwan_sales.serializers.template import (
    dump_template,
    dump_template_item,
    parse_template_body,
    parse_template_filters,
)

TEMPLATES = '/api/v1/sales/templates'


def _service():
    return request.env['liwan.sales.template']


def _detail(template):
    service = _service()
    return dump_template(template, service._liwan_can_manage(), service._liwan_usable_product_ids(template))


class SalesTemplatesController(http.Controller):
    """Quotation templates. The pick list and the detail are for whoever writes a quotation or manages templates; every
    write is the settings manager's (``sales.settings.manage`` in the working company)."""

    @http.route(TEMPLATES, type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('sales.enabled', operation='read')
    @requires_capability(QUOTATIONS_MANAGE, SETTINGS_MANAGE, match='any')
    def list_templates(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        query, archived = parse_template_filters(args)
        service = _service()
        found, total = service._liwan_search(query, archived, limit, offset)
        can_manage = service._liwan_can_manage()
        usable = service._liwan_usable_product_ids(found)
        return {'items': [dump_template_item(template, can_manage, usable) for template in found], 'total': total}

    @http.route(f'{TEMPLATES}/<int:template_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('sales.enabled', operation='read')
    @requires_capability(QUOTATIONS_MANAGE, SETTINGS_MANAGE, match='any')
    def get_template(self, template_id, **_):
        return _detail(_service()._liwan_template(template_id))

    @http.route(TEMPLATES, type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('sales.enabled', operation='write')
    @requires_capability(SETTINGS_MANAGE)
    def create_template(self, **payload):
        return _detail(_service()._liwan_create(parse_template_body(payload, True)))

    @http.route(f'{TEMPLATES}/<int:template_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('sales.enabled', operation='write')
    @requires_capability(SETTINGS_MANAGE)
    def update_template(self, template_id, **payload):
        return _detail(_service()._liwan_update(template_id, parse_template_body(payload, False)))

    @http.route([f'{TEMPLATES}/<int:template_id>/archive', f'{TEMPLATES}/<int:template_id>/restore'],
                type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('sales.enabled', operation='write')
    @requires_capability(SETTINGS_MANAGE)
    def move_template(self, template_id, **_):
        restore = request.httprequest.path.rsplit('/', 1)[1] == 'restore'
        return _detail(_service()._liwan_set_active(template_id, restore))
