# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import AccessError, RedirectWarning, UserError

from odoo.addons.webvue_api.controllers.common import ApiError

SAUDI_CHART_TEMPLATE = 'sa'
COMPANY_IDENTITY_FIELDS = frozenset({'vat', 'company_registry', 'street', 'city', 'state_id', 'country_id'})
# The hard lock date is irreversible in stock Odoo, so it is never writable here.
COMPANY_FISCAL_FIELDS = frozenset({
    'fiscalyear_last_day', 'fiscalyear_last_month',
    'fiscalyear_lock_date', 'tax_lock_date', 'sale_lock_date', 'purchase_lock_date',
})


class WebVueFinanceSetup(models.AbstractModel):
    """The guided-setup actions.

    The controller has already checked ``finance.setup.manage``. Stock then refuses a caller who is not
    an administrator (``account.chart.template`` loads, ``res.company`` writes), so these two methods are
    the only elevated places in the module: the documented R7 case "finance setup (chart load, company
    tax identity)". Each acts on the current company only and nothing else.
    """
    _name = 'webvue.finance.setup'
    _description = 'WebVue finance guided setup'

    @api.model
    def _webvue_check_current_company(self, company):
        if len(company) != 1 or company != self.env.company:
            raise AccessError(self.env._('Finance setup only acts on the current company.'))

    @api.model
    def _webvue_load_chart(self, company):
        """Load the Saudi chart of accounts into the current company (sudo: R7 case "finance setup").

        Stock ``_load`` recurses into branches and replaces template records, so a company that has a
        chart, branches or journal entries is refused before anything is elevated.
        """
        self._webvue_check_current_company(company)
        chart_templates = self.env['account.chart.template'].sudo()
        # Counted in the elevated environment: stock recurses into branches and entries the caller cannot see.
        elevated = chart_templates.env
        if company.chart_template:
            raise ApiError(422, 'chart_already_loaded', 'the chart of accounts is already loaded')
        if elevated['res.company'].search_count([('parent_id', '=', company.id)], limit=1):
            raise ApiError(422, 'company_has_branches', 'the chart cannot be loaded into a company that has branches')
        if elevated['account.move'].search_count([('company_id', '=', company.id)], limit=1):
            raise ApiError(422, 'invalid', 'the chart cannot be loaded into a company that already has journal entries')
        chart_templates.try_loading(SAUDI_CHART_TEMPLATE, company.with_env(chart_templates.env))

    @api.model
    def _webvue_write_company(self, company, vals):
        """Write whitelisted tax-identity or fiscal fields of the current company (sudo: R7 case "finance setup")."""
        self._webvue_check_current_company(company)
        allowed = COMPANY_IDENTITY_FIELDS | COMPANY_FISCAL_FIELDS
        forbidden = sorted(set(vals) - allowed)
        if forbidden:
            raise AccessError(self.env._('Finance setup cannot write the field %s.', forbidden[0]))
        try:
            company.sudo().write(vals)
        except RedirectWarning as warning:
            # Stock offers an action link; the API only reports the reason.
            raise UserError(warning.args[0]) from None
