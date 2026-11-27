# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


def lookup_order(user, first=None):
    """The company ids a cross-company lookup tries, ``first`` then the other companies ``user`` belongs to.

    The company fence and the record rules admit one company at a time, so a record that may belong to any company
    of a tenant (a call, an extension number) is looked up company by company; the caller's own company comes first
    and the rest follow by id, so the answer never depends on a search order.
    """
    ids = [first.id] if first else []
    return ids + sorted(other_id for other_id in user.company_ids.ids if other_id not in ids)


class LiwanTelephonyResCompany(models.Model):
    _inherit = 'res.company'

    @api.model_create_multi
    def create(self, vals_list):
        companies = super().create(vals_list)
        # Only an Odoo system administrator creates a company (liwan_core), so the write below is theirs to make.
        self.env['liwan.access.service']._liwan_sync_events_companies()
        return companies
