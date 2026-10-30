# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import api, models
from odoo.exceptions import AccessError, RedirectWarning, UserError

from .res_company import GLOBAL_TAX_ROUNDING, SAUDI_COUNTRY_CODE

_logger = logging.getLogger(__name__)

SETUP_MANAGE = 'finance.setup.manage'
# The hard lock date is irreversible in stock Odoo, so it is never writable here.
COMPANY_FISCAL_FIELDS = frozenset({
    'fiscalyear_last_day', 'fiscalyear_last_month',
    'fiscalyear_lock_date', 'tax_lock_date', 'sale_lock_date', 'purchase_lock_date',
    'tax_calculation_rounding_method',
})


class LiwanFinanceSetup(models.AbstractModel):
    """The guided-setup action: the company's fiscal settings.

    The chart of accounts is not a setup step: provisioning makes the root company Saudi before ``account``
    installs, so stock loads the ``sa`` chart, and stock loads the root's chart into every new branch.

    Stock refuses a ``res.company`` write to a caller who is not an administrator, so the write below is the
    elevated place in this file: the documented R7 case "finance setup (company fiscal settings)". It checks
    ``finance.setup.manage`` itself before it elevates and acts on the current company only. Each success
    leaves a log record and an audit event (``liwan.finance.audit.event``) created in the caller's
    environment (no elevation).
    """
    _name = 'liwan.finance.setup'
    _description = 'LiwanOS finance guided setup'

    @api.model
    def _liwan_check_current_company(self, company):
        if len(company) != 1 or company != self.env.company:
            raise AccessError(self.env._('Finance setup only acts on the current company.'))

    @api.model
    def _liwan_write_company(self, company, vals):
        """Write whitelisted fiscal fields of the current company (sudo: R7 case "finance setup")."""
        self.env['liwan.access.service']._liwan_require_capability(SETUP_MANAGE)
        self._liwan_check_current_company(company)
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
        _logger.info('finance.setup.company_written company=%s user=%s fields=%s', company.id, self.env.uid, ', '.join(sorted(vals)))
        self.env['liwan.finance.audit.event']._liwan_log('company_written', company, fields_written=audit_vals)
