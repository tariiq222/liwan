# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

# The partner routes write a party's accounting fields under this marker, after liwan.customers.service wrote its
# identity: the liwan_core write guard lets a protected actor (a system administrator holding finance.partners.manage)
# write exactly these fields of a party that is no user's and no company's partner.
FINANCE_PARTNER_MARKER = 'liwan_finance.partner_ids'
FINANCE_PARTNER_FIELDS = frozenset({
    'vat', 'company_registry', 'street', 'city', 'state_id', 'country_id', 'customer_rank', 'supplier_rank',
})


class ResPartner(models.Model):
    _inherit = 'res.partner'

    @api.model
    def _liwan_marked_write_fields(self):
        return {**super()._liwan_marked_write_fields(), FINANCE_PARTNER_MARKER: FINANCE_PARTNER_FIELDS}
