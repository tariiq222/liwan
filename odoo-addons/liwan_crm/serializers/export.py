# Part of Odoo. See LICENSE file for full copyright and licensing details.
import csv
import io
import re

from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_api.serializers.properties import dump_values
from odoo.addons.liwan_crm.models.crm_lead import PROPERTIES_FIELD

COLUMNS = ('name', 'phone', 'email', 'stage', 'agent', 'source', 'package', 'final_price', 'created')
FORMULA_PREFIXES = ('=', '+', '-', '@', '\t', '\r')
E164 = re.compile(r'\+[0-9]{6,15}')
# What separates the option keys of a multi-valued property in one cell.
OPTION_SEPARATOR = ', '


def _safe(value):
    """A text cell a spreadsheet will not run as a formula."""
    return f"'{value}" if value.startswith(FORMULA_PREFIXES) else value


def _phone(value):
    """A phone in international form is only digits after its plus sign, so it runs nothing.

    A leading tab keeps a spreadsheet from reading it as a number and dropping the plus sign.
    """
    return f'\t{value}' if E164.fullmatch(value) else _safe(value)


def property_columns(definition):
    """The header of one column per defined property, after the fixed ``COLUMNS``."""
    return [_safe(item['string']) for item in definition]


def export_row(lead, definition):
    return [
        _safe(lead.contact_name or ''), _phone(lead.phone or ''), _safe(lead.email_from or ''),
        _safe(lead.stage_id.name or ''), _safe(lead.user_id.name or ''), _safe(lead.source_id.name or ''),
        _safe(lead.liwan_package_id.name or ''), lead.liwan_final_price, iso(lead.create_date) or '',
        *_property_values(lead, definition),
    ]


def export_csv(leads, definition):
    """UTF-8 bytes with a byte-order mark, so a spreadsheet reads Arabic text correctly."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([*COLUMNS, *property_columns(definition)])
    writer.writerows(export_row(lead, definition) for lead in leads)
    return b'\xef\xbb\xbf' + buffer.getvalue().encode('utf-8')


def _property_values(lead, definition):
    """One cell per defined property: its label form, formula-safe, empty when unset."""
    values = dump_values(lead, PROPERTIES_FIELD)
    return [_safe(_text(item, values.get(item['name']))) for item in definition]


def _text(item, value):
    """A property value in its text form: option labels, true/false, ISO dates (``dump_values``)."""
    if value is None:
        return ''
    if item['type'] == 'tags':
        labels = _labels(item)
        return OPTION_SEPARATOR.join(labels.get(key, key) for key in value)
    if item['type'] == 'selection':
        return _labels(item).get(value, value)
    if item['type'] == 'boolean':
        return 'true' if value else 'false'
    return str(value)


def _labels(item):
    """The option label of every option key of a selection or tags property."""
    return {pair[0]: pair[1] for pair in item.get(item['type']) or ()}
