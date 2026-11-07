# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The free agents' budget limit ``ai.setup.monthly`` is now ``ai.assist.monthly`` (setup and help messages count against it).

A tenant profile of a development database still stores the old key in its features; it moves, with its value, to the new
one, because the strict feature validation refuses an unknown key on the profile's next write."""


def migrate(cr, version):
    if not version:
        return
    cr.execute(
        """
        UPDATE liwan_tenant_profile
           SET features = (features - 'ai.setup.monthly')
                          || CASE WHEN jsonb_exists(features, 'ai.assist.monthly') THEN '{}'::jsonb
                                  ELSE jsonb_build_object('ai.assist.monthly', features -> 'ai.setup.monthly') END
         WHERE jsonb_exists(features, 'ai.setup.monthly')
        """,
    )
