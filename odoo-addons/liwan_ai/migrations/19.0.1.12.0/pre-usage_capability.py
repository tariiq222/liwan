# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Usage rows recorded before 19.0.1.12.0 carry no capability: every call ran on the one configured model, which is ``standard``."""
from odoo.tools.sql import column_exists, create_column


def migrate(cr, version):
    if not version or column_exists(cr, 'liwan_ai_usage', 'capability'):
        return
    create_column(cr, 'liwan_ai_usage', 'capability', 'varchar')
    cr.execute("UPDATE liwan_ai_usage SET capability = 'standard'")
