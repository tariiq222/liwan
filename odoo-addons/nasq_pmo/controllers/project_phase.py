# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    requires_feature,
)
from odoo.addons.nasq_pmo.models.project_phase import (
    PHASES,
    NasqPhaseGate,
    NasqPhaseStep,
)
from odoo.addons.nasq_pmo.models.project_project import NasqStaleWrite
from odoo.addons.nasq_pmo.serializers.project import (
    dump_project_detail,
    parse_write_token,
)

BODY_KEYS = {'phase', 'expected_updated_at'}


class ProjectPhaseController(http.Controller):

    @http.route('/api/v1/projects/<int:project_id>/phase', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def move_phase(self, project_id, **payload):
        payload.pop('project_id', None)
        unknown = set(payload) - BODY_KEYS
        if unknown:
            field = sorted(unknown)[0]
            raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
        target = payload.get('phase')
        if target not in PHASES:
            raise ApiError(422, 'invalid', "phase must be a lifecycle phase", field='phase')
        token = parse_write_token(payload.get('expected_updated_at'))
        project = get_record('project.project', project_id)
        try:
            project._nasq_lock_for_write(token)
            project._nasq_move_phase(target)
        except NasqStaleWrite as e:
            raise ApiError(409, 'stale_write', str(e), field='expected_updated_at') from e
        except NasqPhaseGate as e:
            raise ApiError(409, 'phase_gate', str(e), details={'checks': e.nasq_checks}) from e
        except NasqPhaseStep as e:
            raise ApiError(409, 'phase_step', str(e)) from e
        return dump_project_detail(project)
