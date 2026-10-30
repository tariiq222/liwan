# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import page_args, require
from odoo.addons.liwan_api.controllers.common import api_handler, requires_feature
from odoo.addons.liwan_documents.serializers.document import (
    dump_tag,
    parse_name,
    strict,
)


class Tags(http.Controller):
    @http.route(
        '/api/v1/documents/tags',
        type='json2',
        auth='user',
        methods=['GET'],
        readonly=True,
    )
    @api_handler
    @requires_feature('documents.enabled', operation='read')
    def tags(self, **kwargs):
        require('documents.items.read')
        args = request.httprequest.args
        limit, offset = page_args(args)
        domain = [('name', 'ilike', args['q'])] if args.get('q') else []
        model = request.env['dms.tag']
        return {
            'items': [
                dump_tag(tag)
                for tag in model.search(
                    domain, limit=limit, offset=offset, order='name,id',
                )
            ],
            'total': model.search_count(domain),
        }

    @http.route(
        '/api/v1/documents/tags',
        type='json2',
        auth='user',
        methods=['POST'],
        readonly=False,
    )
    @api_handler
    @requires_feature('documents.enabled', operation='write')
    def create_tag(self, **payload):
        require('documents.library.manage')
        strict(payload, {'name'})
        tag = request.env['dms.tag'].create({'name': parse_name(payload.get('name'))})
        return request.make_json_response(dump_tag(tag), status=201)
