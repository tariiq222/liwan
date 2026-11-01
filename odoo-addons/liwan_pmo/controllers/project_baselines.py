# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from .records import get_visible_record
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    declare_read_capability_scope,
    parse_page,
    require_capabilities,
    requires_feature,
)
from odoo.addons.liwan_pmo.models.project_baseline import (
    LiwanBaselineBusy,
    LiwanChangeUsed,
)
from odoo.addons.liwan_pmo.models.project_project import (
    LiwanChangeRequired,
    LiwanCharterState,
)
from odoo.addons.liwan_pmo.serializers.project_baseline import (
    build_variance,
    dump_baseline,
    dump_baseline_detail,
    parse_baseline_vals,
)

FEATURES = ('pmo.enabled', 'pmo.baselines')
LIST_QUERY = {'limit', 'offset'}


def _project(project_id):
    # Like the other governance registers, baselines stay out of reach of an archived project.
    project = get_visible_record('project.project', project_id)
    if not project.active:
        raise MissingError(request.env._("Record does not exist"))
    return project


def _baseline(project, number):
    baseline = request.env['liwan.project.baseline'].search([
        ('project_id', '=', project.id), ('number', '=', number),
    ], limit=1)
    if not baseline:
        raise MissingError(request.env._("Record does not exist"))
    return baseline


def _coverable_changes(project):
    """The approved requests a manager may link to a new baseline; empty while the caller cannot take one."""
    if not project._liwan_can_manage():
        return []
    changes = request.env['liwan.project.change'].search([('project_id', '=', project.id), ('state', '=', 'approved')])
    return [{'id': change.id, 'number': change.number, 'title': change.title} for change in changes]


class ProjectBaselineController(http.Controller):

    @http.route('/api/v1/projects/<int:project_id>/baselines', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(*FEATURES, operation='read')
    def list_baselines(self, project_id):
        require_capabilities('pmo.projects.read')
        declare_read_capability_scope('pmo.projects.read')
        project = _project(project_id)
        args = request.httprequest.args
        unknown = set(args) - LIST_QUERY
        if unknown:
            raise ApiError(400, 'unsupported_filter', f"unsupported query parameter {sorted(unknown)[0]!r}")
        limit, offset = parse_page(args)
        Baseline = request.env['liwan.project.baseline']
        domain = [('project_id', '=', project.id)]
        settings = request.env['liwan.pmo.settings']
        return {
            'items': [dump_baseline(baseline) for baseline in Baseline.search(domain, limit=limit, offset=offset)],
            'total': Baseline.search_count(domain),
            'can_take': project._liwan_can_manage(),
            'change_required': settings.change_control_mode() == 'required' and project.liwan_phase == 'executing',
            'coverable_changes': _coverable_changes(project),
        }

    @http.route('/api/v1/projects/<int:project_id>/baselines/variance', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(*FEATURES, operation='read')
    def get_variance(self, project_id):
        require_capabilities('pmo.projects.read')
        declare_read_capability_scope('pmo.projects.read')
        return build_variance(_project(project_id))

    @http.route('/api/v1/projects/<int:project_id>/baselines/<int:number>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(*FEATURES, operation='read')
    def get_baseline(self, project_id, number):
        require_capabilities('pmo.projects.read')
        declare_read_capability_scope('pmo.projects.read')
        return dump_baseline_detail(_baseline(_project(project_id), number))

    @http.route('/api/v1/projects/<int:project_id>/baselines', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(*FEATURES, operation='write')
    def take_baseline(self, project_id, **payload):
        require_capabilities('pmo.projects.read')
        payload.pop('project_id', None)
        project = _project(project_id)
        vals = parse_baseline_vals(payload)
        try:
            baseline = request.env['liwan.project.baseline'].create({**vals, 'project_id': project.id})
        except LiwanCharterState as error:
            raise ApiError(409, 'charter_state', str(error)) from error
        except LiwanChangeRequired as error:
            raise ApiError(409, 'change_required', str(error)) from error
        except LiwanChangeUsed as error:
            raise ApiError(409, 'change_already_used', str(error)) from error
        except LiwanBaselineBusy as error:
            raise ApiError(409, 'baseline_busy', str(error)) from error
        return request.make_json_response(dump_baseline_detail(baseline), status=201)
