# Part of Odoo. See LICENSE file for full copyright and licensing details.


def migrate(cr, version):
    """The recording settings are the database's, not one row per company: the ``company_id`` column is gone.

    Odoo never drops the column of a removed field, and this one is NOT NULL, so it must go before the installed
    settings record (``data/telephony_settings.xml``) is created: the insert of the clean row would be rejected. A
    database that never held the table has nothing to drop.
    """
    if not version:
        return
    cr.execute('ALTER TABLE IF EXISTS liwan_telephony_settings DROP COLUMN IF EXISTS company_id')
