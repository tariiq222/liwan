# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    if not version:
        return
    cr.execute(
        """
        SELECT id, features, policy_revision
          FROM nasq_tenant_profile
         ORDER BY id
        """,
    )
    rows = cr.fetchall()
    if len(rows) != 1:
        msg = 'nasq_platform: cannot initialize tenant policy without a single profile'
        raise ValueError(msg)
    profile_id, features, policy_revision = rows[0]
    if policy_revision and policy_revision >= 1 and features:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    env['nasq.tenant.profile'].browse(profile_id)._nasq_initialize_legacy_policy(
        env['nasq.feature.registry']._nasq_installed_module_ids(),
    )
