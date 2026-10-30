# Part of Odoo. See LICENSE file for full copyright and licensing details.


def migrate(cr, version):
    if not version:
        return
    cr.execute('SELECT root_company_id FROM liwan_tenant_profile LIMIT 2')
    rows = cr.fetchall()
    if len(rows) != 1 or not rows[0][0]:
        msg = (
            'liwan_chat: cannot backfill discuss_channel.company_id without a single '
            'liwan.tenant.profile.root_company_id'
        )
        raise ValueError(msg)
    cr.execute(
        'UPDATE discuss_channel SET company_id = %s WHERE company_id IS NULL',
        [rows[0][0]],
    )
