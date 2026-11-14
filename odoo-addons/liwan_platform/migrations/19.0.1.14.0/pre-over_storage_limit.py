# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Carry the storage flag of attachments to its new column name and drop the index under the old name."""
from odoo.tools.sql import column_exists, rename_column


def migrate(cr, version):
    if not version:
        return
    if column_exists(cr, 'ir_attachment', 'liwan_storage_blocked'):
        rename_column(cr, 'ir_attachment', 'liwan_storage_blocked', 'liwan_over_storage_limit')
    cr.execute('DROP INDEX IF EXISTS ir_attachment_liwan_storage_blocked_idx')
