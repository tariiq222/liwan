# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import parse_positive_int
from odoo.addons.liwan_hr.models.insurance_plan import PLAN_STATES
from odoo.addons.liwan_hr.serializers.assets.common import reject_unknown
from odoo.addons.liwan_hr.serializers.insurance.common import (
    ApiError,
    money,
    optional_text,
    parse_flag,
    parse_revision,
    parse_state_filter,
    required_date,
    required_text,
)
from odoo.addons.liwan_hr.serializers.insurance.provider import ref_provider

NAME_LIMIT = 100


def dump_plan(row):
    archived = row.state == 'archived'
    return {
        'id': row.id,
        'provider': ref_provider(row.provider_id),
        'name': row.name,
        'tier': row.tier or None,
        'policy_number': row.policy_number or None,
        'valid_from': row.valid_from.isoformat(),
        'valid_to': row.valid_to.isoformat(),
        'annual_premium': row.annual_premium or None,
        'state': row.state,
        'expires_in_days': None if archived else row.expires_in_days,
        'active': row.active,
        'revision': row.revision,
    }


def ref_plan(row):
    """The plan as an employee sees it inside their own enrollment: no policy number, no premium."""
    return {
        'id': row.id,
        'provider': ref_provider(row.provider_id),
        'name': row.name,
        'tier': row.tier or None,
        'valid_from': row.valid_from.isoformat(),
        'valid_to': row.valid_to.isoformat(),
    }


def parse_plan_create(payload):
    reject_unknown(payload, (
        'provider_id', 'name', 'tier', 'policy_number', 'valid_from', 'valid_to', 'annual_premium',
    ))
    vals = {
        'provider_id': parse_positive_int(payload.get('provider_id'), 'provider_id'),
        'name': required_text(payload, 'name', NAME_LIMIT),
        'tier': optional_text(payload, 'tier', 60),
        'policy_number': optional_text(payload, 'policy_number', 60),
        'valid_from': required_date(payload, 'valid_from'),
        'valid_to': required_date(payload, 'valid_to'),
        'annual_premium': money(payload, 'annual_premium'),
    }
    if vals['valid_to'] < vals['valid_from']:
        raise ApiError(422, 'invalid', 'valid_to cannot be before valid_from', field='valid_to')
    return vals


def parse_plan_patch(payload):
    reject_unknown(payload, (
        'name', 'tier', 'policy_number', 'valid_from', 'valid_to', 'annual_premium', 'active', 'revision',
    ))
    revision = parse_revision(payload)
    vals = {}
    if 'name' in payload:
        vals['name'] = required_text(payload, 'name', NAME_LIMIT)
    for field, limit in (('tier', 60), ('policy_number', 60)):
        if field in payload:
            vals[field] = optional_text(payload, field, limit)
    for field in ('valid_from', 'valid_to'):
        if field in payload:
            vals[field] = required_date(payload, field)
    if 'annual_premium' in payload:
        vals['annual_premium'] = money(payload, 'annual_premium')
    if 'active' in payload:
        vals['active'] = parse_flag(payload, 'active')
    if not vals:
        raise ApiError(422, 'invalid', 'send at least one field to change', field='name')
    return revision, vals


def parse_plan_state(value):
    return parse_state_filter(value, PLAN_STATES)
