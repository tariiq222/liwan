# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_api.serializers.csv_export import (
    csv_bytes,
    phone_cell,
    property_cells,
    property_headers,
    safe_cell,
)
from odoo.addons.liwan_crm.models.crm_lead import PROPERTIES_FIELD

COLUMNS = ('name', 'phone', 'email', 'stage', 'agent', 'source', 'package', 'final_price', 'created')


def export_row(lead, definition):
    return [
        safe_cell(lead.contact_name or ''), phone_cell(lead.phone or ''), safe_cell(lead.email_from or ''),
        safe_cell(lead.stage_id.name or ''), safe_cell(lead.user_id.name or ''), safe_cell(lead.source_id.name or ''),
        safe_cell(lead.liwan_package_id.name or ''), lead.liwan_final_price, iso(lead.create_date) or '',
        *property_cells(lead, PROPERTIES_FIELD, definition),
    ]


def export_csv(leads, definition):
    return csv_bytes(
        [*COLUMNS, *property_headers(definition)],
        (export_row(lead, definition) for lead in leads),
    )
