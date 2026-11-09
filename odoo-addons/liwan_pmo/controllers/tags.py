# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)

# The datalist behind the tag picker. Its own page is 100 because the picker
# searches as the user types, not a full record list.
PICKER_PAGE_LIMIT = 100


def dump_tag(tag):
    return {'id': tag.id, 'name': tag.name, 'color': tag.color}


class TagController(http.Controller):

    @http.route('/api/v1/tags', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    @requires_capability('pmo.projects.read', 'pmo.tasks.read', match='any')
    def list_tags(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args, default=PICKER_PAGE_LIMIT)
        q = args.get('q')
        domain = [('name', 'ilike', q)] if q else []
        Tag = request.env['project.tags']
        return {
            'items': [
                dump_tag(tag)
                for tag in Tag.search(domain, order='name, id', limit=limit, offset=offset)
            ],
            'total': Tag.search_count(domain),
        }

    @http.route('/api/v1/tags', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def create_tag(self, name=None, **_):
        if not request.env['project.project']._liwan_is_manager():
            raise AccessError(request.env._("Only a project manager can create tags."))
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', "name must not be empty", field='name')
        name = name.strip()
        if request.env['project.tags'].search_count([('name', '=ilike', name)]):
            raise ApiError(422, 'invalid', "a tag with this name already exists", field='name')
        tag = request.env['project.tags'].create({'name': name})
        return request.make_json_response(dump_tag(tag), status=201)
