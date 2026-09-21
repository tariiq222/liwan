# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Initialize legacy full-product entitlements after a first install.

Usage, from provision.sh after ``-i`` and before branding:

    odoo shell -d <db> --no-http < /seed/seed_legacy_policy.py
"""
profile = env['nasq.tenant.profile']  # noqa: F821
registry = env['nasq.feature.registry']  # noqa: F821
record = profile._nasq_initialize_legacy_policy(registry._nasq_installed_module_ids())
env.cr.commit()  # noqa: F821
print(  # noqa: T201
    'legacy policy initialized:',
    record.policy_revision,
    sorted((record.features or {}).items()),
)
