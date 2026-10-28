# Part of Odoo. See LICENSE file for full copyright and licensing details.
import csv
import io
import re

from odoo.addons.webvue_api.serializers.common import iso

COLUMNS = ('name', 'phone', 'email', 'stage', 'agent', 'source', 'package', 'final_price', 'created')
FORMULA_PREFIXES = ('=', '+', '-', '@', '\t', '\r')
E164 = re.compile(r'\+\d{6,15}')


def _safe(value):
    """A text cell a spreadsheet will not run as a formula."""
    return f"'{value}" if value.startswith(FORMULA_PREFIXES) else value


def _phone(value):
    """A phone in international form is only digits after its plus sign, so it runs nothing."""
    return value if E164.fullmatch(value) else _safe(value)


def export_row(lead):
    return [
        _safe(lead.contact_name or ''), _phone(lead.phone or ''), _safe(lead.email_from or ''),
        _safe(lead.stage_id.name or ''), _safe(lead.user_id.name or ''), _safe(lead.source_id.name or ''),
        _safe(lead.webvue_package_id.name or ''), lead.webvue_final_price, iso(lead.create_date) or '',
    ]


def export_csv(leads):
    """UTF-8 bytes with a byte-order mark, so a spreadsheet reads Arabic text correctly."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(COLUMNS)
    writer.writerows(export_row(lead) for lead in leads)
    return b'\xef\xbb\xbf' + buffer.getvalue().encode('utf-8')
