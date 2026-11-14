# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
)
from odoo.addons.liwan_api.serializers.setup import dump_setup_progress
from odoo.addons.liwan_core.models.setup_step import SETUP_OUTCOMES, SETUP_STEP_KEYS


def _progress():
    steps, closed_at = request.env['liwan.setup.step']._liwan_progress()
    return dump_setup_progress(steps, closed_at)


def _parse_change(payload):
    """``{step, outcome}`` sets or (``outcome: null``) clears one step; ``{closed}`` closes or reopens the wizard."""
    keys = set(payload)
    if keys == {'closed'}:
        if type(payload['closed']) is not bool:
            raise ApiError(422, 'invalid', 'closed must be true or false', field='closed')
        return None, payload['closed']
    if keys != {'step', 'outcome'}:
        raise ApiError(422, 'invalid', 'send either step and outcome, or closed')
    if payload['step'] not in SETUP_STEP_KEYS:
        raise ApiError(422, 'invalid', 'unknown setup step', field='step')
    if payload['outcome'] is not None and payload['outcome'] not in SETUP_OUTCOMES:
        raise ApiError(422, 'invalid', 'outcome must be done, skipped or null', field='outcome')
    return (payload['step'], payload['outcome']), None


class SetupController(http.Controller):

    @http.route('/api/v1/setup/progress', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_capability('settings.company.read')
    def setup_progress(self):
        return _progress()

    @http.route('/api/v1/setup/progress', type='json2', auth='user', methods=['PUT'], readonly=False)
    @api_handler
    @requires_capability('settings.company.manage')
    def put_setup_progress(self, **payload):
        step, closed = _parse_change(payload)
        if step:
            request.env['liwan.setup.step']._liwan_set_outcome(*step)
        else:
            request.env.company._liwan_set_setup_closed(closed)
        return _progress()
