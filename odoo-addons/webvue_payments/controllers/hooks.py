# Part of Odoo. See LICENSE file for full copyright and licensing details.
from werkzeug.exceptions import NotFound

from odoo import http
from odoo.http import request

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
        response = rule.endpoint(**args, **params)
        # Confirmation, the payment entry and the invoice reconciliation happen in stock
        # post-processing: run it now instead of waiting for the cron's next round.
        request.env.ref('payment.cron_post_process_payment_tx')._trigger()
        if kind == 'return':
            # Stock redirects the browser to its own status page, which the guard closes; Nuxt
            # sends the payer to the WebVue status page instead.
            return request.make_response('', status=204)
        return response
