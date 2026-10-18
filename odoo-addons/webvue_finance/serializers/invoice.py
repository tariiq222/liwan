# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .common import dump_day, dump_ref
from .parsing import (
    parse_day,
    parse_id,
    parse_id_list,
    parse_number,
    parse_text,
    reject_unknown,
    require_keys,
)
from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_api.serializers.common import iso

WRITABLE_MOVE_TYPES = ('out_invoice', 'in_invoice', 'out_refund', 'in_refund')
LINE_FIELDS = frozenset({'name', 'quantity', 'price_unit', 'discount', 'tax_ids', 'account_id'})
EDITABLE_FIELDS = frozenset({'partner_id', 'invoice_date', 'invoice_date_due', 'currency', 'ref', 'lines'})
CREATE_FIELDS = EDITABLE_FIELDS | {'move_type'}


def dump_invoice(move):
    return {
        'id': move.id,
        'name': move.name,
        'move_type': move.move_type,
        'state': move.state,
        'payment_state': move.payment_state,
        'partner': dump_ref(move.partner_id),
        'journal': dump_ref(move.journal_id),
        'invoice_date': dump_day(move.invoice_date),
        'invoice_date_due': dump_day(move.invoice_date_due),
        'currency': move.currency_id.name,
        'amount_untaxed': move.amount_untaxed,
        'amount_tax': move.amount_tax,
        'amount_total': move.amount_total,
        'amount_residual': move.amount_residual,
    }


def dump_invoice_line(line):
    return {
        'id': line.id,
        'name': line.name or '',
        'account': dump_ref(line.account_id),
        'quantity': line.quantity,
        'price_unit': line.price_unit,
        'discount': line.discount,
        'taxes': [dump_ref(tax) for tax in line.tax_ids],
        'price_subtotal': line.price_subtotal,
        'price_total': line.price_total,
    }


def dump_invoice_zatca(move):
    """The ZATCA e-invoicing facts ``l10n_sa`` computes for a Saudi sale document; None for any other.

    ``qr_code`` is the base64 TLV payload of the printed QR code (seller, VAT number, issue time, total
    and VAT), empty until the document is posted and the company has a VAT number.
    """
    if move.country_code != 'SA' or not move.is_sale_document():
        return None
    return {
        'qr_code': move.l10n_sa_qr_code_str or None,
        'confirmation_datetime': iso(move.l10n_sa_confirmation_datetime),
    }


def dump_invoice_detail(move):
    return {
        **dump_invoice(move),
        'ref': move.ref or '',
        'zatca': dump_invoice_zatca(move),
        'lines': [dump_invoice_line(line) for line in move.invoice_line_ids],
    }


def dump_invoices(moves):
    return [dump_invoice(move) for move in moves]


def _parse_line(raw, index):
    prefix = f'lines[{index}]'
    if not isinstance(raw, dict):
        raise ApiError(422, 'invalid', f'{prefix} must be an object', field=prefix)
    reject_unknown(raw, LINE_FIELDS, prefix=f'{prefix}.')
    require_keys(raw, ('name', 'price_unit'), prefix=f'{prefix}.')
    line = {
        'name': parse_text(raw['name'], f'{prefix}.name', required=True),
        'price_unit': parse_number(raw['price_unit'], f'{prefix}.price_unit'),
        'quantity': parse_number(raw.get('quantity', 1), f'{prefix}.quantity', minimum=0),
        'discount': parse_number(raw.get('discount', 0), f'{prefix}.discount', minimum=0, maximum=100),
    }
    if 'tax_ids' in raw:
        line['tax_ids'] = parse_id_list(raw['tax_ids'], f'{prefix}.tax_ids')
    if raw.get('account_id') is not None:
        line['account_id'] = parse_id(raw['account_id'], f'{prefix}.account_id')
    return line


def _parse_lines(raw):
    if not isinstance(raw, list) or not raw:
        raise ApiError(422, 'invalid', 'lines must be a non-empty list', field='lines')
    return [_parse_line(line, index) for index, line in enumerate(raw)]


def _parse_editable(payload):
    """Validate the editable keys present in ``payload`` (shape only; records are resolved by the route)."""
    parsed = {}
    if 'partner_id' in payload:
        parsed['partner_id'] = parse_id(payload['partner_id'], 'partner_id')
    for field in ('invoice_date', 'invoice_date_due'):
        if field in payload:
            parsed[field] = None if payload[field] is None else parse_day(payload[field], field)
    if 'currency' in payload:
        parsed['currency'] = parse_text(payload['currency'], 'currency', required=True).upper()
    if 'ref' in payload:
        parsed['ref'] = parse_text(payload['ref'], 'ref')
    if 'lines' in payload:
        parsed['lines'] = _parse_lines(payload['lines'])
    return parsed


def parse_invoice_create(payload):
    reject_unknown(payload, CREATE_FIELDS)
    require_keys(payload, ('move_type', 'partner_id', 'lines'))
    move_type = payload['move_type']
    if move_type not in WRITABLE_MOVE_TYPES:
        raise ApiError(422, 'invalid', f'move_type must be one of {", ".join(WRITABLE_MOVE_TYPES)}', field='move_type')
    return {'move_type': move_type, **_parse_editable(payload)}


def parse_invoice_patch(payload):
    reject_unknown(payload, EDITABLE_FIELDS)
    return _parse_editable(payload)
