# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The connection model stops being a status-only list keyed by `kind`.

The old rows (one ZATCA link per company, status only) hold no account: ZATCA status is now derived from
the finance journals, so the rows are deleted. The `kind` column goes with its unique key. A database that
already has the new shape (no `kind` column) is left alone, which makes the script idempotent.
"""


def migrate(cr, version):
    if not version:
        return
    cr.execute(
        """SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'liwan_integration_connection' AND column_name = 'kind'""",
    )
    if not cr.fetchone():
        return
    cr.execute('DELETE FROM liwan_integration_connection')
    cr.execute('ALTER TABLE liwan_integration_connection DROP COLUMN kind')
