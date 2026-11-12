# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.exceptions import AccessError

from .res_partner import PARTY_MARKER

# Stock res.partner.write renames the holder of a partner's bank accounts, as the caller, when it renames the partner.
HOLDER_FIELDS = frozenset({'acc_holder_name'})
# The capability that renames a customer from the customers routes; its ACL row on res.partner.bank exists for that
# rename only. It is the capability group, not the party writer: Finance's own group implies the party writer, so an
# ACL on the writer would absorb Finance's own bank right in the stock group expression and hide it from the check.
RENAME_GROUP = 'liwan_customers.group_cap_customers_manage'


class ResPartnerBank(models.Model):
    _inherit = 'res.partner.bank'

    def write(self, vals):
        if not self.env.is_superuser() and self._liwan_rename_right_only() and not self._liwan_party_rename(vals):
            msg = 'use_liwan_customers_service:res_partner_bank_write:%s' % ','.join(sorted(vals))
            raise AccessError(msg)
        return super().write(vals)

    def _liwan_rename_right_only(self):
        """Whether the caller may write bank accounts only through the customers manage capability.

        Stock ``ir.model.access._get_access_groups`` gives the groups whose ACL rows grant the write; the caller's
        groups (implied ones included) less the capability group are matched against them, read fresh on every call.
        """
        group = self.env.ref(RENAME_GROUP, raise_if_not_found=False)
        groups = set(self.env.user._get_group_ids())
        if not group or group.id not in groups:
            return False
        granting = self.env['ir.model.access']._get_access_groups(self._name, 'write')
        return not granting.matches(groups - {group.id})

    def _liwan_party_rename(self, vals):
        """Whether ``vals`` only renames the holder of accounts whose parties liwan.customers.service is renaming."""
        party_ids = self.env.cr.precommit.data.get(PARTY_MARKER, set())
        return set(vals) <= HOLDER_FIELDS and set(self.partner_id.ids) <= party_ids
