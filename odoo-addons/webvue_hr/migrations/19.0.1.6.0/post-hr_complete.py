# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Carry the HR release data that XML cannot apply on an upgrade.

Two things change stored data in 19.0.1.6.0:

* the stock employee plans of the ``hr`` engine (``hr.onboarding_plan`` and
  ``hr.offboarding_plan``) become the onboarding and offboarding plans. Those records are
  ``noupdate`` data of ``hr``, so ``data/hr_plan_purpose_data.xml`` writes them on a fresh
  install only;
* the five new HR sub-features. A key an application adds after a tenant's one-shot policy
  is registered closed (``False``), which would switch the five areas off on a database
  that carries a development policy forward, so the stored ``hr.enabled`` value is copied
  onto the five keys instead.

Both steps are idempotent, and a fresh install needs neither: the XML data and
``_webvue_legacy_features_for`` already produce this state.
"""
from odoo import SUPERUSER_ID, api

from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT

# (stock plan xml id, purpose) — the same pair as data/hr_plan_purpose_data.xml.
PLAN_PURPOSES = (
    ('hr.onboarding_plan', 'onboarding'),
    ('hr.offboarding_plan', 'offboarding'),
)
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
    _apply_plan_purposes(env)
    _carry_hr_enabled(env)


def _apply_plan_purposes(env):
    """Label the stock employee plans; the records are noupdate, so XML skips them here."""
    for xmlid, purpose in PLAN_PURPOSES:
        plan = env.ref(xmlid, raise_if_not_found=False)
        if not plan:
            msg = f'webvue_hr: {xmlid} is missing; the hr engine must be installed'
            raise ValueError(msg)
        if plan.hr_purpose != purpose:
            plan.write({'hr_purpose': purpose})


def _carry_hr_enabled(env):
    """Copy the stored hr.enabled value onto the five new sub-feature keys."""
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
