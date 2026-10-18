# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .common import dump_day, dump_ref


def _dump_tax_row(tax, amounts):
    return {
        'tax': dump_ref(tax),
        'rate': tax.amount if tax.amount_type == 'percent' else None,
        'base': amounts['base'],
        'tax_amount': amounts['tax'],
    }


def _dump_section(rows, currency):
    return {
        'taxes': rows,
        'base': currency.round(sum(row['base'] for row in rows)),
        'tax_amount': currency.round(sum(row['tax_amount'] for row in rows)),
    }


def dump_vat_summary(company, date_from, date_to, totals):
    """The VAT summary of a period: sales and purchases per tax, and the net payable."""
    sections = {}
    for scope, name in (('sale', 'sales'), ('purchase', 'purchases')):
        taxes = sorted((tax for tax in totals if tax.type_tax_use == scope), key=lambda tax: (tax.sequence, tax.id))
        sections[name] = _dump_section([_dump_tax_row(tax, totals[tax]) for tax in taxes], company.currency_id)
    return {
        'date_from': dump_day(date_from),
        'date_to': dump_day(date_to),
        'currency': company.currency_id.name,
        **sections,
        'net_payable': company.currency_id.round(sections['sales']['tax_amount'] - sections['purchases']['tax_amount']),
    }
