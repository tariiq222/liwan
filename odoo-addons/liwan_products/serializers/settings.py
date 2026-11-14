# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_products.models.products_settings import SHARING_MODES

PATCH_KEYS = frozenset({'sharing', 'revision'})


def dump_settings(settings, can_manage):
    """The settings wire shape; ``can_manage`` is whether the caller passes the authorization of a settings write."""
    return {'sharing': settings.sharing, 'can_manage': can_manage, 'revision': settings.revision}


def parse_settings_patch(payload):
    """``(values, revision)`` of a settings write, or a 422."""
    unknown = sorted(set(payload) - PATCH_KEYS)
    if unknown:
        raise ApiError(422, 'unknown_field', f'field {unknown[0]!r} is not accepted', field=unknown[0])
    revision = payload.get('revision')
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise ApiError(422, 'invalid', 'revision must be a positive integer', field='revision')
    if 'sharing' not in payload:
        raise ApiError(422, 'invalid', 'nothing to change')
    if payload['sharing'] not in SHARING_MODES:
        raise ApiError(422, 'invalid', f'sharing must be one of {SHARING_MODES}', field='sharing')
    return {'sharing': payload['sharing']}, revision
