# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models


class ResCompany(models.Model):
    _inherit = 'res.company'

    def write(self, vals):
        previous = {company.id: company.liwan_vat_registered for company in self} if 'liwan_vat_registered' in vals else {}
        result = super().write(vals)
        changed = [company.id for company in self.filtered(lambda company: previous.get(company.id) != company.liwan_vat_registered)]
        if 'liwan_vat_registered' in vals and changed:
            self.env['liwan.inbox.catalog.item']._liwan_vat_registration_changed(changed)
        return result
