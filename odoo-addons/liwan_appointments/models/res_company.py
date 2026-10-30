# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

REFERENCE_SEQUENCE_CODE = 'liwan.appointment.booking'
REFERENCE_PADDING = 6


class ResCompany(models.Model):
    _inherit = 'res.company'

    @api.model_create_multi
    def create(self, vals_list):
        companies = super().create(vals_list)
        self._liwan_ensure_reference_sequences()
        return companies

    @api.model
    def _liwan_ensure_reference_sequences(self):
        """Give every company its own booking-reference counter (the number only; the prefix and year come from the settings).

        Run when a company is created and on every update of this addon. Ordinary booking users cannot create a
        ``ir.sequence``, so the counters exist before any booking needs one.
        """
        Sequence = self.env['ir.sequence']
        companies = self.with_context(active_test=False).search([])
        have = Sequence.search([('code', '=', REFERENCE_SEQUENCE_CODE), ('company_id', 'in', companies.ids)]).company_id
        Sequence.create([{
            'name': 'Appointment booking reference',
            'code': REFERENCE_SEQUENCE_CODE,
            'company_id': company.id,
            'padding': REFERENCE_PADDING,
        } for company in companies - have])
