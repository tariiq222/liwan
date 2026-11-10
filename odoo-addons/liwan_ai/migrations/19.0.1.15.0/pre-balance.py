# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The prepaid balance (spec 2026-11-10 §5.4).

* Usage rows carry the part of their charge taken from the balance. A row recorded before this version was never deducted from
  a balance, so its paid part is 0.
* A charged platform row records the start of the free-allowance window it was settled against (``allowance_window_start``,
  naive UTC); existing rows get the start of the Asia/Riyadh month of their ``called_at`` (no trial existed before this version).
* The settings carry the monthly spend ceiling; 0 means none.
* The tenant profile keeps the running total of those paid parts (``ai_paid_total``, added by liwan_platform, which loads first):
  it is set to the sum of the rows.
* The foreign keys of ``user_id`` and ``company_id`` of the usage and audit tables change from ``ON DELETE CASCADE`` to
  ``ON DELETE RESTRICT`` (the ledger and the message counts must outlive nothing but themselves). The ordinary ``-u`` load
  recreates them from the field definitions; no data changes.
"""
from odoo.tools.sql import column_exists, create_column


def migrate(cr, version):
    if not version:
        return
    if not column_exists(cr, 'liwan_ai_usage', 'charge_paid'):
        create_column(cr, 'liwan_ai_usage', 'charge_paid', 'int4')
        cr.execute('UPDATE liwan_ai_usage SET charge_paid = 0')
    if not column_exists(cr, 'liwan_ai_usage', 'allowance_window_start'):
        create_column(cr, 'liwan_ai_usage', 'allowance_window_start', 'timestamp')
    cr.execute(
        "UPDATE liwan_ai_usage SET allowance_window_start ="
        " date_trunc('month', called_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh' AT TIME ZONE 'UTC'"
        " WHERE billing = 'platform' AND charge_reported AND allowance_window_start IS NULL",
    )
    if not column_exists(cr, 'liwan_ai_settings', 'monthly_spend_ceiling'):
        create_column(cr, 'liwan_ai_settings', 'monthly_spend_ceiling', 'int4')
        cr.execute('UPDATE liwan_ai_settings SET monthly_spend_ceiling = 0')
    cr.execute('UPDATE liwan_tenant_profile SET ai_paid_total = (SELECT COALESCE(SUM(charge_paid), 0) FROM liwan_ai_usage)')
