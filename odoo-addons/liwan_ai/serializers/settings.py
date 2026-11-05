# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_ai.models import consent_text
from odoo.addons.liwan_ai.models.ai_settings import PROVIDER_MODES
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.serializers.common import iso

PATCH_KEYS = frozenset({'provider_mode', 'revision'})
CONSENT_KEYS = frozenset({'text_version', 'text_hash'})


def _person(user):
    return {'id': user.id, 'name': user.name}


def dump_consent(consent):
    if not consent:
        return None
    return {'user': _person(consent.user_id), 'signed_at': iso(consent.signed_at), 'text_version': consent.text_version}


def dump_settings(env):
    """The settings page's whole state: provider mode, consent, and this month's usage against the limits."""
    settings = env['liwan.ai.settings']._liwan_current()
    entitlement = env['liwan.entitlement.service']
    audit = env['liwan.ai.audit']
    return {
        'provider_mode': settings.provider_mode,
        'revision': settings.revision,
        'consent': {
            'required_version': consent_text.CONSENT_VERSION,
            'text_ar': consent_text.CONSENT_TEXT_AR,
            'text_en': consent_text.CONSENT_TEXT_EN,
            'text_hash': consent_text.CONSENT_TEXT_HASH,
            'signed': dump_consent(env['liwan.ai.consent']._liwan_valid()),
        },
        'usage': {
            'month': audit._liwan_ai_month_start().strftime('%Y-%m'),
            'messages_used': audit._liwan_ai_count_messages(),
            'messages_limit': entitlement._liwan_limit_value('ai.messages.monthly'),
            'tokens_used': env['liwan.ai.usage']._liwan_platform_tokens_used(),
            'tokens_limit': entitlement._liwan_limit_value('ai.tokens.monthly'),
            'output_tokens_per_run': entitlement._liwan_limit_value('ai.output_tokens.per_run'),
        },
    }


def _require_exact_keys(payload, keys):
    unknown = sorted(set(payload) - keys)
    if unknown:
        raise ApiError(422, 'unknown_field', f'field {unknown[0]!r} is not accepted', field=unknown[0])
    missing = sorted(keys - set(payload))
    if missing:
        raise ApiError(422, 'invalid', f'{missing[0]} is required', field=missing[0])


def parse_settings_patch(payload):
    """``(provider_mode, revision)`` of a settings write, or a 422 naming the bad field."""
    _require_exact_keys(payload, PATCH_KEYS)
    provider_mode, revision = payload['provider_mode'], payload['revision']
    if provider_mode not in PROVIDER_MODES:
        raise ApiError(422, 'invalid', f'provider_mode must be one of {PROVIDER_MODES}', field='provider_mode')
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise ApiError(422, 'invalid', 'revision must be a positive integer', field='revision')
    return provider_mode, revision


def parse_consent(payload):
    """Refuse a signature unless the signer's client showed the current text: same version, same hash."""
    _require_exact_keys(payload, CONSENT_KEYS)
    if payload['text_version'] != consent_text.CONSENT_VERSION:
        raise ApiError(422, 'invalid', 'this consent text version is not the current one', field='text_version')
    if payload['text_hash'] != consent_text.CONSENT_TEXT_HASH:
        raise ApiError(422, 'invalid', 'the consent text does not match the current one', field='text_hash')
