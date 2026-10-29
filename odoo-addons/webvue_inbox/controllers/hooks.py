# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The public WhatsApp webhook (machine to machine, no session).

Its auth method `inbox_hook` (models/ir_http.py) runs the request as the inactive hook identity,
whose only group may read channels and create raw events (security/ir.model.access.csv). No
`sudo()`: that ACL is the whole authority. An unknown phone number id, a bad signature and a
malformed body all answer the same 403, so the route reveals nothing about which tenants or
numbers exist. A template change (the account-level webhook fields) carries the business account id
instead of a phone number id, so it reaches the channels of that account.
"""
import hmac
import json

from odoo import http
from odoo.exceptions import UserError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.webvue_inbox.adapters import whatsapp
from odoo.addons.webvue_inbox.models.constants import WHATSAPP_FEATURE

MAX_BODY_BYTES = 1024 * 1024
SIGNATURE_HEADER = 'X-Hub-Signature-256'
# Verified when no channel matches, so a known and an unknown phone number id take the same time.
UNMATCHED_SECRET = 'webvue-inbox-unmatched'
TOO_LARGE = 'webhook body is too large'
HANDSHAKE_PARAMS = ('hub.mode', 'hub.verify_token', 'hub.challenge')


def reject_webhook():
    message = 'webhook request refused'
    raise ApiError(403, 'forbidden', message)


def read_body():
    length = request.httprequest.content_length
    if length is not None and length > MAX_BODY_BYTES:
        raise ApiError(413, 'payload_too_large', TOO_LARGE)
    raw = request.httprequest.get_data()
    if len(raw) > MAX_BODY_BYTES:
        raise ApiError(413, 'payload_too_large', TOO_LARGE)
    return raw


def parse_payload(raw):
    try:
        payload = json.loads(raw)
    except ValueError:
        reject_webhook()
    if not isinstance(payload, dict):
        reject_webhook()
    return payload


def signed_by(channel, raw, signature):
    try:
        secret = channel._webvue_app_secret()
    except UserError:
        return False
    return bool(secret) and whatsapp.verify_signature(secret, raw, signature)


class WhatsAppHookController(http.Controller):

    @http.route(
        '/api/v1/inbox/hooks/whatsapp', type='http', auth='inbox_hook', methods=['GET'], csrf=False, save_session=False,
    )
    @api_handler
    @requires_feature(WHATSAPP_FEATURE, operation='read')
    def verify(self, **_):
        args = request.httprequest.args
        # A handshake without Meta's parameters is a malformed request, refused before any channel is read.
        missing = next((name for name in HANDSHAKE_PARAMS if not args.get(name)), None)
        if missing:
            raise ApiError(400, 'invalid', f'{missing} is required', field=missing)
        env = request.env
        channels = env['webvue.inbox.channel'].search([('kind', '=', 'whatsapp'), ('state', '!=', 'disabled')])
        token = args.get('hub.verify_token', '').encode()
        # Every channel is compared, so the time taken does not reveal which one matched.
        matches = [hmac.compare_digest(channel.verify_token.encode(), token) for channel in channels]
        if args.get('hub.mode') != 'subscribe' or not any(matches):
            reject_webhook()
        return request.make_response(args.get('hub.challenge', ''), headers=[
            ('Content-Type', 'text/plain; charset=utf-8'), ('X-Content-Type-Options', 'nosniff'),
        ])

    @http.route(
        '/api/v1/inbox/hooks/whatsapp', type='http', auth='inbox_hook', methods=['POST'], csrf=False, save_session=False,
    )
    @api_handler
    @requires_feature(WHATSAPP_FEATURE)
    def receive(self, **_):
        raw = read_body()
        payload = parse_payload(raw)
        env = request.env
        channels = env['webvue.inbox.channel'].search([
            ('kind', '=', 'whatsapp'), ('state', '!=', 'disabled'),
            '|', ('phone_number_id', 'in', sorted(whatsapp.phone_number_ids(payload))),
            ('business_account_id', 'in', sorted(whatsapp.template_business_account_ids(payload))),
        ])
        signature = request.httprequest.headers.get(SIGNATURE_HEADER, '')
        if not channels:
            whatsapp.verify_signature(UNMATCHED_SECRET, raw, signature)
        verified = channels.filtered(lambda channel: signed_by(channel, raw, signature))
        if not verified:
            reject_webhook()
        env['webvue.inbox.event'].create([
            {'channel_id': channel.id, 'owner_company_id': channel.owner_company_id.id, 'payload': raw.decode()}
            for channel in verified
        ])
        return request.make_response('ok', headers=[('Content-Type', 'text/plain; charset=utf-8')])
