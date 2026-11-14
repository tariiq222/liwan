# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models


class AccountChartTemplate(models.AbstractModel):
    _inherit = 'account.chart.template'

    def _post_load_data(self, template_code, company, template_data):
        """A chart's purchase taxes say "tax added" as soon as the chart is loaded for a company."""
        result = super()._post_load_data(template_code, company, template_data)
        self.env['account.tax']._liwan_default_purchase_taxes_to_added(company or self.env.company)
        return result
