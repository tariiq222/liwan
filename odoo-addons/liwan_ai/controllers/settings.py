# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, http
from odoo.http import request

from odoo.addons.liwan_ai.models.access_service import AI_SETTINGS_MANAGE
from odoo.addons.liwan_ai.models.consent_text import CONSENT_TEXT_HASH, CONSENT_VERSION
from odoo.addons.liwan_ai.serializers.monitoring import dump_monitoring
from odoo.addons.liwan_ai.serializers.settings import (
    dump_settings,
    parse_consent,
    parse_settings_patch,
)
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)

AI_FEATURE = 'ai.enabled'


class AiSettingsController(http.Controller):
    """The tenant administrator's AI policy: provider mode, residency consent, usage and monitoring."""

    @http.route('/api/v1/ai/settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(AI_FEATURE, operation='read')
    @requires_capability(AI_SETTINGS_MANAGE)
    def read_settings(self, **_):
        return dump_settings(request.env)

    @http.route('/api/v1/ai/settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature(AI_FEATURE, operation='write')
    @requires_capability(AI_SETTINGS_MANAGE)
    def write_settings(self, **payload):
        provider_mode, revision = parse_settings_patch(payload)
        settings = request.env['liwan.ai.settings']._liwan_current()
        if settings.revision != revision:
            raise ApiError(409, 'stale', 'the AI settings changed since they were read')
        settings.write({'provider_mode': provider_mode, 'revision': revision + 1})
        return dump_settings(request.env)

    @http.route('/api/v1/ai/consent', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(AI_FEATURE, operation='write')
    @requires_capability(AI_SETTINGS_MANAGE)
    def sign_consent(self, **payload):
        parse_consent(payload)
        Consent = request.env['liwan.ai.consent']
        if not Consent._liwan_valid():
            Consent.create({
                'user_id': request.env.uid,
                'signed_at': fields.Datetime.now(),
                'text_version': CONSENT_VERSION,
                'text_hash': CONSENT_TEXT_HASH,
            })
        return dump_settings(request.env)

    @http.route('/api/v1/ai/consent/revoke', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(AI_FEATURE, operation='write')
    @requires_capability(AI_SETTINGS_MANAGE)
    def revoke_consent(self, **_):
        consent = request.env['liwan.ai.consent']._liwan_valid()
        if not consent:
            raise ApiError(404, 'not_found', 'there is no consent to revoke')
        consent.write({'revoked_at': fields.Datetime.now(), 'revoked_by_id': request.env.uid})
        return dump_settings(request.env)

    @http.route('/api/v1/ai/monitoring', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(AI_FEATURE, operation='read')
    @requires_capability(AI_SETTINGS_MANAGE)
    def read_monitoring(self, **_):
        return dump_monitoring(request.env)
