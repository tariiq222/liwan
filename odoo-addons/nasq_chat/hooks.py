# Part of Odoo. See LICENSE file for full copyright and licensing details.


def post_init_hook(env):
    profile = env.ref('nasq_platform.tenant_profile', raise_if_not_found=False)
    if not profile or not profile.root_company_id:
        msg = 'nasq_chat: cannot backfill discuss_channel.company_id without nasq_platform.tenant_profile'
        raise ValueError(msg)
    env.cr.execute(
        'UPDATE discuss_channel SET company_id = %s WHERE company_id IS NULL',
        [profile.root_company_id.id],
    )
