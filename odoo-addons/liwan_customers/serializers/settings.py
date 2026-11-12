# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.liwan_customers.models.customers_settings import SHARING_MODES

SETTING_KEYS = frozenset({'sharing', 'phone_country_id'})


def dump_settings(settings):
    country = settings.phone_country_id
    return {
        'sharing': settings.sharing,
        'phone_country': {'id': country.id, 'code': country.code, 'name': country.name} if country else None,
        'revision': settings.revision,
    }


def parse_settings_patch(env, payload):
    """``(values, revision)`` of a settings write: any of the settings plus the revision read, or a 422."""
    unknown = sorted(set(payload) - SETTING_KEYS - {'revision'})
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
    if 'phone_country_id' in payload:
        country_id = payload['phone_country_id']
        country = env['res.country']
        if country_id is not None:
            country = country.browse(parse_positive_int(country_id, 'phone_country_id')).exists()
            if not country:
                raise ApiError(422, 'invalid', 'phone_country_id is not a country', field='phone_country_id')
        values['phone_country_id'] = country.id
    if not values:
        raise ApiError(422, 'invalid', 'nothing to change')
    return values, revision
