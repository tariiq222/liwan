# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
)
from odoo.addons.nasq_pmo.models.project_finance import (
    NasqFinanceEntryLinked,
    NasqFinanceStaleWrite,
)
from odoo.addons.nasq_pmo.serializers.project_finance import (
    build_finance_summary,
    dump_finance_entry,
    parse_finance_create,
    parse_finance_patch,
)

LIST_QUERY = {'kind', 'q', 'limit', 'offset'}


def _finance_project(project_id):
    request.env['nasq.access.service']._nasq_require_capability('pmo.projects.read')
    project = get_record('project.project', project_id)
    project._nasq_check_visible_current()
    # Finance is explicitly out of scope for archived and company-less/legacy
    # projects: project.project's own rule_project_current_company allows a
    # company-less project through (`company_id in [company_id, False]`), so
    # this must be its own, stricter check - not just the base visibility one.
    if not project.active or project.company_id != request.env.company:
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
    entry = request.env['nasq.project.finance.entry'].search([
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
    def list_finance_entries(self, project_id, **_):
        project = _finance_project(project_id)
        args = request.httprequest.args
        kind, q, limit, offset = _parse_list_query(args)
        domain = [('project_id', '=', project.id)]
        if kind:
            domain.append(('kind', '=', kind))
        if q:
            domain.append(('title', 'ilike', q))
        Entry = request.env['nasq.project.finance.entry']
        entries = Entry.search(domain, order='id desc', limit=limit, offset=offset)
        return {
            'items': [dump_finance_entry(entry) for entry in entries],
            'total': Entry.search_count(domain),
            'can_manage': project._nasq_can_manage(),
            'summary': build_finance_summary(project),
        }

    @http.route('/api/v1/projects/<int:project_id>/finance/summary', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def get_finance_summary(self, project_id):
        project = _finance_project(project_id)
        return build_finance_summary(project)

    @http.route('/api/v1/projects/<int:project_id>/finance', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_finance_entry(self, project_id, **payload):
        payload.pop('project_id', None)
        project = _finance_project(project_id)
        vals = parse_finance_create(payload, project)
        entry = request.env['nasq.project.finance.entry'].create(vals)
        return request.make_json_response(dump_finance_entry(entry), status=201)

    @http.route(
        '/api/v1/projects/<int:project_id>/finance/<int:entry_id>',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    def get_finance_entry(self, project_id, entry_id):
        project = _finance_project(project_id)
        entry = _entry_of(project, entry_id)
        return dump_finance_entry(entry)

    @http.route(
        '/api/v1/projects/<int:project_id>/finance/<int:entry_id>',
        type='json2', auth='user', methods=['PATCH'], readonly=False,
    )
    @api_handler
    def patch_finance_entry(self, project_id, entry_id, **payload):
        payload.pop('project_id', None)
        payload.pop('entry_id', None)
        expected = _parse_revision_token(payload.pop('expected_updated_at', None))
        project = _finance_project(project_id)
        entry = _entry_of(project, entry_id)
        vals = parse_finance_patch(payload, entry)
        if not vals:
            raise ApiError(422, 'invalid', "no fields to update")
        try:
            entry._nasq_lock_for_write(expected)
        except NasqFinanceStaleWrite as e:
            raise ApiError(409, 'stale_write', str(e), field='expected_updated_at') from e
        entry.write(vals)
        return dump_finance_entry(entry)

    @http.route(
        '/api/v1/projects/<int:project_id>/finance/<int:entry_id>',
        type='json2', auth='user', methods=['DELETE'], readonly=False,
    )
    @api_handler
    def delete_finance_entry(self, project_id, entry_id, expected_updated_at=None, **_):
        expected = _parse_revision_token(expected_updated_at)
        project = _finance_project(project_id)
        entry = _entry_of(project, entry_id)
        try:
            entry._nasq_lock_for_write(expected)
        except NasqFinanceStaleWrite as e:
            raise ApiError(409, 'stale_write', str(e), field='expected_updated_at') from e
        try:
            entry.unlink()
        except NasqFinanceEntryLinked as e:
            raise ApiError(409, 'finance_entry_linked', str(e)) from e
        return {'deleted': True}
