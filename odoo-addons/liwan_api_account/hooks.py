# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import UserError

from .models.res_company import DEFAULT_PRICE_MODE


def post_init_hook(env):
    """Apply the default to every establishment that has not started accounting, and to every purchase tax.

    A root with a journal item (its own or a branch's, ``_existing_accounting`` walks the children) keeps the
    value its documents were computed under; stock refuses the change anyway. Otherwise the write is on the root:
    base propagates it to the active branches, and a branch reactivated later takes it from its parent.
    """
    Company = env['res.company'].with_context(active_test=False)
    for root in Company.search([('parent_id', '=', False)]):
        if not root._existing_accounting():
            root.write({'account_price_include': DEFAULT_PRICE_MODE})
        _align_branches(Company, root)
    env['account.tax']._liwan_default_purchase_taxes_to_added(Company.search([]))


def _align_branches(Company, root):
    """Give every branch of ``root`` the root's price mode, which the old model let a branch hold apart from it.

    From now on base's ``_check_root_delegated_fields`` refuses any write touching a delegated field of a branch
    that differs, so the establishment keeps the root's value. Stock refuses changing a company that has journal
    items, and ``_existing_accounting`` on a branch counts its own subtree only: a branch aligns when it holds none
    and its parent already carries the root's value (branches go from the top, so a parent that aligned counts).
    An incompatible branch stops installation before the bridge can expose two modes for the establishment.
    """
    mode = root.account_price_include
    for branch in Company.search([('parent_id', 'child_of', root.id), ('id', '!=', root.id)], order='parent_path'):
        if branch.account_price_include == mode:
            continue
        if branch._existing_accounting():
            raise UserError(Company.env._(
                "Branch %(branch)s uses %(branch_mode)s while its root %(root)s uses %(root_mode)s. "
                "The branch has journal items. Restore the database and filestore from before the upgrade "
                "and have the operator reconcile the two modes before retrying.",
                branch=branch.display_name, branch_mode=branch.account_price_include,
                root=root.display_name, root_mode=mode,
            ))
        branch.write({'account_price_include': mode})
