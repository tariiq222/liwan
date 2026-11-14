# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Archive every `account.tax` the online order service copied, then drop the column that linked them.

A copy was made so an order could charge with the tax inside or added while the original tax kept its own
behaviour. The order service no longer copies taxes: stock `res.company.account_price_include` decides for every
sale document. The copies stay in the database because posted documents name them, so they are archived through the
ORM, never deleted, and remain readable for the moves that already reference them.

Stage: `post-`, after this module's new code and data are loaded and before every `end-` script (finance clears the
sale taxes' overrides there and must see these copies archived). The column still exists here: an upgrade from an
earlier version has it, and Odoo 19 keeps a removed field's column (it only drops its NOT NULL constraint,
`odoo/orm/models.py` `_check_removed_columns`), so this script drops it itself, as the addon's earlier removals do.

The ids are read with a read-only `SELECT` because the ORM field is gone; the archive goes through the ORM.

R9 exception (direct SQL on an Odoo table): the only statement that changes the schema is
`ALTER TABLE account_tax DROP COLUMN liwan_copy_of_id`. `account_tax` is Odoo's table, but the column is one LiwanOS
itself added through `liwan_payments`'s former `account.tax` extension, so this removes our own column and no Odoo
column; no Odoo public API drops the column of a removed field. No row of the table is written by SQL: the copies are
archived through the ORM. `19.0.1.6.0/post-encrypt-gateway-keys.py` is the addon's other migration that
touches an Odoo table with SQL, for stock's own plain key columns.

The script is idempotent: a rerun finds no column and does nothing.
"""
import logging

from odoo import SUPERUSER_ID, api
from odoo.tools.sql import column_exists

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    if not version or not column_exists(cr, 'account_tax', 'liwan_copy_of_id'):
        return
    cr.execute('SELECT id FROM account_tax WHERE liwan_copy_of_id IS NOT NULL')
    copy_ids = [row[0] for row in cr.fetchall()]
    env = api.Environment(cr, SUPERUSER_ID, {})
    if copy_ids:
        env['account.tax'].with_context(active_test=False).browse(copy_ids).write({'active': False})
        _logger.info('Archived %d tax copies the online order service made.', len(copy_ids))
    # Odoo leaves the column of a removed field behind; one schema has no remnant of it.
    env.flush_all()
    cr.execute('ALTER TABLE account_tax DROP COLUMN liwan_copy_of_id')
