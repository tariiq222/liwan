# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from werkzeug.exceptions import HTTPException

from odoo import http
from odoo.http import request

from odoo.addons.liwan_payments.models.payment_transaction import PROCESSED, Collector

_logger = logging.getLogger(__name__)

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
    is already on its way.
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
        request.update_context(**{PROCESSED: processed})
        try:
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
        """Confirm, record and reconcile what this call processed, now, as stock's status poll does.

        Only the transactions this call changed are touched, and this does not depend on the
        post-processing cron, which stock switches off with the last active gateway. A failure is
        logged and handed to that cron, switched back on if needed (stock retries for four days);
        the notification itself stays recorded. A row another transaction holds (the invoice being
        posted, say) is waited for only ``POST_PROCESS_LOCK_TIMEOUT_MS``: the gateway gets its answer
        in time and the cron finishes the job.
        """
        for tx in transactions:
            if tx.is_post_processed or tx.state not in ('authorized', 'done'):
                continue
            try:
                with request.env.cr.savepoint():
                    request.env.cr.execute('SET LOCAL lock_timeout = %s', [POST_PROCESS_LOCK_TIMEOUT_MS])
                    tx._post_process()
                    request.env.cr.execute('RESET lock_timeout')
            except Exception:
                _logger.exception("Post-processing of payment transaction %s failed; the cron will retry it", tx.reference)
                # The transaction is elevated by the stock controller that processed it.
                tx.provider_id._toggle_post_processing_cron()
                request.env.ref('payment.cron_post_process_payment_tx')._trigger()
