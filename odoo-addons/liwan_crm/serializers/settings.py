# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_crm.models.crm_settings import (
    AFTER_ATTEMPTS,
    DISTRIBUTION_MODES,
    PRESET_KEYS,
    PRESETS,
    PRICE_ABOVE_LIST,
    RANGES,
    TERM_FORMS,
    TERM_GENDERS,
    TERM_KEYS,
    TERM_LANGUAGES,
    VISIBILITIES,
    term_field,
    term_gender_field,
)

TERM_MAX_LENGTH = 60
ENUMS = {
    'after_attempts': AFTER_ATTEMPTS,
    'distribution_mode': DISTRIBUTION_MODES,
    'visibility': VISIBILITIES,
    'price_above_list': PRICE_ABOVE_LIST,
}
BOOLEANS = ('recycle_enabled', 'view_log_enabled', 'discount_allowed')
# Plain fields a values patch may carry; `preset` changes only through a preset patch.
SCALAR_FIELDS = (*RANGES, *ENUMS, *BOOLEANS)
WRITABLE = (*SCALAR_FIELDS, 'terms', 'distribution_user_ids')


def dump_terms(effective):
    """The renamable terms in their wire shape, per language and form, with the grammatical gender."""
    return {
        term: {
            **{
                language: {form: effective[term_field(term, language, form)] for form in TERM_FORMS}
                for language in TERM_LANGUAGES
            },
            'gender': effective[term_gender_field(term)],
        }
        for term in TERM_KEYS
    }


def dump_settings(effective, revision, users):
    """The settings wire shape: values (terms nested), the allowed options, the revision and the names of the
    distribution agents (`users` is their recordset; the names are read here, never stored)."""
    values = {name: effective[name] for name in (
        'preset', *SCALAR_FIELDS, 'distribution_user_ids',
    )}
    values['terms'] = dump_terms(effective)
    return {
        'values': values,
        'distribution_users': [{'id': user.id, 'name': user.name} for user in users],
        'options': dump_options(),
        'revision': revision,
    }


def dump_options():
    return {
        'preset': list(PRESET_KEYS),
        **{name: list(options) for name, options in ENUMS.items()},
        'term_gender': list(TERM_GENDERS),
        **{name: {'min': low, 'max': high} for name, (low, high) in RANGES.items()},
    }


def parse_settings_patch(payload):
    """Validate a PATCH body into `{'revision', 'vals', 'user_ids'}`.

    `vals` holds flat model fields; `user_ids` is the new agent pool or None when untouched.
    """
    unknown = sorted(set(payload) - {'revision', 'values', 'preset'})
    if unknown:
        raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])
    revision = payload.get('revision')
    if type(revision) is not int or revision < 0:
        raise ApiError(422, 'invalid', 'revision must be a nonnegative integer', field='revision')
    if ('values' in payload) == ('preset' in payload):
        raise ApiError(422, 'invalid', 'send either values or preset', field='values')
    if 'preset' in payload:
        preset = payload['preset']
        if preset not in PRESETS:
            raise ApiError(422, 'invalid', 'unknown preset', field='preset')
        return {'revision': revision, 'vals': {**PRESETS[preset], 'preset': preset}, 'user_ids': None}
    values = payload['values']
    if not isinstance(values, dict) or not values:
        raise ApiError(422, 'invalid', 'values must be a non-empty object', field='values')
    unknown = sorted(set(values) - set(WRITABLE))
    if unknown:
        raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])
    vals = {}
    for name in SCALAR_FIELDS:
        if name in values:
            vals[name] = _parse_scalar(name, values[name])
    if 'terms' in values:
        vals.update(_parse_terms(values['terms']))
    return {'revision': revision, 'vals': vals, 'user_ids': _parse_user_ids(values.get('distribution_user_ids'))}


def _parse_scalar(name, value):
    if name in RANGES:
        low, high = RANGES[name]
        if type(value) is not int or not low <= value <= high:
            raise ApiError(422, 'invalid', f'must be a whole number from {low} to {high}', field=name)
    elif name in ENUMS:
        if value not in ENUMS[name]:
            raise ApiError(422, 'invalid', 'value is not an allowed option', field=name)
    elif type(value) is not bool:
        raise ApiError(422, 'invalid', 'must be true or false', field=name)
    return value


def _parse_user_ids(ids):
    if ids is None:
        return None
    if not isinstance(ids, list) or any(type(user_id) is not int for user_id in ids):
        raise ApiError(422, 'invalid', 'must be a list of user ids', field='distribution_user_ids')
    return sorted(set(ids))


def _parse_terms(terms):
    if not isinstance(terms, dict):
        raise _terms_error()
    vals = {}
    for term, body in terms.items():
        if term not in TERM_KEYS or not isinstance(body, dict):
            raise _terms_error()
        for key, value in body.items():
            if key == 'gender':
                if value not in TERM_GENDERS:
                    raise _terms_error()
                vals[term_gender_field(term)] = value
            elif key in TERM_LANGUAGES and isinstance(value, dict):
                for form, text in value.items():
                    if form not in TERM_FORMS:
                        raise _terms_error()
                    vals[term_field(term, key, form)] = _parse_term_text(text)
            else:
                raise _terms_error()
    return vals


def _parse_term_text(text):
    text = text.strip() if isinstance(text, str) else ''
    if not text or len(text) > TERM_MAX_LENGTH:
        raise _terms_error()
    return text


def _terms_error():
    message = f'terms: known terms and languages, singular/plural of 1 to {TERM_MAX_LENGTH} characters, gender m or f'
    return ApiError(422, 'invalid', message, field='terms')
