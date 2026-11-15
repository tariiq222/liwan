# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import binascii
import io

from PIL import Image

from odoo.tools import html2plaintext

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_sales.serializers.order import (
    STATE_WIRE,
    dump_currency,
    dump_line_values,
)

TOKEN_KEY = 'access_token'
SIGNATURE_KEYS = ('signed_by', 'signature')
MAX_SIGNER = 120
MAX_SIGNATURE_BYTES = 48 * 1024
# A signature pad is a few hundred pixels; a small file may still declare a huge canvas that stock would decode.
MAX_SIGNATURE_SIDE = 2000
PNG_MAGIC = b'\x89PNG\r\n\x1a\n'
MAX_REASON = 1000


def dump_public_quotation(order):
    """The customer's page of a sent quotation: its figures and lines, the answer, and what may still be done.

    Nothing internal: no salesperson, no contact data of the customer, no partner or product ids.
    """
    currency = order.currency_id
    return {
        'id': order.id,
        'number': order.name,
        'state': STATE_WIRE[order.state],
        'expired': bool(order.is_expired),
        'company_name': order.company_id.name,
        'customer_name': order.partner_id.name,
        'date': iso(order.date_order),
        'validity_date': order.validity_date.isoformat() if order.validity_date else None,
        'terms': html2plaintext(order.note) if order.note else '',
        'currency': dump_currency(currency),
        'amount_untaxed': currency.round(order.amount_untaxed),
        'amount_tax': currency.round(order.amount_tax),
        'amount_total': currency.round(order.amount_total),
        'lines': [dump_line_values(line) for line in order.order_line],
        'answer_mode': order.liwan_answer_mode,
        'answer': order.liwan_answer or None,
        'answered_at': iso(order.liwan_answered_on),
        'signed_by': order.signed_by or None,
        'can_accept': order._liwan_can_accept(),
        'can_decline': order._liwan_can_answer(),
    }


def parse_public_body(payload, accepted):
    """The access token of a public POST, once the body carries no field outside ``accepted`` (422 ``unknown_field``)."""
    unknown = sorted(set(payload) - {TOKEN_KEY, *accepted})
    if unknown:
        raise ApiError(422, 'unknown_field', f'field {unknown[0]!r} is not accepted', field=unknown[0])
    return payload.get(TOKEN_KEY)


def _parse_signer(value):
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ApiError(422, 'signature_required', 'the name of the signer is required')
    if not isinstance(value, str) or len(value.strip()) > MAX_SIGNER:
        raise ApiError(422, 'signature_invalid', f'the name of the signer is at most {MAX_SIGNER} characters')
    return value.strip()


def _parse_png(value):
    """The base64 text ``value`` once it decodes to a PNG of at most ``MAX_SIGNATURE_BYTES`` bytes and a bounded canvas."""
    if value is None:
        raise ApiError(422, 'signature_required', 'the signature is required')
    invalid = ApiError(422, 'signature_invalid', 'the signature must be a small PNG image as base64 text')
    if not isinstance(value, str):
        raise invalid
    try:
        raw = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        raise invalid from None
    if not raw.startswith(PNG_MAGIC) or len(raw) > MAX_SIGNATURE_BYTES:
        raise invalid
    try:
        with Image.open(io.BytesIO(raw)) as image:
            image.verify()
            too_large = max(image.size) > MAX_SIGNATURE_SIDE
    except (OSError, SyntaxError):
        raise invalid from None
    if too_large:
        raise invalid
    return value


def parse_signature(payload, mode):
    """``(signed_by, signature)`` an acceptance carries under the answer ``mode``, or None when the mode takes none.

    ``accept_and_sign`` needs both (422 ``signature_required`` or ``signature_invalid``); ``accept`` refuses them as
    unknown fields.
    """
    if mode != 'accept_and_sign':
        given = [key for key in SIGNATURE_KEYS if key in payload]
        if given:
            raise ApiError(422, 'unknown_field', f'field {given[0]!r} is not accepted', field=given[0])
        return None
    return _parse_signer(payload.get('signed_by')), _parse_png(payload.get('signature'))


def parse_reason(payload):
    """The optional reason of a decline, or a 422 ``invalid`` on ``reason``."""
    reason = payload.get('reason')
    if reason is None:
        return None
    if not isinstance(reason, str) or len(reason) > MAX_REASON:
        raise ApiError(422, 'invalid', f'reason must be text of at most {MAX_REASON} characters', field='reason')
    return reason.strip() or None
