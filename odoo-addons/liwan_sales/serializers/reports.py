# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime

from odoo.addons.liwan_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.liwan_api.serializers.common import iso, parse_iso_date
from odoo.addons.liwan_api.serializers.csv_export import csv_bytes, safe_cell
from odoo.addons.liwan_sales.models.reports_service import DIMENSIONS
from odoo.addons.liwan_sales.serializers.order import (
    SOURCES,
    STATE_WIRE,
    WIRE_STATES,
    dump_currency,
)

PERIODS = ('day', 'week', 'month')
DEFAULT_PERIOD = 'month'
# What a report counts when the caller names no state: confirmed orders. The summary alone shows every state.
DEFAULT_STATES = ('confirmed',)
# The wire groups of the summary and the stock states each one adds up.
SUMMARY_GROUPS = {'confirmed': ('sale',), 'quotations': ('draft', 'sent'), 'cancelled': ('cancel',)}
EXPORT_COLUMNS = (
    'number', 'date', 'state', 'source', 'customer', 'salesperson', 'product', 'quantity', 'unit_price',
    'discount_percent', 'amount_untaxed', 'amount_total', 'currency',
)


def parse_report_filters(args, *, default_states=None):
    """The filters of a report as plain values, or a 422 ``invalid`` on the field that is wrong.

    ``date_from`` and ``date_to`` are calendar days (both included) of the order date in the caller's time zone;
    ``salesperson_id``, ``customer_id`` and ``product_id`` are ids (the product is the product the order lines show);
    ``state`` is one wire state or a comma-separated list; ``source`` is ``staff`` or ``online``. A key with no value is
    left out. ``default_states`` is the state list used when the caller names none (None means every state).
    """
    filters = {}
    date_from = parse_iso_date(args.get('date_from') or None, 'date_from')
    date_to = parse_iso_date(args.get('date_to') or None, 'date_to')
    if date_from and date_to and date_from > date_to:
        raise ApiError(422, 'invalid', 'date_from must not be after date_to', field='date_from')
    for key, value in (('date_from', date_from), ('date_to', date_to)):
        if value:
            filters[key] = value
    for key in ('salesperson_id', 'customer_id', 'product_id'):
        if args.get(key):
            filters[key] = parse_positive_int(args[key], key)
    state = args.get('state')
    wanted = state.split(',') if state else default_states
    if wanted:
        if not set(wanted) <= set(WIRE_STATES):
            raise ApiError(422, 'invalid', f'state must be one or more of {tuple(WIRE_STATES)}', field='state')
        filters['states'] = [WIRE_STATES[wire] for wire in sorted(set(wanted), key=tuple(WIRE_STATES).index)]
    source = args.get('source')
    if source:
        if source not in SOURCES:
            raise ApiError(422, 'invalid', f'source must be one of {SOURCES}', field='source')
        filters['source'] = source
    return filters


def parse_breakdown(args):
    """``(dimension, period)`` of a breakdown request; ``period`` is None except for the ``period`` dimension."""
    by = args.get('by')
    if by not in DIMENSIONS:
        raise ApiError(422, 'invalid', f'by must be one of {tuple(DIMENSIONS)}', field='by')
    period = args.get('period') or DEFAULT_PERIOD
    if period not in PERIODS:
        raise ApiError(422, 'invalid', f'period must be one of {PERIODS}', field='period')
    return by, period if by == 'period' else None


def _totals(orders, untaxed, total):
    return {'orders': orders, 'amount_untaxed': untaxed, 'amount_total': total}


def dump_summary(currency, groups):
    """``groups`` maps a stock state to ``(orders, untaxed, total)``; the three wire groups add their states up."""
    result = {'currency': dump_currency(currency)}
    for name, states in SUMMARY_GROUPS.items():
        figures = [groups.get(state, (0, 0.0, 0.0)) for state in states]
        result[name] = _totals(
            sum(item[0] for item in figures),
            currency.round(sum(item[1] for item in figures)),
            currency.round(sum(item[2] for item in figures)),
        )
    return result


def _key_label(value):
    """The ``(key, label)`` of a group: a record by its id and name, a period start by its ISO day, nothing as null."""
    if not value:
        return None, None
    if hasattr(value, 'display_name'):
        return value.id, value.display_name
    day = value.date() if isinstance(value, datetime) else value
    return day.isoformat(), day.isoformat()


def dump_breakdown(by, period, currency, rows, limit, offset):
    """One page of the groups ``rows`` (``(group, orders, quantity, untaxed, total)``); ``total`` counts every group.

    ``quantity`` is the product's own unit quantity and is given for the ``product`` dimension only.
    """
    items = [
        {
            'key': key,
            'label': label,
            'orders': orders,
            'quantity': quantity if by == 'product' else None,
            'amount_untaxed': currency.round(untaxed),
            'amount_total': currency.round(total),
        }
        for (key, label), orders, quantity, untaxed, total in (
            (_key_label(group), *figures) for group, *figures in rows[offset:offset + limit]
        )
    ]
    return {'by': by, 'period': period, 'currency': dump_currency(currency), 'items': items, 'total': len(rows)}


def export_row(line, currency):
    """One detail row of the export: spreadsheet-safe text, numbers kept as numbers."""
    return [
        safe_cell(line.name or ''),
        iso(line.date) or '',
        STATE_WIRE[line.state],
        'staff' if line.liwan_staff_document else 'online',
        safe_cell(line.partner_id.display_name or ''),
        safe_cell(line.user_id.name or ''),
        safe_cell(line.product_tmpl_id.name or ''),
        line.product_uom_qty,
        currency.round(line.price_unit),
        line.discount,
        currency.round(line.price_subtotal),
        currency.round(line.price_total),
        safe_cell(currency.name),
    ]


def export_csv(lines, currency):
    return csv_bytes(EXPORT_COLUMNS, (export_row(line, currency) for line in lines))
