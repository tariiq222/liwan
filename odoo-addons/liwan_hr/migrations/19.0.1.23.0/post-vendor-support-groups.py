# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, Command, api

# Stock and OCA groups that hold the seeded support account directly. Their records sit in noupdate blocks, so the
# unlink in security/hr_capability_groups.xml is skipped on an existing database and is repeated here.
SUPPORT_ACCOUNT_GROUPS = (
    'hr_recruitment.group_hr_recruitment_manager',
    'payroll.group_payroll_manager',
)


def migrate(cr, version):
    """Vendor support is closed by default: drop the manager group it was implied to hold.

    Removing a group link from XML never unlinks an existing one, so it is removed here.
    """
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    env.ref('liwan_core.group_vendor_support').write({
        'implied_ids': [Command.unlink(env.ref('liwan_hr.group_hr_manager').id)],
    })
    support_account = env.ref('base.user_admin')
    for xmlid in SUPPORT_ACCOUNT_GROUPS:
        group = env.ref(xmlid, raise_if_not_found=False)
        if group:
            group.write({'user_ids': [Command.unlink(support_account.id)]})
