# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import api, models
from odoo.exceptions import AccessError, RedirectWarning, UserError

from odoo.addons.webvue_api.controllers.common import ApiError

_logger = logging.getLogger(__name__)

SAUDI_CHART_TEMPLATE = 'sa'
SAUDI_COUNTRY_CODE = 'SA'
GLOBAL_TAX_ROUNDING = 'round_globally'
SETUP_MANAGE = 'finance.setup.manage'
# The hard lock date is irreversible in stock Odoo, so it is never writable here.
COMPANY_FISCAL_FIELDS = frozenset({
    'fiscalyear_last_day', 'fiscalyear_last_month',
    'fiscalyear_lock_date', 'tax_lock_date', 'sale_lock_date', 'purchase_lock_date',
    'tax_calculation_rounding_method',
})


class WebVueFinanceSetup(models.AbstractModel):
    """The guided-setup actions.

    Stock refuses a caller who is not an administrator (``account.chart.template`` loads, ``res.company``
    writes), so these two methods are the only elevated places in the module: the documented R7 case
    "finance setup (chart load, company fiscal settings)". Each checks ``finance.setup.manage`` itself before
    it elevates and acts on the current company only. Each success leaves a log record and an audit event
    (``webvue.finance.audit.event``) created in the caller's environment (no elevation).
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
        self.env['webvue.access.service']._webvue_require_capability(SETUP_MANAGE)
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
        if company.account_fiscal_country_id.code == SAUDI_COUNTRY_CODE:
            self._webvue_write_company(
                company,
                {'tax_calculation_rounding_method': GLOBAL_TAX_ROUNDING},
                log=False,
                audit=False,
            )
        _logger.info('finance.setup.chart_loaded company=%s user=%s template=%s', company.id, self.env.uid, SAUDI_CHART_TEMPLATE)
        self.env['webvue.finance.audit.event']._webvue_log('chart_loaded', company, outcome=SAUDI_CHART_TEMPLATE)

    @api.model
    def _webvue_write_company(self, company, vals, *, log=True, audit=True):
        """Write whitelisted fiscal fields of the current company (sudo: R7 case "finance setup")."""
        self.env['webvue.access.service']._webvue_require_capability(SETUP_MANAGE)
        self._webvue_check_current_company(company)
        vals = dict(vals)
        audit_vals = dict(vals)
        if company.account_fiscal_country_id.code == SAUDI_COUNTRY_CODE:
            vals['tax_calculation_rounding_method'] = GLOBAL_TAX_ROUNDING
        forbidden = sorted(set(vals) - COMPANY_FISCAL_FIELDS)
        if forbidden:
            raise AccessError(self.env._('Finance setup cannot write the field %s.', forbidden[0]))
        try:
            company.sudo().write(vals)
        except RedirectWarning as warning:
            # Stock offers an action link; the API only reports the reason.
            raise UserError(warning.args[0]) from None
        if log:
            _logger.info('finance.setup.company_written company=%s user=%s fields=%s', company.id, self.env.uid, ', '.join(sorted(vals)))
        if audit:
            self.env['webvue.finance.audit.event']._webvue_log('company_written', company, fields_written=audit_vals)
