# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Carry each establishment's old payments tax mode into stock `res.company.account_price_include`, then drop the column.

The payments setting `liwan.payments.settings.tax_mode` (`included` or `added`, its row or `included` by default)
was one answer per company. Stock now owns the one answer for the whole establishment, so the root's old mode is
written on the root and on every branch, archived ones included, in one write. With `liwan_api_account` installed
(it auto-installs next to this addon, so it is in the registry when this script runs) the field is root-delegated and
base copies a root write to its branches itself (`odoo/addons/base/models/res_company.py` `write`, "Copy modified
delegated fields from root to branches"), but that copy searches with the root recordset's own context, so whether an
archived branch is reached depends on the caller's `active_test`; without the bridge nothing copies at all. The
migration therefore names the branches it read with `active_test=False` and does not rely on either: an archived
branch must carry the establishment's one value too, or reactivating it would leave a branch that differs from its
root, which `_check_root_delegated_fields` refuses. One write also means that constraint sees one value. A branch that
stored a different mode stops the upgrade. A retry starts by restoring the database and filestore from before
the upgrade (docs/migrations.md).

Stage: `post-`. Odoo's module graph upgrades installed modules before installing the new accounting bridge
alongside them. The bridge sees the successful carry on the same registry and keeps the migrated values
instead of applying its default. This also lets Finance's end migration compare against the final mode. Odoo
19 keeps a removed field's column (it only drops its NOT NULL constraint, `odoo/orm/models.py`
`_check_removed_columns`), so this script reads it and drops it at the end. The values are read with a read-only
`SELECT` because the ORM field is gone; every company write goes through the ORM.

An establishment that already has a journal item keeps the value its accounting documents were computed under;
when that differs from the carried mode it is logged by name for the operator, and nothing is rewritten, because
stock's own constraint refuses the change.
"""
import logging

from odoo import SUPERUSER_ID, api
from odoo.exceptions import UserError
from odoo.tools.sql import column_exists

from odoo.addons.liwan_api.models.tax_upgrade import (
    PAYMENTS_PRICE_MODE_CARRIED,
    refuse_open_documents_with_changed_company_modes,
)

_logger = logging.getLogger(__name__)

STOCK_PRICE_INCLUDE = {'included': 'tax_included', 'added': 'tax_excluded'}
DEFAULT_TAX_MODE = 'included'


def _root(company):
    while company.parent_id:
        company = company.parent_id
    return company


def _stored_modes(cr):
    cr.execute('SELECT company_id, tax_mode FROM liwan_payments_settings WHERE tax_mode IS NOT NULL')
    return dict(cr.fetchall())


def _establishments(env, modes, companies):
    """Every root with its branches and the mode to carry, or a refusal when a branch disagrees with its root.

    All establishments are checked before anything is written, so an ambiguous state stops the upgrade with no
    partial carry behind it.
    """
    for root in companies.filtered(lambda company: not company.parent_id):
        mode = modes.get(root.id, DEFAULT_TAX_MODE)
        branches = companies.filtered(lambda company, root=root: company != root and _root(company) == root)
        for branch in branches:
            branch_mode = modes.get(branch.id)
            if branch_mode is not None and branch_mode != mode:
                msg = env._(
                    "The payments tax mode of branch %(branch)s is %(branch_mode)s but its root %(root)s is "
                    "%(mode)s. Restore the database and filestore from before the upgrade, then align both payment "
                    "tax modes before retrying.",
                    branch=branch.display_name, branch_mode=branch_mode, root=root.display_name, mode=mode,
                )
                raise UserError(msg)
        yield root, branches, mode


def migrate(cr, version):
    if not version or not column_exists(cr, 'liwan_payments_settings', 'tax_mode'):
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    companies = env['res.company'].with_context(active_test=False).search([])
    establishments = list(_establishments(env, _stored_modes(cr), companies))
    for root, branches, mode in establishments:
        stock_value = STOCK_PRICE_INCLUDE[mode]
        if not root._existing_accounting():
            companies = root | branches
            refuse_open_documents_with_changed_company_modes(env, companies, stock_value)
            if any(company.account_price_include != stock_value for company in companies):
                companies.write({'account_price_include': stock_value})
        elif root.account_price_include != stock_value:
            _logger.warning(
                "Company %s keeps its stock tax mode %s, not the payments tax mode %s it was set to: it already has "
                "journal items, whose amounts were computed under the stock value.",
                root.display_name, root.account_price_include, stock_value,
            )
    # Odoo leaves the column of a removed field behind; one schema has no remnant of it.
    env.flush_all()
    cr.execute('ALTER TABLE liwan_payments_settings DROP COLUMN tax_mode')
    setattr(env.registry, PAYMENTS_PRICE_MODE_CARRIED, True)
