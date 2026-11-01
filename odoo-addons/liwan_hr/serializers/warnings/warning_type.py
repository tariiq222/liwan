# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_hr.serializers.assets.common import reject_unknown
from odoo.addons.liwan_hr.serializers.warnings.warning import parse_revision

MAX_SEVERITY = 1000


def dump_type(row):
    return {
        'id': row.id,
        'name': row.name,
        'severity': row.severity,
        'active': row.active,
        'revision': row.revision,
    }


def _name(payload):
    value = payload.get('name')
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 100:
        raise ApiError(422, 'invalid', 'name must be 1 to 100 characters', field='name')
    return value.strip()


def _severity(payload):
    value = payload.get('severity')
    if type(value) is not int or not 1 <= value <= MAX_SEVERITY:
        raise ApiError(422, 'invalid', f'severity must be an integer from 1 to {MAX_SEVERITY}', field='severity')
    return value


def parse_type_create(payload):
    reject_unknown(payload, ('name', 'severity'))
    return {'name': _name(payload), 'severity': _severity(payload)}


def parse_type_patch(payload):
    reject_unknown(payload, ('name', 'severity', 'active', 'revision'))
    revision = parse_revision(payload)
    vals = {}
    if 'name' in payload:
        vals['name'] = _name(payload)
    if 'severity' in payload:
        vals['severity'] = _severity(payload)
    if 'active' in payload:
        if type(payload['active']) is not bool:
            raise ApiError(422, 'invalid', 'active must be true or false', field='active')
        vals['active'] = payload['active']
    if not vals:
        raise ApiError(422, 'invalid', 'send at least one field to change', field='name')
    return revision, vals
