# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import UserError

from odoo.addons.phone_validation.tools.phone_validation import phone_format

# Arabic-Indic (U+0660..) and Eastern Arabic-Indic (U+06F0..) digits read as ASCII digits.
ARABIC_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')
DEFAULT_COUNTRY = 'base.sa'


class CrmLead(models.Model):
    _inherit = 'crm.lead'

    # Tracked per the spec: stage, agent, contact name, phone, email and lost reason are tracked by
    # stock crm; source, package, final price and discount are tracked here.
    source_id = fields.Many2one(tracking=True)
    webvue_package_id = fields.Many2one(
        'product.template', string='Package', index='btree_not_null', ondelete='restrict', tracking=True,
        domain=[('webvue_crm_package', '=', True)],
    )
    webvue_list_price = fields.Monetary(string='Package price', currency_field='company_currency')
    webvue_discount_percent = fields.Float(string='Discount (%)', tracking=True)
    webvue_final_price = fields.Monetary(string='Final price', currency_field='company_currency', tracking=True)
    # One source of truth: the expected revenue is the final price.
    expected_revenue = fields.Monetary(compute='_compute_expected_revenue', store=True, readonly=True)
    webvue_attempt_count = fields.Integer(string='Calls in this cycle', default=0, copy=False)
    webvue_next_call_at = fields.Datetime(string='Next call', index='btree_not_null', copy=False)
    webvue_cycle = fields.Integer(string='Recycle count', default=0, copy=False)
    webvue_recycle_at = fields.Datetime(string='Recycle on', index='btree_not_null', copy=False)
    webvue_needs_manager = fields.Boolean(string='Needs a manager decision', index=True, copy=False)

    @api.depends('webvue_final_price')
    def _compute_expected_revenue(self):
        for lead in self:
            lead.expected_revenue = lead.webvue_final_price

    @api.model
    def _webvue_normalize_phone(self, raw, company):
        """E.164 form of ``raw`` read in ``company``'s country (Saudi Arabia when unset), or False.

        A number without a country code is read as local. A number stock ``phone_validation``
        cannot parse as a valid number is invalid.
        """
        if not isinstance(raw, str) or not raw.strip():
            return False
        country = company.country_id or self.env.ref(DEFAULT_COUNTRY)
        try:
            return phone_format(
                raw.translate(ARABIC_DIGITS).strip(), country.code, country.phone_code,
                force_format='E164', raise_exception=True,
            )
        except UserError:
            return False

    @api.model
    def _webvue_find_duplicate(self, phone_e164, company):
        """Whether any opportunity of ``company`` (open, won, lost or archived) has this phone.

        The answer is a boolean only: no record, id or agent leaves this method, because the
        matching opportunity may be hidden from the caller by the visibility policy.
        """
        return self.sudo().with_context(active_test=False).search_count(
            [('company_id', '=', company.id), ('phone_sanitized', '=', phone_e164)], limit=1,
        ) > 0
