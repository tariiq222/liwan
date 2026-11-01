# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_hr.models.insurance_dependent import RELATIONS, mask_national_id
from odoo.addons.liwan_hr.serializers.assets.common import reject_unknown
from odoo.addons.liwan_hr.serializers.dates import parse_optional_date
from odoo.addons.liwan_hr.serializers.insurance.common import (
    ApiError,
    optional_text,
    parse_revision,
    required_date,
    required_text,
)


def dump_dependent(row, full=False):
    """A dependent; the identity number is masked unless the caller manages insurance (``full``)."""
    return {
        'id': row.id,
        'enrollment_id': row.enrollment_id.id,
        'name': row.name,
        'relation': row.relation,
        'birth_date': row.birth_date.isoformat() if row.birth_date else None,
        'national_id_masked': mask_national_id(row.national_id),
        'national_id': (row.national_id or None) if full else None,
        'date_from': row.date_from.isoformat(),
        'date_to': row.date_to.isoformat() if row.date_to else None,
        'state': row.state,
        'revision': row.revision,
    }


def _relation(payload):
    if payload.get('relation') not in RELATIONS:
        raise ApiError(422, 'invalid', f"choose one of {', '.join(RELATIONS)}", field='relation')
    return payload['relation']


def parse_dependent_create(payload):
    reject_unknown(payload, ('name', 'relation', 'birth_date', 'national_id', 'date_from', 'date_to'))
    return {
        'name': required_text(payload, 'name', 100),
        'relation': _relation(payload),
        'birth_date': parse_optional_date(payload.get('birth_date'), 'birth_date') or False,
        'national_id': optional_text(payload, 'national_id', 20),
        'date_from': required_date(payload, 'date_from'),
        'date_to': parse_optional_date(payload.get('date_to'), 'date_to') or False,
    }


def parse_dependent_patch(payload):
    reject_unknown(payload, ('name', 'relation', 'birth_date', 'national_id', 'date_from', 'date_to', 'revision'))
    revision = parse_revision(payload)
    vals = {}
    if 'name' in payload:
        vals['name'] = required_text(payload, 'name', 100)
    if 'relation' in payload:
        vals['relation'] = _relation(payload)
    if 'birth_date' in payload:
        vals['birth_date'] = parse_optional_date(payload['birth_date'], 'birth_date') or False
    if 'national_id' in payload:
        vals['national_id'] = optional_text(payload, 'national_id', 20)
    if 'date_from' in payload:
        vals['date_from'] = required_date(payload, 'date_from')
    if 'date_to' in payload:
        vals['date_to'] = parse_optional_date(payload['date_to'], 'date_to') or False
    if not vals:
        raise ApiError(422, 'invalid', 'send at least one field to change', field='name')
    return revision, vals
