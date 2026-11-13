# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.serializers.csv_export import (
    csv_bytes,
    phone_cell,
    property_cells,
    property_headers,
    safe_cell,
)
from odoo.addons.liwan_customers.models.customers_settings import PROPERTIES_FIELD

COLUMNS = ('name', 'phone', 'email', 'type', 'parent', 'active')


def export_row(party, definition):
    return [
        safe_cell(party.name or ''), phone_cell(party.phone or ''), safe_cell(party.email or ''),
        'company' if party.is_company else 'individual', safe_cell(party.parent_id.name or ''),
        'true' if party.active else 'false',
        *property_cells(party, PROPERTIES_FIELD, definition),
    ]


def export_csv(parties, definition):
    return csv_bytes(
        [*COLUMNS, *property_headers(definition)],
        (export_row(party, definition) for party in parties),
    )
