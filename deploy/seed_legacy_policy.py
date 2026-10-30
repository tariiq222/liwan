# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Initialize legacy full-product entitlements after a first install.

Usage, from provision.sh after ``-i`` and before branding:

    odoo shell -d <db> --no-http < /seed/seed_legacy_policy.py
"""
profile = env['liwan.tenant.profile']  # noqa: F821
registry = env['liwan.feature.registry']  # noqa: F821
record = profile._liwan_initialize_legacy_policy(registry._liwan_installed_module_ids())
env.cr.commit()  # noqa: F821
print(  # noqa: T201
    'legacy policy initialized:',
    record.policy_revision,
    sorted((record.features or {}).items()),
)
