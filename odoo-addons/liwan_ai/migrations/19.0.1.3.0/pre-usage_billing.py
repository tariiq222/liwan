# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Usage rows recorded before 19.0.1.3.0 were all platform calls: the tenant key did not exist yet."""
from odoo.tools.sql import column_exists, create_column


def migrate(cr, version):
    if not version or column_exists(cr, 'liwan_ai_usage', 'billing'):
        return
    create_column(cr, 'liwan_ai_usage', 'billing', 'varchar')
    cr.execute("UPDATE liwan_ai_usage SET billing = 'platform'")
