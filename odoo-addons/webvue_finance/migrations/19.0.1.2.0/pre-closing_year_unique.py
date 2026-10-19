# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Refuse the upgrade when a company holds two year-end closing entries for one fiscal year.

The unique index ``(company_id, webvue_closing_year)`` of ``account.move`` cannot be built over such
duplicates, and Odoo would only log that and carry on without the index.
"""
from odoo.tools.sql import column_exists


def migrate(cr, version):
    if not version or not column_exists(cr, 'account_move', 'webvue_closing_year'):
        return
    cr.execute(
        """
            SELECT company_id, webvue_closing_year
              FROM account_move
             WHERE webvue_closing_year != 0
          GROUP BY company_id, webvue_closing_year
            HAVING COUNT(*) > 1
             LIMIT 1
        """,
    )
    duplicate = cr.fetchone()
    if duplicate:
        msg = (
            f'webvue_finance migration: company {duplicate[0]} has more than one closing entry for fiscal '
            f'year {duplicate[1]}. Reset or delete the extra entries (account_move.webvue_closing_year), '
            f'then run the upgrade again.'
        )
        raise ValueError(msg)
