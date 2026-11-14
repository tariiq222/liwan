# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.liwan_core.models.protected_write import marked

# The owner's default (D5): the price typed on a product is what the customer pays.
DEFAULT_PRICE_MODE = 'tax_included'
# The marker this addon sets around its own two writes of the establishment's single price mode (the route's root
# write and a reactivated branch's copy of its parent's value), and nothing else.
PRICE_MODE_MARKER = 'liwan_api_account.price_mode_company_ids'
PRICE_MODE_FIELDS = frozenset({'account_price_include'})


class ResCompany(models.Model):
    _inherit = 'res.company'

    def _get_company_root_delegated_field_names(self):
        """The establishment's price mode is one value, so stock keeps every branch on its root's.

        Base copies a delegated field from the root on ``create`` and on a root ``write`` (its own elevated
        propagation, to the active branches), and ``_check_root_delegated_fields`` refuses a branch that differs.
        """
        return super()._get_company_root_delegated_field_names() + ['account_price_include']

    @api.model_create_multi
    def create(self, vals_list):
        """A new root starts at "price includes tax"; a branch takes its root's value from base's delegation.

        Set here rather than as a field default: stock's own default is ``tax_excluded``, and the
        establishment-wide default is LiwanOS policy. An explicit value in ``vals`` always wins.
        """
        for vals in vals_list:
            if not vals.get('parent_id'):
                vals.setdefault('account_price_include', DEFAULT_PRICE_MODE)
        return super().create(vals_list)

    def write(self, vals):
        result = super().write(vals)
        if vals.get('active') is True:
            self._liwan_sync_price_mode_from_parent()
        return result

    @api.model
    def _liwan_marked_write_fields(self):
        """Let ``liwan.company.tax.service._liwan_write`` through the core guard for this one field."""
        return {**super()._liwan_marked_write_fields(), PRICE_MODE_MARKER: PRICE_MODE_FIELDS}

    def _liwan_sync_price_mode_from_parent(self):
        """Give a reactivated branch its parent's price mode again.

        Stock's propagation on a root ``write`` reaches the active branches only, so an archived branch keeps the
        mode it had when it was archived. LiwanOS reactivates a branch by writing ``active`` on its company
        (``liwan.tenant.profile._liwan_restore_branch``), so the copy happens once that write has been accepted: the
        branch is active, and stock's ``_check_root_delegated_fields`` sees the two values equal. The value is the
        parent's, never a caller's, and it goes through this addon's own marker in the core write guard.
        """
        for company in self.filtered('parent_id'):
            parent_mode = company.parent_id.account_price_include
            if company.account_price_include != parent_mode:
                with marked(self.env, {PRICE_MODE_MARKER: company.ids}):
                    company.write({'account_price_include': parent_mode})
