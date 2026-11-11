# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Assign the Riyadh billing month to previously charged platform usage.

Run after Odoo creates the usage columns, including ``charge_reported`` on upgrades
that start before charge tracking. The ledger stores each window start as naive UTC.
"""


def migrate(cr, version):
    if not version:
        return
    cr.execute(
        "UPDATE liwan_ai_usage SET allowance_window_start ="
        " date_trunc('month', called_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh' AT TIME ZONE 'UTC'"
        " WHERE billing = 'platform' AND charge_reported AND allowance_window_start IS NULL",
    )
