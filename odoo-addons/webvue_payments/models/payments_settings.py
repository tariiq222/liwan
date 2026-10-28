# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import AccessError
from odoo.tools import str2bool

from .access_service import SETTINGS_MANAGE

# Inclusive (min, max) minutes an unpaid online order may hold what it sells; the CHECK and the API parser read it.
EXPIRY_RANGE = (5, 1440)
DEFAULT_EXPIRY_MINUTES = 60
# Stock parameters, one value per database. Invoicing a paid order is a tenant setting (D4, on by default);
# asynchronous customer emails are fixed: the confirmation email renders a PDF, which must never run inside
# payment post-processing (spike F7).
AUTOMATIC_INVOICE = 'sale.automatic_invoice'
ASYNC_EMAILS = 'sale.async_emails'


def set_sale_parameters(env):
    """Install defaults of the stock sale parameters the orders section relies on (the stock records are noupdate).

    ``env`` is the superuser's: the install hook's or a migration's.
    """
    parameters = env['ir.config_parameter']
    parameters.set_param(ASYNC_EMAILS, 'True')
    parameters.set_param(AUTOMATIC_INVOICE, 'True')


class WebVuePaymentsSettings(models.Model):
    """The payments settings of one company. Without a row the declared defaults apply (revision 0)."""

    _name = 'webvue.payments.settings'
    _description = 'WebVue payments settings'

    company_id = fields.Many2one('res.company', required=True, ondelete='cascade', index=True)
    unpaid_order_expiry_minutes = fields.Integer(required=True, default=DEFAULT_EXPIRY_MINUTES)
    revision = fields.Integer(required=True, default=1)

    _company_unique = models.Constraint('UNIQUE(company_id)', 'a company has one payments settings record')
    _revision_positive = models.Constraint('CHECK(revision > 0)', 'a saved revision must be positive')
    _expiry_range = models.Constraint(
        'CHECK(unpaid_order_expiry_minutes BETWEEN %d AND %d)' % EXPIRY_RANGE,
        'unpaid_order_expiry_minutes must be between %d and %d' % EXPIRY_RANGE,
    )

    @api.model
    def _webvue_for(self, company):
        return self.search([('company_id', '=', company.id)], limit=1)

    @api.model
    def _webvue_expiry(self, company):
        """How long an unpaid online order of ``company`` holds what it sells."""
        row = self._webvue_for(company)
        return timedelta(minutes=row.unpaid_order_expiry_minutes if row else DEFAULT_EXPIRY_MINUTES)

    @api.model
    def _webvue_require_manager(self):
        if not self.env['webvue.access.service']._webvue_has_capability(
            self.env.user, SETTINGS_MANAGE, company=self.env.company,
        ):
            raise AccessError(self.env._('forbidden'))

    @api.model
    def _webvue_invoice_when_paid(self):
        """Whether stock invoices and posts a paid online order at once (one value for the whole tenant)."""
        self._webvue_require_manager()
        # ir.config_parameter is system-only; this reads the one whitelisted key after the capability check.
        return str2bool(self.env['ir.config_parameter'].sudo().get_param(AUTOMATIC_INVOICE, 'False'))

    @api.model
    def _webvue_set_invoice_when_paid(self, value):
        self._webvue_require_manager()
        self.env['ir.config_parameter'].sudo().set_param(AUTOMATIC_INVOICE, 'True' if value else 'False')
