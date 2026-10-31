# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    get_visible_record,
    parse_nonneg_int,
    require_capabilities,
    requires_feature,
)
from odoo.addons.liwan_pmo.models.project_finance import (
    LiwanFinanceEntryLinked,
    LiwanFinanceStaleWrite,
)
from odoo.addons.liwan_pmo.serializers.project_finance import (
    build_finance_summary,
    dump_finance_entry,
    parse_finance_create,
    parse_finance_patch,
)

LIST_QUERY = {'kind', 'q', 'limit', 'offset'}
ACTUAL_LINES_QUERY = {'limit', 'offset'}


def _finance_project(project_id):
    require_capabilities('pmo.projects.read')
    # get_record answers the uniform not-found for a foreign-company project
    # and lets the pinned record rules decide the rest; no duplicate company
    # check here. Finance stays out of scope for archived projects.
    project = get_visible_record('project.project', project_id)
    if not project.active:
        raise ApiError(404, 'not_found', "project not found")
    return project


def _entry_of(project, entry_id):
    """Coerce + authorise a finance entry id: it must belong to `project`.

    Searched in the caller's own env (no sudo), scoped by the id *and* the
    already access-checked `project.id`: an entry belonging to a different,
    possibly-foreign/hidden project simply fails the `project_id = X` leaf at
    the SQL level and the search returns empty, without ever needing to
    resolve that other project's own visibility - so there is no
    existence-oracle concern (unlike browsing the entry directly and then
    comparing `project_id`, which would hit the entry's own `_check_access`
    for the *foreign* project and turn a contracted 404 into a 403).
    """
    if isinstance(entry_id, bool) or not isinstance(entry_id, int) or entry_id <= 0:
        raise ApiError(404, 'not_found', "finance entry not found")
    entry = request.env['liwan.project.finance.entry'].search([
        ('id', '=', entry_id), ('project_id', '=', project.id),
    ], limit=1)
    if not entry:
        raise ApiError(404, 'not_found', "finance entry not found")
    return entry


def _parse_limit(value):
    parsed = parse_nonneg_int(value, 'limit')
    if parsed < 1 or parsed > 200:
        raise ApiError(422, 'invalid', "limit must be between 1 and 200", field='limit')
    return parsed


def _parse_list_query(args):
    unknown = set(args) - LIST_QUERY
    if unknown:
        raise ApiError(400, 'unsupported_filter', f"unsupported query parameter {sorted(unknown)[0]!r}")
    kind = args.get('kind')
    if kind is not None and kind not in ('budget', 'expense'):
        raise ApiError(422, 'invalid', "kind must be 'budget' or 'expense'", field='kind')
    limit = _parse_limit(args.get('limit', 50))
    offset = parse_nonneg_int(args.get('offset', 0), 'offset')
    q = (args.get('q') or '').strip()
    return kind, q, limit, offset


def _parse_revision_token(value):
    if not isinstance(value, str) or not value.startswith('v') or not value[1:].isdigit():
        raise ApiError(422, 'invalid', "expected_updated_at is not a valid write token", field='expected_updated_at')
    return value


