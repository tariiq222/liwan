# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Move the default brand colour to the WebVue lavender.

``base.main_company`` is ``noupdate``, so the data file alone never rewrites an existing
database. A company still on an earlier default (midnight or one of the blues) is moved; any
colour a tenant chose is kept. Re-running the script changes nothing.
"""

OLD_DEFAULTS = ('#13234a', '#0046d5', '#0066cc', '#007ff8')
NEW_DEFAULT = '#5B3F8C'


def migrate(cr, version):
    if not version:
        return
    cr.execute(
        'UPDATE res_company SET primary_color = %s WHERE lower(primary_color) IN %s',
        (NEW_DEFAULT, OLD_DEFAULTS),
    )
