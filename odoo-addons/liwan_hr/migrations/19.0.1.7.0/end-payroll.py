# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Carry the stored hr.enabled value onto the new hr.payroll sub-feature.

A key an application adds after a tenant's one-shot policy is registered closed
(``False``), which would switch payroll off on a database that carries a development
policy forward. The step is idempotent, and a fresh install needs nothing: the feature
registry and ``_liwan_legacy_features_for`` already produce this state.
"""
from odoo import SUPERUSER_ID, api

from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

PAYROLL_FEATURE = 'hr.payroll'


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    _carry_hr_enabled(env)


def _carry_hr_enabled(env):
    """Copy the stored hr.enabled value onto hr.payroll."""
    service = env['liwan.entitlement.service']
    for profile in env['liwan.tenant.profile'].search([]):
        stored = profile.features if isinstance(profile.features, dict) else {}
        if 'hr.enabled' not in stored:
            continue
        features = service._liwan_close_unlisted_features(stored)
        enabled = stored['hr.enabled']
        if features.get(PAYROLL_FEATURE) == enabled:
            continue
        features[PAYROLL_FEATURE] = enabled
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': features})
