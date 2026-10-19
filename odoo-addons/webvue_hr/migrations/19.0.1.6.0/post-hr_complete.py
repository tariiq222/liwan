# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Carry the stored HR value onto the five new HR sub-features.

``webvue_hr`` 19.0.1.6.0 registers ``hr.recruitment``, ``hr.shifts``, ``hr.onboarding``,
``hr.offboarding`` and ``hr.assets``. A key an application adds after a tenant's one-shot
policy is registered closed (``False``), which would switch the five areas off on a database
that carries a development policy forward. This script copies the stored value of
``hr.enabled`` onto the five keys instead, so every profile that has HR open keeps the new
areas open.

A fresh install needs nothing from here: ``_webvue_legacy_features_for`` grants every
``webvue_hr`` boolean when HR is selected, and a profile without a stored ``hr.enabled`` has
no grant to carry. Idempotent.
"""
from odoo import SUPERUSER_ID, api

from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT

SUB_FEATURE_KEYS = (
    'hr.recruitment',
    'hr.shifts',
    'hr.onboarding',
    'hr.offboarding',
    'hr.assets',
)


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    service = env['webvue.entitlement.service']
    for profile in env['webvue.tenant.profile'].search([]):
        stored = profile.features if isinstance(profile.features, dict) else {}
        if 'hr.enabled' not in stored:
            continue
        features = service._webvue_close_unlisted_features(stored)
        enabled = stored['hr.enabled']
        if all(features.get(key) == enabled for key in SUB_FEATURE_KEYS):
            continue
        for key in SUB_FEATURE_KEYS:
            features[key] = enabled
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': features})
