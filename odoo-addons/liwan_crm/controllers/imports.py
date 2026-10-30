# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_crm.models.distribution import agent_not_eligible
from odoo.addons.liwan_crm.serializers.imports import (
    columns_of,
    dump_batch,
    dump_mapping,
    mapping_values,
    parse_file_body,
    parse_import_body,
    parse_profile_body,
)

PROFILE_EXISTS = 'a mapping profile with this name already exists'
FEATURES = ('crm.enabled', 'crm.import')
IMPORT = 'crm.leads.import'
MODE_WITH_AGENT = 'on_import'


def _intake():
    return request.env['liwan.crm.intake']


def _profile_columns(profile_id):
    """The column map of a saved profile of the current company (404 when it is not there)."""
    return columns_of(get_record('liwan.crm.import.mapping', profile_id))


def _prepare(payload):
    """The parsed body, the choices that body makes, its column map and the file's rows.

    Preview and import share it, so a preview shows every error the import would.
    """
    parsed = parse_import_body(payload)
    mapping = parsed['mapping'] or _profile_columns(parsed['mapping_profile'])
    rows = _intake()._liwan_read_rows(parsed['file_name'], parsed['content'])
    return parsed, mapping, rows, _source(parsed['source_id']), _agent(parsed['user_id'])


def _source(source_id):
    source = request.env['utm.source'].search([('id', '=', source_id)], limit=1) if source_id else None
    if not source:
        raise ApiError(422, 'invalid', 'an active source is required', field='source_id')
    return source


def _agent(user_id):
    """The agent chosen for the whole batch; only the ``on_import`` mode takes one, and it needs one."""
    mode = request.env['liwan.crm.settings']._liwan_effective()['distribution_mode']
    if mode != MODE_WITH_AGENT:
        if user_id:
            raise ApiError(422, 'invalid', 'an agent is chosen only when distribution is set to on import', field='user_id')
        return request.env['res.users']
    if not user_id:
        raise ApiError(422, 'invalid', 'choose the agent who takes this batch', field='user_id')
    agent = request.env['liwan.crm.distribution']._liwan_eligible_agents(request.env.company).filtered(
        lambda user: user.id == user_id,
    )
    if not agent:
        raise agent_not_eligible()
    return agent


class CrmImportsController(http.Controller):

    @http.route('/api/v1/crm/imports/preview', type='json2', auth='user', methods=['POST'], readonly=True)
    @api_handler
    @requires_feature(*FEATURES, operation='write')
    @requires_capability(IMPORT)
    def preview_import(self, **payload):
        _, mapping, rows, _, _ = _prepare(payload)
        return _intake()._liwan_preview(rows, mapping, request.env.company)

    @http.route('/api/v1/crm/imports/columns', type='json2', auth='user', methods=['POST'], readonly=True)
    @api_handler
    @requires_feature(*FEATURES, operation='write')
    @requires_capability(IMPORT)
    def import_columns(self, **payload):
        parsed = parse_file_body(payload)
        rows = _intake()._liwan_read_rows(parsed['file_name'], parsed['content'])
        return {'columns': list(rows[0]), 'rows': len(rows)}

    @http.route('/api/v1/crm/imports', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(*FEATURES, operation='write')
    @requires_capability(IMPORT)
    def create_import(self, **payload):
        parsed, mapping, rows, source, agent = _prepare(payload)
        batch = _intake()._liwan_commit(
            rows, mapping, source, agent, request.env.company, request.env.user, file_name=parsed['file_name'],
        )
        return dump_batch(batch)

    @http.route('/api/v1/crm/imports', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(*FEATURES, operation='read')
    @requires_capability(IMPORT)
    def list_imports(self, **_):
        limit, offset = parse_page(request.httprequest.args)
        Batch = request.env['liwan.crm.import.batch']
        return {
            'items': [dump_batch(batch) for batch in Batch.search([], limit=limit, offset=offset)],
            'total': Batch.search_count([]),
        }

    @http.route('/api/v1/crm/import-mappings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(*FEATURES, operation='read')
    @requires_capability(IMPORT)
    def list_mappings(self, **_):
        limit, offset = parse_page(request.httprequest.args)
        Mapping = request.env['liwan.crm.import.mapping']
        return {
            'items': [dump_mapping(profile) for profile in Mapping.search([], limit=limit, offset=offset)],
            'total': Mapping.search_count([]),
        }

    @http.route('/api/v1/crm/import-mappings', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(*FEATURES, operation='write')
    @requires_capability(IMPORT)
    def create_mapping(self, **payload):
        parsed = parse_profile_body(payload)
        Mapping = request.env['liwan.crm.import.mapping']
        if Mapping.search_count([('name', '=', parsed['name'])], limit=1):
            raise ApiError(409, 'conflict', PROFILE_EXISTS, field='name')
        vals = {'company_id': request.env.company.id, 'name': parsed['name'], **mapping_values(parsed['columns'])}
        try:
            with request.env.cr.savepoint():
                profile = Mapping.create(vals)
        except UniqueViolation as error:
            raise ApiError(409, 'conflict', PROFILE_EXISTS, field='name') from error
        return dump_mapping(profile)

    @http.route('/api/v1/crm/import-mappings/<int:profile_id>', type='json2', auth='user', methods=['DELETE'],
                readonly=False)
    @api_handler
    @requires_feature(*FEATURES, operation='write')
    @requires_capability(IMPORT)
    def delete_mapping(self, profile_id, **_):
        profile = get_record('liwan.crm.import.mapping', profile_id)
        result = dump_mapping(profile)
        profile.unlink()
        return result
