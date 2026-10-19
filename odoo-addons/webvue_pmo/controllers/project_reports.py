# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.webvue_pmo.models.project_project import STATUS_VALUES
from odoo.addons.webvue_pmo.serializers.project_reports import (
    build_dashboard_summary,
    build_project_dashboard_analytics,
    today_utc,
)

SUMMARY_QUERY = {'q', 'status', 'mine'}


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
