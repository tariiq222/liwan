# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo import Command, http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_crm.serializers.lists import (
    NAME_FIELDS,
    OUTCOME_FIELDS,
    STAGE_FIELDS,
    dump_lost_reason,
    dump_outcome,
    dump_package,
    dump_source,
    dump_stage,
    parse_active_filter,
    parse_body,
    parse_order,
    parse_package_body,
)

SEQUENCE_STEP = 10
PROTECTED_REASON = 'liwan_crm.lost_reason_attempts_exhausted'
SOURCE_EXISTS = 'a source with this name already exists'
READ = ('crm.settings.read', 'crm.leads.read')


def _list(model, domain, dump):
    """`{items, total}` of `model`: active rows unless `?active=false|all` asks for archived ones."""
    active = parse_active_filter(request.httprequest.args)
    if active is not None:
        domain = [*domain, ('active', '=', active)]
    limit, offset = parse_page(request.httprequest.args)
    records = model.with_context(active_test=False)
    return {
        'items': [dump(record) for record in records.search(domain, limit=limit, offset=offset)],
        'total': records.search_count(domain),
    }


def _next_sequence(model):
    last = model.with_context(active_test=False).search([], order='sequence desc', limit=1)
    return (last.sequence if last else 0) + SEQUENCE_STEP


def _stage_one_won():
    if request.env['crm.stage'].search_count([('is_won', '=', True)]) != 1:
        raise ApiError(422, 'invalid', 'exactly one active stage must be the won stage', field='is_won')


def _stage_open_first(field):
    """422 unless the first active stage is open: new opportunities start there, so the won stage cannot lead."""
    first = request.env['crm.stage'].search([], limit=1)
    if not first or first.is_won:
        raise ApiError(422, 'invalid', 'the first stage must be an open stage', field=field)


def _unflag_other_won(keep=None):
    """Move the won flag off the other won stage; refused while it holds opportunities (their closed deals would reopen)."""
    others = request.env['crm.stage'].search([('is_won', '=', True), ('id', '!=', keep.id if keep else 0)])
    if others._liwan_has_opportunities():
        raise ApiError(422, 'invalid', 'the current won stage still has opportunities', field='is_won')
    others.write({'is_won': False})


def _check_lost_reason_exists(vals):
    reason_id = vals.get('lost_reason_id')
    if reason_id and not request.env['crm.lost.reason'].with_context(active_test=False).browse(reason_id).exists():
        raise ApiError(422, 'invalid', 'lost reason does not exist', field='lost_reason_id')


def is_protected_reason(reason):
    return reason == request.env.ref(PROTECTED_REASON)


def _reject_source_name_taken(name, keep=None):
    """409 when another source, archived ones included, has this name in any letter case."""
    domain = [('name', 'ilike', name)] + ([('id', '!=', keep.id)] if keep else [])
    clashes = request.env['utm.source'].with_context(active_test=False).search(domain)
    if any(source.name.casefold() == name.casefold() for source in clashes):
        raise ApiError(409, 'conflict', SOURCE_EXISTS, field='name')


