# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.liwan_api.serializers.properties import (
    MAX_LABEL,
    MAX_OPTIONS,
    MAX_PROPERTIES,
    dump_definition,
    parse_definition,
)
from odoo.addons.liwan_customers.models.customers_settings import (
    PARTY_KINDS,
    SHARING_MODES,
)

SETTING_KEYS = frozenset({'sharing', 'party_kinds', 'phone_country_id'})
PATCH_KEYS = SETTING_KEYS | {'fields', 'confirm_field_removal', 'revision'}


def dump_country(country):
    """A country on the wire, named in the session's language."""
    return {'id': country.id, 'code': country.code, 'name': country.name}


def dump_countries(countries):
    return {'items': [dump_country(country) for country in countries], 'total': len(countries)}


def dump_settings(settings, definition, can_manage):
    """The settings wire shape. ``definition`` is the tenant's customer fields (stock's engine items); ``can_manage``
    is whether the caller passes the authorization of a settings write."""
    return {
        'sharing': settings.sharing,
        'party_kinds': settings.party_kinds,
        'phone_country': dump_country(settings.phone_country_id) if settings.phone_country_id else None,
        'fields': dump_definition(definition),
        'field_limits': {'max_properties': MAX_PROPERTIES, 'max_options': MAX_OPTIONS, 'max_label': MAX_LABEL},
        'can_manage': can_manage,
        'revision': settings.revision,
    }


def parse_settings_patch(env, payload, current_definition):
    """``(values, definition, confirm_removal, revision)`` of a settings write: any of the settings, the whole customer
    field definition (``None`` when untouched) and the revision read, or a 422."""
    unknown = sorted(set(payload) - PATCH_KEYS)
    if unknown:
        raise ApiError(422, 'unknown_field', f'field {unknown[0]!r} is not accepted', field=unknown[0])
    revision = payload.get('revision')
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise ApiError(422, 'invalid', 'revision must be a positive integer', field='revision')
    values = {}
    if 'sharing' in payload:
        if payload['sharing'] not in SHARING_MODES:
            raise ApiError(422, 'invalid', f'sharing must be one of {SHARING_MODES}', field='sharing')
        values['sharing'] = payload['sharing']
    if 'party_kinds' in payload:
        if payload['party_kinds'] not in PARTY_KINDS:
            raise ApiError(422, 'invalid', f'party_kinds must be one of {PARTY_KINDS}', field='party_kinds')
        values['party_kinds'] = payload['party_kinds']
    if 'phone_country_id' in payload:
        country_id = payload['phone_country_id']
        country = env['res.country']
        if country_id is not None:
            country = country.browse(parse_positive_int(country_id, 'phone_country_id')).exists()
            if not country:
                raise ApiError(422, 'invalid', 'phone_country_id is not a country', field='phone_country_id')
        values['phone_country_id'] = country.id
    definition = parse_definition(payload['fields'], 'fields', current_definition) if 'fields' in payload else None
    confirm_removal = _parse_confirmation(payload, definition)
    if not values and definition is None:
        raise ApiError(422, 'invalid', 'nothing to change')
    return values, definition, confirm_removal, revision


def _parse_confirmation(payload, definition):
    """Whether the write repeats a refused removal: ``confirm_field_removal`` is only ``true`` and only with ``fields``."""
    if 'confirm_field_removal' not in payload:
        return False
    if payload['confirm_field_removal'] is not True or definition is None:
        message = 'confirm_field_removal must be true and comes with fields'
        raise ApiError(422, 'invalid', message, field='confirm_field_removal')
    return True
