# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2 import IntegrityError

from odoo import http
from odoo.exceptions import AccessError, MissingError, UserError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    parse_nonneg_int,
)
from odoo.addons.nasq_pmo.serializers.project_charter import dump_currency
from odoo.addons.nasq_pmo.serializers.project_charter_reference import (
    CATALOG_RESOURCES,
    dump_catalog_item,
    parse_catalog_create,
    parse_catalog_patch,
)

MAX_LIMIT = 100


class ProjectCharterCatalogController(http.Controller):

    @http.route('/api/v1/project-charter/defaults', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def get_defaults(self, **_):
        Catalog = request.env['nasq.project.type']
        if not Catalog._nasq_can_read_catalog():
            raise AccessError(request.env._("You are not allowed to read project charter defaults."))
        return {'currency': dump_currency(request.env.company.currency_id)}

    @http.route(
        '/api/v1/project-charter/catalogs/<string:resource>',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    def list_catalog(self, resource, **_):
        Model = _catalog_model(resource)
        args = request.httprequest.args
        unknown = set(args) - {'q', 'active', 'offset', 'limit'}
        if unknown:
            raise ApiError(400, 'unsupported_filter', f"unsupported query parameter {sorted(unknown)[0]!r}")
        active = args.get('active', '1')
        if active not in ('1', '0', 'all'):
            raise ApiError(422, 'invalid', "active must be '1', '0' or 'all'", field='active')
        if active in ('0', 'all') and not Model._nasq_can_manage_catalog():
            raise AccessError(request.env._("Only a settings manager can list inactive catalog values."))
        limit = min(parse_nonneg_int(args.get('limit', 50), 'limit'), MAX_LIMIT)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        domain = [('company_id', '=', request.env.company.id)]
        q = args.get('q')
        if q:
            domain.append(('name', 'ilike', q))
        if active == '1':
            domain.append(('active', '=', True))
        elif active == '0':
            domain.append(('active', '=', False))
        records = Model.with_context(active_test=False).search(
            domain, order='sequence, id', limit=limit, offset=offset,
        )
        total = Model.with_context(active_test=False).search_count(domain)
        return {'items': [dump_catalog_item(record) for record in records], 'total': total}

    @http.route(
        '/api/v1/project-charter/catalogs/<string:resource>',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    def create_catalog(self, resource, **payload):
        Model = _catalog_model(resource)
        vals = parse_catalog_create(payload)
        record = Model.create(vals)
        return request.make_json_response(dump_catalog_item(record), status=201)

    @http.route(
        '/api/v1/project-charter/catalogs/<string:resource>/<int:item_id>',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    def get_catalog_item(self, resource, item_id, **_):
        record = _get_catalog_record(resource, item_id)
        if not record.active and not record._nasq_can_manage_catalog():
            raise MissingError(request.env._("catalog value does not exist"))
        return dump_catalog_item(record)

    @http.route(
        '/api/v1/project-charter/catalogs/<string:resource>/<int:item_id>',
        type='json2', auth='user', methods=['PATCH'], readonly=False,
    )
    @api_handler
    def patch_catalog_item(self, resource, item_id, **payload):
        payload.pop('item_id', None)
        payload.pop('resource', None)
        record = _get_catalog_record(resource, item_id)
        record.write(parse_catalog_patch(payload))
        return dump_catalog_item(record)

    @http.route(
        '/api/v1/project-charter/catalogs/<string:resource>/<int:item_id>',
        type='json2', auth='user', methods=['DELETE'], readonly=False,
    )
    @api_handler
    def delete_catalog_item(self, resource, item_id, **_):
        record = _get_catalog_record(resource, item_id)
        try:
            with request.env.cr.savepoint():
                record.unlink()
        except UserError as error:
            if getattr(error, 'nasq_code', None) == 'conflict':
                raise ApiError(409, 'conflict', str(error)) from error
            raise
        except IntegrityError as error:
            raise ApiError(409, 'conflict', "This catalog value is still in use.") from error
        return {'deleted': True}


def _catalog_model(resource):
    model_name = CATALOG_RESOURCES.get(resource)
    if not model_name:
        raise ApiError(404, 'not_found', "catalog resource not found")
    return request.env[model_name]


def _get_catalog_record(resource, item_id):
    Model = _catalog_model(resource)
    record = Model.with_context(active_test=False).browse(int(item_id)).exists()
    if not record:
        raise MissingError(request.env._("catalog value does not exist"))
    record.check_access('read')
    if record.company_id != request.env.company:
        raise AccessError(request.env._("Catalog record is outside the current company."))
    return record
