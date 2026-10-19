# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import page_args, require
from odoo.addons.webvue_api.controllers.common import (
    api_handler,
    parse_positive_int,
    requires_feature,
)


class Contexts(http.Controller):
    @http.route(
        '/api/v1/documents/contexts',
        type='json2',
        auth='user',
        methods=['GET'],
        readonly=True,
    )
    @api_handler
    @requires_feature('documents.enabled', operation='read')
    def contexts(self, **kwargs):
        require('documents.items.read')
        definitions = request.env['webvue.document.links']._webvue_context_definitions()
        locale = 'ar' if (request.env.lang or '').startswith('ar') else 'en'
        items = [
            {'kind': item['kind'], 'label': item['name_' + locale]}
            for item in definitions
            if item.get('available', True)
        ]
        return {'items': items, 'total': len(items)}

    @http.route(
        '/api/v1/documents/contexts/<string:kind>/options',
        type='json2',
        auth='user',
        methods=['GET'],
        readonly=True,
    )
    @api_handler
    @requires_feature('documents.enabled', operation='read')
    def options(self, kind, **kwargs):
        require('documents.items.manage')
        args = request.httprequest.args
        limit, offset = page_args(args)
        return request.env['webvue.document.links']._webvue_context_options(
            kind, args.get('q'), limit, offset,
            record_id=parse_positive_int(args['id'], 'id') if 'id' in args else None,
        )
