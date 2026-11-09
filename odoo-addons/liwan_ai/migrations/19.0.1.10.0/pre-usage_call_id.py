# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Usage rows recorded before 19.0.1.10.0 carry no provider `call_id`, so two of them cannot be told apart from a re-sent one.

The ledger is a development artifact before release, and the clean schema needs every row to have the identity the unique
index is built on. Rather than invent one, the pre-migration clears what the old shape recorded; from this version on each
row carries the provider's own call id (issue #557).
"""
from odoo.tools.sql import column_exists


def migrate(cr, version):
    if not version or column_exists(cr, 'liwan_ai_usage', 'call_id'):
        return
    cr.execute('DELETE FROM liwan_ai_usage')
