# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_nonneg_int,
    requires_feature,
)
from odoo.addons.webvue_pmo.models.project_project import STATUS_VALUES
from odoo.addons.webvue_pmo.serializers.project_reports import (
    build_dashboard_summary,
    build_project_dashboard_analytics,
    build_report_totals,
    dump_report_row,
    today_utc,
)

LIST_QUERY = {'q', 'status', 'limit', 'offset'}
SUMMARY_QUERY = {'q', 'status', 'mine'}


def _parse_limit(value):
    parsed = parse_nonneg_int(value, 'limit')
    if parsed < 1 or parsed > 200:
        raise ApiError(422, 'invalid', "limit must be between 1 and 200", field='limit')
    return parsed


class ProjectReportsController(http.Controller):

    def _project_report_domain(self, args, allowed_query):
        unknown = set(args) - allowed_query
        if unknown:
            raise ApiError(400, 'unsupported_filter', f"unsupported query parameter {sorted(unknown)[0]!r}")
        status = args.get('status')
        if status is not None and status != 'unset' and status not in STATUS_VALUES:
            raise ApiError(
                422, 'invalid', f"status must be one of {sorted(STATUS_VALUES)} or 'unset'", field='status',
            )
        mine = args.get('mine')
        if mine is not None and mine not in ('1', 'true', '0', 'false'):
            raise ApiError(422, 'invalid', "mine must be '1', 'true', '0' or 'false'", field='mine')
        q = (args.get('q') or '').strip()
        domain = [('active', '=', True), ('company_id', '=', request.env.company.id)]
        if mine in ('1', 'true'):
            domain.append(('user_id', '=', request.env.uid))
        if q:
            domain.append(('name', 'ilike', q))
        if status == 'unset':
            domain.append(('last_update_status', '=', 'to_define'))
        elif status:
            domain.append(('last_update_status', '=', status))
        return domain

    @http.route('/api/v1/reports/projects', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def list_project_reports(self, **_):
        request.env['webvue.access.service']._webvue_require_capability('pmo.projects.read')
        args = request.httprequest.args
        domain = self._project_report_domain(args, LIST_QUERY)
        limit = _parse_limit(args.get('limit', 50))
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        # No 200 cap here: totals must reflect every filtered, visible project,
        # not just the returned page (see docs/superpowers/specs/2026-09-07-
        # projects-phase2-design.md). Project.search already applies the live
        # pmo.projects.read + current-company + active + follower-visibility
        # floor via project.project's own _search override.
        all_projects = request.env['project.project'].search(domain, order='name, id')
        total = len(all_projects)
        page = all_projects[offset:offset + limit]
        today = today_utc()
        can_read_tasks = request.env['webvue.access.service']._webvue_has_capability(
            request.env.user, 'pmo.tasks.read',
        )
        return {
            'items': [dump_report_row(project, today, can_read_tasks) for project in page],
            'total': total,
            'totals': build_report_totals(all_projects),
        }

    @http.route('/api/v1/reports/projects/summary', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def project_dashboard_summary(self, **_):
        request.env['webvue.access.service']._webvue_require_capability('pmo.projects.read')
        domain = self._project_report_domain(request.httprequest.args, SUMMARY_QUERY)
        projects = request.env['project.project'].search(domain, order='name, id')
        can_read_tasks = request.env['webvue.access.service']._webvue_has_capability(
            request.env.user, 'pmo.tasks.read',
        )
        return build_dashboard_summary(projects, today_utc(), can_read_tasks)

    @http.route('/api/v1/reports/projects/analytics', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def project_dashboard_analytics(self, **_):
        request.env['webvue.access.service']._webvue_require_capability('pmo.projects.read')
        domain = self._project_report_domain(request.httprequest.args, SUMMARY_QUERY)
        projects = request.env['project.project'].search(domain, order='name, id')
        can_read_tasks = request.env['webvue.access.service']._webvue_has_capability(
            request.env.user, 'pmo.tasks.read',
        )
        return build_project_dashboard_analytics(projects, today_utc(), can_read_tasks)