class CrmListsController(http.Controller):

    # Stages

    @http.route('/api/v1/crm/stages', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', operation='read')
    @requires_capability(*READ, match='any')
    def list_stages(self, **_):
        return _list(request.env['crm.stage'], [], dump_stage)

    @http.route('/api/v1/crm/stages', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.settings.manage')
    def create_stage(self, **payload):
        vals = parse_body(payload, STAGE_FIELDS, creating=True)
        if vals.get('is_won'):
            _unflag_other_won()
        stage = request.env['crm.stage'].create({**vals, 'sequence': _next_sequence(request.env['crm.stage'])})
        _stage_one_won()
        return dump_stage(stage)

    @http.route('/api/v1/crm/stages/order', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.settings.manage')
    def order_stages(self, **payload):
        ids = parse_order(payload)
        stages = request.env['crm.stage'].search([])
        if sorted(ids) != sorted(stages.ids):
            raise ApiError(422, 'invalid', 'ids must list every active stage exactly once', field='ids')
        for position, stage in enumerate(stages.browse(ids), start=1):
            stage.sequence = position * SEQUENCE_STEP
        _stage_open_first('ids')
        return _list(request.env['crm.stage'], [], dump_stage)

    @http.route('/api/v1/crm/stages/<int:stage_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.settings.manage')
    def patch_stage(self, stage_id, **payload):
        return self._write_stage(get_record('crm.stage', stage_id), parse_body(payload, STAGE_FIELDS, creating=False))

    @http.route('/api/v1/crm/stages/<int:stage_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.settings.manage')
    def archive_stage(self, stage_id, **_):
        return self._write_stage(get_record('crm.stage', stage_id), {'active': False})

    @staticmethod
    def _write_stage(stage, vals):
        if vals.get('active') is False and stage.active and stage._liwan_has_opportunities():
            raise ApiError(422, 'invalid', 'the stage still has opportunities', field='id')
        if vals.get('is_won'):
            _unflag_other_won(keep=stage)
        stage.write(vals)
        _stage_one_won()
        _stage_open_first('is_won' if vals.get('is_won') else 'active')
        return dump_stage(stage)

    # Call outcomes

    @http.route('/api/v1/crm/outcomes', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', operation='read')
    @requires_capability(*READ, match='any')
    def list_outcomes(self, **_):
        return _list(request.env['liwan.crm.call.outcome'], [], dump_outcome)

    @http.route('/api/v1/crm/outcomes', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.settings.manage')
    def create_outcome(self, **payload):
        vals = parse_body(payload, OUTCOME_FIELDS, creating=True)
        _check_lost_reason_exists(vals)
        model = request.env['liwan.crm.call.outcome']
        return dump_outcome(model.create({**vals, 'sequence': _next_sequence(model)}))

    @http.route('/api/v1/crm/outcomes/<int:outcome_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.settings.manage')
    def patch_outcome(self, outcome_id, **payload):
        outcome = get_record('liwan.crm.call.outcome', outcome_id)
        vals = parse_body(payload, OUTCOME_FIELDS, creating=False)
        _check_lost_reason_exists(vals)
        if vals.get('effect', 'lost') != 'lost':
            vals.setdefault('lost_reason_id', False)
        outcome.write(vals)
        return dump_outcome(outcome)

    @http.route('/api/v1/crm/outcomes/<int:outcome_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.settings.manage')
    def archive_outcome(self, outcome_id, **_):
        outcome = get_record('liwan.crm.call.outcome', outcome_id)
        outcome.active = False
        return dump_outcome(outcome)

    # Lost reasons

    @http.route('/api/v1/crm/lost-reasons', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', operation='read')
    @requires_capability(*READ, match='any')
    def list_lost_reasons(self, **_):
        return _list(request.env['crm.lost.reason'], [], lambda reason: dump_lost_reason(reason, is_protected_reason(reason)))

    @http.route('/api/v1/crm/lost-reasons', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.settings.manage')
    def create_lost_reason(self, **payload):
        reason = request.env['crm.lost.reason'].create(parse_body(payload, NAME_FIELDS, creating=True))
        return dump_lost_reason(reason, False)

    @http.route('/api/v1/crm/lost-reasons/<int:reason_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.settings.manage')
    def patch_lost_reason(self, reason_id, **payload):
        return self._write_lost_reason(get_record('crm.lost.reason', reason_id), parse_body(payload, NAME_FIELDS, creating=False))

    @http.route('/api/v1/crm/lost-reasons/<int:reason_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.settings.manage')
    def archive_lost_reason(self, reason_id, **_):
        return self._write_lost_reason(get_record('crm.lost.reason', reason_id), {'active': False})

    @staticmethod
    def _write_lost_reason(reason, vals):
        if vals.get('active') is False:
            if is_protected_reason(reason):
                raise ApiError(422, 'invalid', 'this lost reason is used by the system and cannot be archived', field='active')
            if request.env['liwan.crm.call.outcome'].search_count([('lost_reason_id', '=', reason.id)]):
                raise ApiError(422, 'invalid', 'an active call outcome uses this lost reason', field='active')
        reason.write(vals)
        return dump_lost_reason(reason, is_protected_reason(reason))

    # Sources

    @http.route('/api/v1/crm/sources', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', operation='read')
    @requires_capability(*READ, match='any')
    def list_sources(self, **_):
        return _list(request.env['utm.source'], [], dump_source)

    @http.route('/api/v1/crm/sources', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.settings.manage')
    def create_source(self, **payload):
        vals = parse_body(payload, NAME_FIELDS, creating=True)
        sources = request.env['utm.source']
        # Stock create renames a clash with an active source only; an archived one would hit the unique index.
        _reject_source_name_taken(vals['name'])
        return dump_source(self._save_source(lambda: sources.create(vals)))

    @http.route('/api/v1/crm/sources/<int:source_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.settings.manage')
    def patch_source(self, source_id, **payload):
        source = get_record('utm.source', source_id)
        vals = parse_body(payload, NAME_FIELDS, creating=False)
        if 'name' in vals:
            _reject_source_name_taken(vals['name'], keep=source)
        return self._write_source(source, vals)

    @http.route('/api/v1/crm/sources/<int:source_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.settings.manage')
    def archive_source(self, source_id, **_):
        return self._write_source(get_record('utm.source', source_id), {'active': False})

    @staticmethod
    def _write_source(source, vals):
        CrmListsController._save_source(lambda: source.write(vals))
        return dump_source(source)

    @staticmethod
    def _save_source(save):
        try:
            with request.env.cr.savepoint():
                return save()
        except UniqueViolation as error:
            raise ApiError(409, 'conflict', SOURCE_EXISTS, field='name') from error

    # Packages: the products the company offers, picked from the shared products service (plan D13)

    @http.route('/api/v1/crm/packages', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', operation='read')
    @requires_capability(*READ, match='any')
    def list_packages(self, **_):
        packages = request.env['liwan.crm.settings']._liwan_packages(archived=True)
        return _list(request.env['product.template'], [('id', 'in', packages.ids)], dump_package)

    @http.route('/api/v1/crm/packages', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.settings.manage')
    def add_package(self, **payload):
        product = request.env['liwan.products.service']._liwan_pick_product(parse_package_body(payload))
        if product.company_id and product.company_id != request.env.company:
            raise ApiError(422, 'invalid', 'this product belongs to another company', field='product_id')
        try:
            with request.env.cr.savepoint():
                request.env['liwan.crm.settings']._liwan_current_or_create().package_ids = [Command.link(product.id)]
        except UniqueViolation as error:
            raise ApiError(409, 'conflict', 'CRM settings changed; try again') from error
        return dump_package(product)

    @http.route('/api/v1/crm/packages/<int:package_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.settings.manage')
    def remove_package(self, package_id, **_):
        settings = request.env['liwan.crm.settings']
        package = settings._liwan_packages(archived=True).filtered(lambda product: product.id == package_id)
        if not package:
            raise ApiError(404, 'not_found', 'Record does not exist')
        settings._liwan_current().with_context(active_test=False).package_ids = [Command.unlink(package.id)]
        return dump_package(package)
