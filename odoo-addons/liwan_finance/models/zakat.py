# Part of Odoo. See LICENSE file for full copyright and licensing details.
import hashlib
import json

from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError

ADJUSTMENT_KINDS = [('add', 'Added to the base'), ('deduct', 'Deducted from the base')]


class LiwanFinanceZakatAdjustment(models.Model):
    """A figure a company adds to or deducts from the simplified Zakat base for a fiscal year end.

    The base template reads the books; what only the company knows (an exempt investment, a disallowed provision, an
    opening position agreed with its accountant) is entered here, with its label and note, instead of being buried in a formula.
    """
    _name = 'liwan.finance.zakat.adjustment'
    _description = 'LiwanOS finance Zakat base adjustment'
    _liwan_scope = 'company'
    _order = 'date_to desc, id'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    date_to = fields.Date(required=True, index=True, help='The end of the fiscal year the adjustment is for.')
    kind = fields.Selection(ADJUSTMENT_KINDS, required=True)
    label = fields.Char(required=True)
    amount = fields.Float(required=True, digits=(16, 2))
    note = fields.Text()

    @api.constrains('amount')
    def _check_amount(self):
        if any(record.amount <= 0 for record in self):
            raise ValidationError(self.env._('The amount of an adjustment must be above zero.'))


class LiwanFinanceZakatReview(models.Model):
    """An accountant's review of the Zakat computation of a fiscal year end, kept as it was when it was made.

    The row stores the figures that were reviewed and a fingerprint of everything they came from (the books' figures and the
    adjustments); when either changes the review is stale. Rows are never changed or deleted. A review says that someone with the
    review capability looked at the workpaper and gives their stated credential; it does not file anything and is not ZATCA's
    acceptance.
    """
    _name = 'liwan.finance.zakat.review'
    _description = 'LiwanOS finance Zakat computation review'
    _liwan_scope = 'company'
    _order = 'date_to desc, id desc'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    date_to = fields.Date(required=True, index=True)
    credential = fields.Char(required=True, help='The reviewer\'s professional credential, as they state it (for example the SOCPA licence).')
    note = fields.Text()
    base = fields.Float(digits=(16, 2))
    zakat_due = fields.Float(digits=(16, 2))
    fingerprint = fields.Char(required=True)

    def write(self, vals):
        msg = 'review_is_immutable'
        raise AccessError(msg)

    def unlink(self):
        msg = 'review_is_immutable'
        raise AccessError(msg)


class LiwanFinanceZakat(models.AbstractModel):
    _name = 'liwan.finance.zakat'
    _description = 'LiwanOS finance Zakat workpaper'

    @api.model
    def _liwan_template_figures(self, company, date_to, only_posted=True):
        """``(template, amounts, figures)`` of the base template for the fiscal year that ends at ``date_to``."""
        fiscal_start = company.compute_fiscalyear_dates(date_to)['date_from']
        template, amounts = self.env['liwan.finance.mis.report']._liwan_evaluate(
            'liwan_finance.mis_report_zakat_base', company, fiscal_start, date_to, only_posted, exclude_closing=True,
        )
        return template, amounts, {kpi.name: amount for kpi, amount in amounts}

    @api.model
    def _liwan_adjustments(self, company, date_to):
        return self.env['liwan.finance.zakat.adjustment'].search([('company_id', '=', company.id), ('date_to', '=', date_to)])

    @api.model
    def _liwan_fingerprint(self, figures, adjustments):
        payload = {
            'figures': sorted(figures.items()),
            'adjustments': sorted((item.kind, item.label, item.amount) for item in adjustments),
        }
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()

    @api.model
    def _liwan_workpaper(self, company, date_to, figures):
        """The figures of the base template with the adjustments applied: ``(adjustments, base, zakat_due, review, fingerprint)``.

        ``review`` is the latest review row or an empty recordset; it is current only when its fingerprint is ``fingerprint``.
        """
        currency = company.currency_id
        adjustments = self._liwan_adjustments(company, date_to)
        delta = sum(item.amount if item.kind == 'add' else -item.amount for item in adjustments)
        base = currency.round(figures['zakat_base'] + delta)
        zakat_due = currency.round(max(base, 0.0) * figures['zakat_rate'])
        review = self.env['liwan.finance.zakat.review'].search([('company_id', '=', company.id), ('date_to', '=', date_to)], limit=1)
        return adjustments, base, zakat_due, review, self._liwan_fingerprint(figures, adjustments)
