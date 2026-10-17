# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Move the default brand colour from midnight to the WebVue brand blue.

``base.main_company`` is ``noupdate``, so the data file alone never rewrites an existing
database. A company still on the old default is moved; any colour a tenant chose is kept.
Re-running the script changes nothing.
"""

OLD_DEFAULT = '#13234a'
NEW_DEFAULT = '#0046d5'


def migrate(cr, version):
    if not version:
        return
    cr.execute(
        'UPDATE res_company SET primary_color = %s WHERE lower(primary_color) = %s',
        (NEW_DEFAULT, OLD_DEFAULT),
    )
