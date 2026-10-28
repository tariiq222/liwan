# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from werkzeug.exceptions import NotFound

from odoo import http
from odoo.http import request

from odoo.addons.webvue_payments.models.payment_transaction import PROCESSED, Collector

_logger = logging.getLogger(__name__)

KINDS = ('webhook', 'return')


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
        definition = request.env['webvue.payments.provider.registry']._webvue_provider_map().get(code)
        stock_path = definition and kind in KINDS and definition['routes'].get(kind)
        if not stock_path:
            raise NotFound()
        rule, args = request.env['ir.http']._match(stock_path)
        params = {**request.httprequest.args.to_dict(), **request.httprequest.form.to_dict()}
        processed = Collector()
        request.update_context(**{PROCESSED: processed})
        response = rule.endpoint(**args, **params)
        self._post_process(processed.items)
        if kind == 'return':
            # Stock redirects the browser to its own status page, which the guard closes; Nuxt
            # sends the payer to the WebVue status page instead.
            return request.make_response('', status=204)
        return response

    @staticmethod
    def _post_process(transactions):
        """Confirm, record and reconcile what this call processed, now, as stock's status poll does.

        Only the transactions this call changed are touched, and this does not depend on the
        post-processing cron, which stock switches off with the last active gateway. A failure is
        logged and left to that cron (stock retries for four days); the notification itself stays
        recorded.
        """
        for tx in transactions:
            if tx.is_post_processed or tx.state not in ('authorized', 'done'):
                continue
            try:
                with request.env.cr.savepoint():
                    tx._post_process()
            except Exception:
                _logger.exception("Post-processing of payment transaction %s failed; the cron will retry it", tx.reference)
