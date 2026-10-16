# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)

MAX_TAGS = 100


def dump_tag(tag):
    return {'id': tag.id, 'name': tag.name, 'color': tag.color}


class TagController(http.Controller):

    @http.route('/api/v1/tags', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def list_tags(self, **_):
        q = request.httprequest.args.get('q')
        domain = [('name', 'ilike', q)] if q else []
        return [dump_tag(t) for t in request.env['project.tags'].search(domain, order='name, id', limit=MAX_TAGS)]

    @http.route('/api/v1/tags', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def create_tag(self, name=None, **_):
        if not request.env['project.project']._webvue_is_manager():
            raise AccessError(request.env._("Only a project manager can create tags."))
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', "name must not be empty", field='name')
        name = name.strip()
        if request.env['project.tags'].search_count([('name', '=ilike', name)]):
            raise ApiError(422, 'invalid', "a tag with this name already exists", field='name')
        tag = request.env['project.tags'].create({'name': name})
        return request.make_json_response(dump_tag(tag), status=201)
