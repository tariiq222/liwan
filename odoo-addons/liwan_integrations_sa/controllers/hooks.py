# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import http
from odoo.http import request

from odoo.addons.liwan_integrations_sa.models import connection_callback as callback
from odoo.addons.liwan_platform.models.read_only_guard import (
    INBOUND_EVENT_CONTEXT,
    INBOUND_EVENT_TOKEN,
)

_logger = logging.getLogger(__name__)

FORM_TYPE = 'application/x-www-form-urlencoded'
STATUSES = {
    callback.NOT_FOUND: 404,
    callback.INVALID: 400,
    callback.FORBIDDEN: 403,
    callback.IGNORED: 204,
    callback.APPLIED: 204,
}
MESSAGES = {
    callback.NOT_FOUND: 'unknown callback',
    callback.INVALID: 'the callback body is not a form',
    callback.FORBIDDEN: 'the callback signature does not match',
}


class IntegrationCallbackController(http.Controller):
    """A provider's server-to-server status callback (a message, call or recording status), relayed by Nuxt unchanged.

    There is no session, no feature gate and no capability: the provider signature over the URL stored on the log
    row is the whole authentication, checked by the one model method this route calls. A read-only branch still
    records what already happened (the context key lifts the branch fence for this request only).
    """

    @http.route(
        '/api/v1/public/integrations/hooks/<string:provider>/<int:connection_id>/<string:kind>', type='http',
        auth='public', methods=['POST'], csrf=False, save_session=False,
    )
    def provider_callback(self, provider, connection_id, kind, **_):
        if request.httprequest.mimetype != FORM_TYPE:
            return self._answer(callback.INVALID)
        params = request.httprequest.form.to_dict(flat=False)
        request.update_context(**{INBOUND_EVENT_CONTEXT: INBOUND_EVENT_TOKEN})
        result = request.env['liwan.integration.connection']._liwan_apply_callback(
            provider, connection_id, kind, params, dict(request.httprequest.headers),
        )
        if result == callback.FORBIDDEN:
            _logger.info('integration callback refused: bad signature for %s connection %s', provider, connection_id)
        return self._answer(result)

    @staticmethod
    def _answer(result):
        status = STATUSES[result]
        if status == 204:
            return request.make_response('', status=204)
        return request.make_json_response({'code': result, 'message': MESSAGES[result]}, status=status)
