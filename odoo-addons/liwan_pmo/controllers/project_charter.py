# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import ValidationError

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    get_visible_record,
    requires_feature,
)
from odoo.addons.liwan_pmo.models.project_project import (
    LiwanCharterState,
    LiwanStaleWrite,
)
from odoo.addons.liwan_pmo.serializers.project import (
    dump_project_detail,
    parse_write_token,
)

ACTIONS = {
    # action: (allowed body keys, the caller must manage the project)
    'submit': ({'expected_updated_at'}, True),
    'approve': ({'expected_updated_at'}, False),
    'return': ({'expected_updated_at', 'note'}, False),
    'withdraw': ({'expected_updated_at'}, True),
}


def _run(project_id, action, payload):
    allowed, manage = ACTIONS[action]
    payload.pop('project_id', None)
    unknown = set(payload) - allowed
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
    token = parse_write_token(payload.get('expected_updated_at'))
    project = get_visible_record('project.project', project_id)
    try:
        project._liwan_lock_for_write(token, require_manage=manage)
    except LiwanStaleWrite as e:
        raise ApiError(409, 'stale_write', str(e), field='expected_updated_at') from e
    try:
        if action == 'submit':
            project._liwan_charter_submit()
        elif action == 'approve':
            project._liwan_charter_approve()
        elif action == 'return':
            note = payload.get('note')
            if not isinstance(note, str) or not note.strip():
                raise ApiError(422, 'invalid', "note is required", field='note')
            project._liwan_charter_return(note)
        else:
            project._liwan_charter_withdraw()
    except LiwanCharterState as e:
        raise ApiError(409, 'charter_state', str(e)) from e
    except ValidationError as e:
        field = 'note' if action == 'return' else 'sponsor_id'
        raise ApiError(422, 'invalid', str(e), field=field) from e
    return dump_project_detail(project)


class ProjectCharterController(http.Controller):

    @http.route('/api/v1/projects/<int:project_id>/charter/submit', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def submit_charter(self, project_id, **payload):
        return _run(project_id, 'submit', payload)

    @http.route('/api/v1/projects/<int:project_id>/charter/approve', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def approve_charter(self, project_id, **payload):
        return _run(project_id, 'approve', payload)

    @http.route('/api/v1/projects/<int:project_id>/charter/return', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def return_charter(self, project_id, **payload):
        return _run(project_id, 'return', payload)

    @http.route('/api/v1/projects/<int:project_id>/charter/withdraw', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def withdraw_charter(self, project_id, **payload):
        return _run(project_id, 'withdraw', payload)
