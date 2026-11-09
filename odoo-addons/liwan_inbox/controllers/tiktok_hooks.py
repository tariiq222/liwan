# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The public TikTok webhook (machine to machine, no session).

Like the WhatsApp hook it runs as the inactive hook identity (`models/ir_http.py`): its only
authority is the group's ACL rows (read channels, create raw events), never a `sudo()`. A delivery
is accepted only when the app secret signs its raw body and it names a connected business account,
so an unknown account, a bad signature and a missing app secret answer the same 403 and reveal
nothing about which accounts exist. The events are processed by the inbox cron, not here.
"""
import os
import time

from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import api_handler, requires_feature
from odoo.addons.liwan_inbox.adapters import tiktok
from odoo.addons.liwan_inbox.controllers.hooks import (
    parse_payload,
    read_body,
    reject_webhook,
)
from odoo.addons.liwan_inbox.models.constants import TIKTOK_FEATURE


class TikTokHookController(http.Controller):

    @http.route(
        '/api/v1/inbox/hooks/tiktok', type='http', auth='inbox_hook', methods=['POST'], csrf=False, save_session=False,
    )
    @api_handler
    @requires_feature(TIKTOK_FEATURE)
    def receive(self, **_):
        raw = read_body()
        payload = parse_payload(raw)
        config = tiktok.app_config(os.environ)
        business_id = tiktok.event_business_id(payload)
        signed = (
            bool(config) and bool(business_id)
            and tiktok.verify_signature(
                config.client_secret, raw, request.httprequest.headers.get(tiktok.SIGNATURE_HEADER, ''),
                int(time.time()), max_age=tiktok.SIGNATURE_MAX_AGE_RELAY,
            )
        )
        channel = request.env['liwan.inbox.channel']
        if signed:
            channel = channel.search([
                ('kind', '=', 'tiktok'), ('state', '!=', 'disabled'),
                ('tiktok_business_id', '=', business_id),
            ], limit=1)
        if not channel:
            reject_webhook()
        request.env['liwan.inbox.event']._liwan_store(channel, raw)
        return request.make_response('ok', headers=[('Content-Type', 'text/plain; charset=utf-8')])
