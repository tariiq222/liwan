# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import UserError

from .models.res_company import DEFAULT_PRICE_MODE
from odoo.addons.liwan_api.models.tax_upgrade import (
    PAYMENTS_PRICE_MODE_CARRIED,
    refuse_open_documents_with_changed_company_modes,
)


def post_init_hook(env):
    """Apply the default to every establishment that has not started accounting, and to every purchase tax.

    A root with a journal item (its own or a branch's, ``_existing_accounting`` walks the children) keeps the
    value its documents were computed under; stock refuses the change anyway. Otherwise the write is on the root:
    base propagates it to the active branches, and a branch reactivated later takes it from its parent.
    """
    Company = env['res.company'].with_context(active_test=False)
    carried = getattr(env.registry, PAYMENTS_PRICE_MODE_CARRIED, False)
    for root in Company.search([('parent_id', '=', False)]):
        branches = Company.search([('id', 'child_of', root.id), ('id', '!=', root.id)], order='parent_path')
        if not carried and not root._existing_accounting():
            establishment = root | branches
            refuse_open_documents_with_changed_company_modes(env, establishment, DEFAULT_PRICE_MODE)
            if any(company.account_price_include != DEFAULT_PRICE_MODE for company in establishment):
                root.write({'account_price_include': DEFAULT_PRICE_MODE})
        _align_branches(root, branches)
    env['account.tax']._liwan_default_purchase_taxes_to_added(Company.search([]))


def _align_branches(root, branches):
    """Give every branch of ``root`` the root's price mode, which the old model let a branch hold apart from it.

    From now on base's ``_check_root_delegated_fields`` refuses any write touching a delegated field of a branch
    that differs, so the establishment keeps the root's value. Stock refuses changing a company that has journal
    items, and ``_existing_accounting`` on a branch counts its own subtree only: a branch aligns when it holds none
    and its parent already carries the root's value (branches go from the top, so a parent that aligned counts).
    An incompatible branch stops installation before the bridge can expose two modes for the establishment.
    """
    mode = root.account_price_include
    differing = branches.filtered(lambda branch: branch.account_price_include != mode)
    for branch in differing:
        if branch._existing_accounting():
            raise UserError(root.env._(
                "Branch %(branch)s uses %(branch_mode)s while its root %(root)s uses %(root_mode)s. "
                "The branch has journal items. Restore the database and filestore from before the upgrade "
                "and have the operator reconcile the two modes before retrying.",
                branch=branch.display_name, branch_mode=branch.account_price_include,
                root=root.display_name, root_mode=mode,
            ))
    refuse_open_documents_with_changed_company_modes(root.env, differing, mode)
    for branch in differing:
        branch.write({'account_price_include': mode})
