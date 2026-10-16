# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    if not version:
        return
    cr.execute(
        """
        SELECT id, features, policy_revision
          FROM webvue_tenant_profile
         ORDER BY id
        """,
    )
    rows = cr.fetchall()
    if len(rows) != 1:
        msg = 'webvue_platform: cannot initialize tenant policy without a single profile'
        raise ValueError(msg)
    profile_id, features, policy_revision = rows[0]
    if policy_revision and policy_revision >= 1 and features:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    env['webvue.tenant.profile'].browse(profile_id)._webvue_initialize_legacy_policy(
        env['webvue.feature.registry']._webvue_installed_module_ids(),
    )
