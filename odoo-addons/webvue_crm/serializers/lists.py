# Part of Odoo. See LICENSE file for full copyright and licensing details.
import math

from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_crm.models.call_outcome import EFFECTS

NAME_MAX = 200
PRICE_MAX = 999_999_999


def dump_stage(stage):
    return {
        'id': stage.id, 'name': stage.name, 'sequence': stage.sequence,
        'is_won': stage.is_won, 'active': stage.active,
    }


def dump_outcome(outcome):
    return {
        'id': outcome.id, 'name': outcome.name, 'effect': outcome.effect,
        'lost_reason_id': outcome.lost_reason_id.id or None, 'active': outcome.active,
    }


def dump_lost_reason(reason, protected):
    return {'id': reason.id, 'name': reason.name, 'active': reason.active, 'protected': protected}


def dump_source(source):
    return {'id': source.id, 'name': source.name, 'active': source.active}


def dump_package(package):
    return {
        'id': package.id, 'name': package.name, 'price': package.list_price,
        'description': package.description_sale or '', 'active': package.active,
    }


def parse_active_filter(args):
    """The `active` list filter: True (default), False (archived only) or None (`all`)."""
    raw = args.get('active', 'true')
    if raw not in ('true', 'false', 'all'):
        raise ApiError(422, 'invalid', 'active must be true, false or all', field='active')
    return None if raw == 'all' else raw == 'true'


def _name(value, field):
    text = value.strip() if isinstance(value, str) else ''
    if not text or len(text) > NAME_MAX:
        raise ApiError(422, 'invalid', f'must be text of 1 to {NAME_MAX} characters', field=field)
    return text


def _boolean(value, field):
    if type(value) is not bool:
        raise ApiError(422, 'invalid', 'must be true or false', field=field)
    return value


def _effect(value, field):
    if value not in EFFECTS:
        raise ApiError(422, 'invalid', 'value is not an allowed option', field=field)
    return value


def _reason_id(value, field):
    if value is None:
        return False
    if type(value) is not int or value <= 0:
        raise ApiError(422, 'invalid', 'must be a lost reason id or null', field=field)
    return value


def parse_price(value, field):
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= PRICE_MAX:
        raise ApiError(422, 'invalid', f'must be a number from 0 to {PRICE_MAX}', field=field)
    return value


def _description(value, field):
    if not isinstance(value, str) or len(value) > 2000:
        raise ApiError(422, 'invalid', 'must be text of at most 2000 characters', field=field)
    return value.strip()


# API field -> (ORM field, parser, required on create). `active` is patch-only (DELETE archives).
STAGE_FIELDS = {'name': ('name', _name, True), 'is_won': ('is_won', _boolean, False)}
OUTCOME_FIELDS = {
    'name': ('name', _name, True), 'effect': ('effect', _effect, True),
    'lost_reason_id': ('lost_reason_id', _reason_id, False),
}
NAME_FIELDS = {'name': ('name', _name, True)}
PACKAGE_FIELDS = {
    'name': ('name', _name, True), 'price': ('list_price', parse_price, True),
    'description': ('description_sale', _description, False),
}


def parse_body(payload, fields, creating):
    """Validate a create/patch body against `fields` into ORM values."""
    allowed = set(fields) if creating else {*fields, 'active'}
    unknown = sorted(set(payload) - allowed)
    if unknown:
        raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])
    if creating:
        missing = sorted(name for name, (_, _, required) in fields.items() if required and name not in payload)
        if missing:
            raise ApiError(422, 'invalid', 'field is required', field=missing[0])
    elif not payload:
        raise ApiError(422, 'invalid', 'nothing to change')
    vals = {}
    for name, value in payload.items():
        if name == 'active':
            vals['active'] = _boolean(value, 'active')
        else:
            orm_name, parser, _ = fields[name]
            vals[orm_name] = parser(value, name)
    return vals


def parse_order(payload):
    unknown = sorted(set(payload) - {'ids'})
    ids = payload.get('ids')
    if unknown or not isinstance(ids, list) or any(type(item) is not int for item in ids):
        raise ApiError(422, 'invalid', 'ids must be a list of stage ids', field='ids')
    return ids
