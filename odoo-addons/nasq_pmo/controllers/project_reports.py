# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    parse_nonneg_int,
)
from odoo.addons.nasq_pmo.models.project_project import STATUS_VALUES
from odoo.addons.nasq_pmo.serializers.project_reports import (
    build_report_totals,
    dump_report_row,
    today_utc,
)

LIST_QUERY = {'q', 'status', 'limit', 'offset'}


def _parse_limit(value):
    parsed = parse_nonneg_int(value, 'limit')
    if parsed < 1 or parsed > 200:
        raise ApiError(422, 'invalid', "limit must be between 1 and 200", field='limit')
    return parsed


class ProjectReportsController(http.Controller):

    @http.route('/api/v1/reports/projects', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_project_reports(self, **_):
        request.env['nasq.access.service']._nasq_require_capability('pmo.projects.read')
        args = request.httprequest.args
        unknown = set(args) - LIST_QUERY
        if unknown:
            raise ApiError(400, 'unsupported_filter', f"unsupported query parameter {sorted(unknown)[0]!r}")
        status = args.get('status')
        if status is not None and status != 'unset' and status not in STATUS_VALUES:
            raise ApiError(
                422, 'invalid', f"status must be one of {sorted(STATUS_VALUES)} or 'unset'", field='status',
            )
        limit = _parse_limit(args.get('limit', 50))
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        q = (args.get('q') or '').strip()
        # Explicit active/current-company floor, not just project.project's
        # own _search restriction: reports must exclude archived and
        # company-less/foreign-company projects even for a caller (e.g. a
        # base.group_system admin who separately holds pmo.projects.read)
        # whose capability grant might otherwise widen visibility.
        domain = [('active', '=', True), ('company_id', '=', request.env.company.id)]
        if q:
            domain.append(('name', 'ilike', q))
        if status == 'unset':
            domain.append(('last_update_status', '=', 'to_define'))
        elif status:
            domain.append(('last_update_status', '=', status))
        Project = request.env['project.project']
        # No 200 cap here: totals must reflect every filtered, visible project,
        # not just the returned page (see docs/superpowers/specs/2026-09-07-
        # projects-phase2-design.md). Project.search already applies the live
        # pmo.projects.read + current-company + active + follower-visibility
        # floor via project.project's own _search override.
        all_projects = Project.search(domain, order='name, id')
        total = len(all_projects)
        page = all_projects[offset:offset + limit]
        today = today_utc()
        can_read_tasks = request.env['nasq.access.service']._nasq_has_capability(
            request.env.user, 'pmo.tasks.read',
        )
        return {
            'items': [dump_report_row(project, today, can_read_tasks) for project in page],
            'total': total,
            'totals': build_report_totals(all_projects),
        }