class ProjectFinanceController(http.Controller):

    @http.route('/api/v1/projects/<int:project_id>/finance', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def list_finance_entries(self, project_id, **_):
        project = _finance_project(project_id)
        args = request.httprequest.args
        kind, q, limit, offset = _parse_list_query(args)
        domain = [('project_id', '=', project.id)]
        if request.env['liwan.project.actual.source']._liwan_is_external(project):
            # The actual cost is the external source's: only the planned budget stays a manual entry.
            domain.append(('kind', '=', 'budget'))
        if kind:
            domain.append(('kind', '=', kind))
        if q:
            domain.append(('title', 'ilike', q))
        Entry = request.env['liwan.project.finance.entry']
        entries = Entry.search(domain, order='id desc', limit=limit, offset=offset)
        return {
            'items': [dump_finance_entry(entry) for entry in entries],
            'total': Entry.search_count(domain),
            'can_manage': project._liwan_can_manage(),
            'summary': build_finance_summary(project),
        }

    @http.route('/api/v1/projects/<int:project_id>/finance/summary', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def get_finance_summary(self, project_id):
        project = _finance_project(project_id)
        return build_finance_summary(project)

    @http.route('/api/v1/projects/<int:project_id>/finance', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def create_finance_entry(self, project_id, **payload):
        payload.pop('project_id', None)
        project = _finance_project(project_id)
        vals = parse_finance_create(payload, project)
        entry = request.env['liwan.project.finance.entry'].create(vals)
        return request.make_json_response(dump_finance_entry(entry), status=201)

    @http.route(
        '/api/v1/projects/<int:project_id>/finance/actual-lines',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def list_actual_lines(self, project_id, **_):
        project = _finance_project(project_id)
        source = request.env['liwan.project.actual.source']
        if not source._liwan_is_external(project):
            raise ApiError(404, 'not_found', "project has no external actual cost")
        if not source._liwan_can_read_actual_lines(project):
            raise AccessError(request.env._("You are not allowed to read the lines of the actual cost."))
        args = request.httprequest.args
        unknown = set(args) - ACTUAL_LINES_QUERY
        if unknown:
            raise ApiError(400, 'unsupported_filter', f"unsupported query parameter {sorted(unknown)[0]!r}")
        limit = _parse_limit(args.get('limit', 50))
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        items, total = source._liwan_actual_lines(project, limit, offset)
        return {'items': items, 'total': total}

    @http.route(
        '/api/v1/projects/<int:project_id>/finance/actual-account',
        type='json2', auth='user', methods=['PATCH'], readonly=False,
    )
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def patch_actual_account(self, project_id, **payload):
        payload.pop('project_id', None)
        unknown = set(payload) - {'account_id'}
        if unknown:
            field = sorted(unknown)[0]
            raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
        account_id = payload.get('account_id', False)
        if account_id is not None and (isinstance(account_id, bool) or not isinstance(account_id, int) or account_id <= 0):
            raise ApiError(422, 'invalid', "account_id must be a positive integer or null", field='account_id')
        project = _finance_project(project_id)
        # Who may link a cost center is the actual source's rule (the finance bridge asks for
        # finance.analytic.manage), not the project manager's: the finance owner links it.
        request.env['liwan.project.actual.source']._liwan_set_actual_account(project, account_id)
        return build_finance_summary(project)

    @http.route(
        '/api/v1/projects/<int:project_id>/finance/<int:entry_id>',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def get_finance_entry(self, project_id, entry_id):
        project = _finance_project(project_id)
        entry = _entry_of(project, entry_id)
        return dump_finance_entry(entry)

    @http.route(
        '/api/v1/projects/<int:project_id>/finance/<int:entry_id>',
        type='json2', auth='user', methods=['PATCH'], readonly=False,
    )
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def patch_finance_entry(self, project_id, entry_id, **payload):
        # The path ids shadow same-named body keys, so a body that names them is read from the raw body.
        for key in ('project_id', 'entry_id'):
            if key in request.get_json_data():
                raise ApiError(422, 'unknown_field', f"field {key!r} cannot be changed", field=key)
        expected = _parse_revision_token(payload.pop('expected_updated_at', None))
        project = _finance_project(project_id)
        entry = _entry_of(project, entry_id)
        vals = parse_finance_patch(payload, entry)
        if not vals:
            raise ApiError(422, 'invalid', "no fields to update")
        try:
            entry._liwan_lock_for_write(expected)
        except LiwanFinanceStaleWrite as e:
            raise ApiError(409, 'stale_write', str(e), field='expected_updated_at') from e
        entry.write(vals)
        return dump_finance_entry(entry)

    @http.route(
        '/api/v1/projects/<int:project_id>/finance/<int:entry_id>',
        type='json2', auth='user', methods=['DELETE'], readonly=False,
    )
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def delete_finance_entry(self, project_id, entry_id, expected_updated_at=None, **_):
        expected = _parse_revision_token(expected_updated_at)
        project = _finance_project(project_id)
        entry = _entry_of(project, entry_id)
        try:
            entry._liwan_lock_for_write(expected)
        except LiwanFinanceStaleWrite as e:
            raise ApiError(409, 'stale_write', str(e), field='expected_updated_at') from e
        try:
            entry.unlink()
        except LiwanFinanceEntryLinked as e:
            raise ApiError(409, 'finance_entry_linked', str(e)) from e
        return {'deleted': True}
