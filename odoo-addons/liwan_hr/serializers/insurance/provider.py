# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_hr.serializers.assets.common import reject_unknown
from odoo.addons.liwan_hr.serializers.insurance.common import (
    ApiError,
    parse_flag,
    parse_revision,
    required_text,
)

NAME_LIMIT = 100


def dump_provider(row):
    return {'id': row.id, 'name': row.name, 'active': row.active, 'revision': row.revision}


def ref_provider(row):
    return {'id': row.id, 'name': row.name}


def parse_provider_create(payload):
    reject_unknown(payload, ('name',))
    return {'name': required_text(payload, 'name', NAME_LIMIT)}


def parse_provider_patch(payload):
    reject_unknown(payload, ('name', 'active', 'revision'))
    revision = parse_revision(payload)
    vals = {}
    if 'name' in payload:
        vals['name'] = required_text(payload, 'name', NAME_LIMIT)
    if 'active' in payload:
        vals['active'] = parse_flag(payload, 'active')
    if not vals:
        raise ApiError(422, 'invalid', 'send at least one field to change', field='name')
    return revision, vals
