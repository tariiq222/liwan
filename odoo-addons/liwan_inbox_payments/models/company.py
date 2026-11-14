# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models

# The two company facts a catalog price follows. Whether there is a tax at all is the establishment's VAT registration,
# which only the root company stores (every company of the establishment answers it through the derived
# ``liwan_establishment_vat_registered``); stock's price mode says whether the typed price carries the tax or has it
# added on top, and a root-delegated copy of it sits on every branch.
PRICE_FACT_FIELDS = ('liwan_vat_registered', 'account_price_include')


class ResCompany(models.Model):
    _inherit = 'res.company'

    def write(self, vals):
        """Resend the catalog items of an establishment whose price facts this write really changed.

        The old and the new value of each fact are compared on the companies being written, so a write that changes
        nothing resends nothing, and the resend is keyed by the establishment (the root company): the facts of a root
        decide the price of every catalog of its branches too, and the filter runs on the items' own table, so no
        record of a company the writer cannot read is touched. Base's own copy of a root's price mode to its branches
        is a write of the branches through this method, which names the same establishment.
        """
        watched = [name for name in PRICE_FACT_FIELDS if name in vals]
        previous = {(company.id, name): company[name] for company in self for name in watched}
        result = super().write(vals)
        changed = self.browse()
        for name in watched:
            moved = self.filtered(lambda company, name=name: previous[company.id, name] != company[name])
            if name == 'account_price_include' and moved:
                # Stock computes a tax's ``price_include`` from the company mode but declares no dependency on it, so
                # the value this transaction cached before the write would survive it. Read the new mode from here on.
                self.env['account.tax'].invalidate_model(['price_include', 'company_price_include'])
            changed |= moved
        if changed:
            self.env['liwan.inbox.catalog.item']._liwan_establishment_price_changed(changed.root_id.ids)
        return result
