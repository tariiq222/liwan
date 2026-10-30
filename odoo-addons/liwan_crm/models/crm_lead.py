# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import UserError

from odoo.addons.phone_validation.tools.phone_validation import phone_format

# Arabic-Indic (U+0660..) and Eastern Arabic-Indic (U+06F0..) digits read as ASCII digits.
ARABIC_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')
DEFAULT_COUNTRY = 'base.sa'
NAME_MAX = 200
EMAIL_MAX = 254


class CrmLead(models.Model):
    _inherit = 'crm.lead'

    # Tracked per the spec: stage, agent, contact name, phone, email and lost reason are tracked by
    # stock crm; source, package, final price and discount are tracked here.
    source_id = fields.Many2one(tracking=True)
    liwan_package_id = fields.Many2one(
        'product.template', string='Package', index='btree_not_null', ondelete='restrict', tracking=True,
        domain=[('liwan_crm_package', '=', True)],
    )
    liwan_list_price = fields.Monetary(string='Package price', currency_field='company_currency')
    liwan_discount_percent = fields.Float(string='Discount (%)', tracking=True)
    liwan_final_price = fields.Monetary(string='Final price', currency_field='company_currency', tracking=True)
    # One source of truth: the expected revenue is the final price.
    expected_revenue = fields.Monetary(compute='_compute_expected_revenue', store=True, readonly=True)
    liwan_attempt_count = fields.Integer(string='Calls in this cycle', default=0, copy=False)
    liwan_next_call_at = fields.Datetime(string='Next call', index='btree_not_null', copy=False)
    liwan_cycle = fields.Integer(string='Recycle count', default=0, copy=False)
    liwan_recycle_at = fields.Datetime(string='Recycle on', index='btree_not_null', copy=False)
    liwan_needs_manager = fields.Boolean(string='Needs a manager decision', index=True, copy=False)
    liwan_import_batch_id = fields.Many2one(
        'liwan.crm.import.batch', string='Import batch', index='btree_not_null', ondelete='set null', copy=False,
    )

    # One phone per company: the existence check answers early; this index decides under concurrency.
    _liwan_phone_company_unique = models.UniqueIndex(
        '(company_id, phone_sanitized) WHERE phone_sanitized IS NOT NULL',
        'duplicate phone',
    )
    _liwan_discount_range = models.Constraint(
        'CHECK(liwan_discount_percent BETWEEN 0 AND 100)', 'the discount is between 0 and 100 percent',
    )
    _liwan_list_price_positive = models.Constraint(
        'CHECK(liwan_list_price >= 0)', 'the package price cannot be negative',
    )
    _liwan_final_price_positive = models.Constraint(
        'CHECK(liwan_final_price >= 0)', 'the final price cannot be negative',
    )

    @api.depends('liwan_final_price')
    def _compute_expected_revenue(self):
        for lead in self:
            lead.expected_revenue = lead.liwan_final_price

    @api.model
    def _liwan_normalize_phone(self, raw, company):
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
    def _liwan_is_duplicate_phone(self, error):
        """Whether a UniqueViolation ``error`` comes from the one-phone-per-company index."""
        return error.diag.constraint_name == type(self)._liwan_phone_company_unique.full_name(self)

    @api.model
    def _liwan_find_duplicate(self, phone_e164, company):
        """Whether any opportunity of ``company`` (open, won, lost or archived) has this phone.

        The answer is a boolean only: no record, id or agent leaves this method, because the
        matching opportunity may be hidden from the caller by the visibility policy.
        """
        return self.sudo().with_context(active_test=False).search_count(
            [('company_id', '=', company.id), ('phone_sanitized', '=', phone_e164)], limit=1,
        ) > 0
