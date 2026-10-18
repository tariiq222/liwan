# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import UserError


class WebVueFinanceMisReport(models.AbstractModel):
    """Evaluates a ``mis.report`` template with mis_builder's public ``evaluate`` API.

    The templates (profit and loss, balance sheet, Zakat base) are data of this addon
    (``data/finance_mis_reports.xml``); the formula of a figure is the expression of its KPI.
    """
    _name = 'webvue.finance.mis.report'
    _description = 'WebVue finance MIS report evaluation'

    @api.model
    def _webvue_evaluate(self, template_xmlid, company, date_from, date_to, only_posted):
        """``(template, [(kpi, amount)])`` in the template's KPI order.

        A numeric KPI is rounded to the company currency; a percentage KPI (a rate) is left as it is.
        An empty figure is 0.0. A KPI that cannot be computed is a template error (``UserError``).
        """
        template = self.env.ref(template_xmlid)
        aep = template._prepare_aep(company, company.currency_id)
        values = template.evaluate(aep, date_from, date_to, target_move='posted' if only_posted else 'all')
        amounts = []
        for kpi in template.kpi_ids:
            value = values.get(kpi.name)
            if isinstance(value, Exception):
                # mis_builder returns a failed KPI as a DataError value (not raised).
                raise UserError(self.env._('The figure %(kpi)s cannot be computed: %(error)r', kpi=kpi.name, error=value))
            amount = float(value or 0.0)
            amounts.append((kpi, company.currency_id.round(amount) if kpi.type == 'num' else amount))
        return template, amounts
