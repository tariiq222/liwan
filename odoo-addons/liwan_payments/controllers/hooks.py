# Part of Odoo. See LICENSE file for full copyright and licensing details.

from werkzeug.exceptions import HTTPException

from odoo import http
from odoo.http import request

from odoo.addons.liwan_payments.models.payment_transaction import PROCESSED, Collector
from odoo.addons.liwan_platform.models.read_only_guard import (
    INBOUND_EVENT_CONTEXT,
    INBOUND_EVENT_TOKEN,
)

KINDS = ('webhook', 'return')
# How long post-processing waits for a row another transaction holds before it is left to the retry cron.
POST_PROCESS_LOCK_TIMEOUT_MS = 3000


class GatewayCallbackController(http.Controller):
    """The gateway's server-to-server notification and the payer's return, relayed by Nuxt.

    The gateway calls the stock path (e.g. ``/payment/paymob/webhook``) on the tenant's host; the
    edge sends it to Nuxt, which relays it here unchanged (method, query, body, content type). The
    stock provider controller is reached through the routing map, so its signature check and
    ``_process`` run as stock wrote them, overrides included; no stock method body is copied.
    There is no feature gate: a tenant that switches payments off still records the money that
    is already on its way, and so does a read-only branch (the context key lifts the branch fence for
    this request only).
    """

    @http.route(
        '/api/v1/public/payments/hooks/<string:code>/<string:kind>', type='http', auth='public',
        methods=['GET', 'POST'], csrf=False, save_session=False,
    )
    def gateway_callback(self, code, kind, **_):
        definition = request.env['liwan.payments.provider.registry']._liwan_provider_map().get(code)
        stock_path = definition and kind in KINDS and definition['routes'].get(kind)
        if not stock_path:
            return self._refusal(404, 'not_found', 'unknown gateway callback')
        if request.httprequest.method == 'POST' and not self._readable_body():
            return self._refusal(400, 'invalid', 'the notification body is not a JSON object')
        rule, args = request.env['ir.http']._match(stock_path)
        params = {**request.httprequest.args.to_dict(), **request.httprequest.form.to_dict()}
        processed = Collector()
        request.update_context(**{PROCESSED: processed, INBOUND_EVENT_CONTEXT: INBOUND_EVENT_TOKEN})
        try:
            # In a savepoint: what the stock endpoint wrote before it refused must not be committed with the refusal.
            with request.env.cr.savepoint():
                response = rule.endpoint(**args, **params)
        except HTTPException as error:
            # Stock refuses a bad signature with Forbidden; the gateway gets the same status as JSON, not an HTML page.
            return self._refusal(error.code, 'forbidden' if error.code == 403 else 'invalid', error.name)
        self._post_process(processed.items)
        if kind == 'return':
            # Stock redirects the browser to its own status page, which the guard closes; Nuxt
            # sends the payer to the LiwanOS status page instead.
            return request.make_response('', status=204)
        return response

    @staticmethod
    def _refusal(status, code, message):
        return request.make_json_response({'code': code, 'message': message}, status=status)

    @staticmethod
    def _readable_body():
        """A JSON body must be a JSON object, as stock reads it; a form or an empty body is left to stock."""
        if request.httprequest.mimetype != 'application/json':
            return True
        try:
            return isinstance(request.get_json_data(), dict)
        except ValueError:
            return False

    @staticmethod
    def _post_process(transactions):
        """Post-process what this call processed now; the gateway waits only ``POST_PROCESS_LOCK_TIMEOUT_MS`` for a held row.

        The transactions keep the environment the stock controller elevated them in.
        """
        for tx in transactions:
            tx._liwan_post_process_now(POST_PROCESS_LOCK_TIMEOUT_MS)
