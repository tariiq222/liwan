# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

REASON_KINDS = (('visit', 'Visit'), ('cancel', 'Cancel'))
# Applying a sector preset adds these visit reasons (English source name, Arabic name) to the company's list.
PRESET_VISIT_REASONS = {
    'clinic': (('Consultation', 'كشف'), ('Follow-up', 'متابعة'), ('Procedure', 'إجراء'), ('Lab', 'مختبر')),
}
SEED_ARABIC = 'ar_001'


class WebVueAppointmentReason(models.Model):
    """One entry of a company's visit-reason or cancel-reason list, picked on a booking."""

    _name = 'webvue.appointment.reason'
    _description = 'WebVue appointment reason'
    _order = 'sequence, id'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    kind = fields.Selection(REASON_KINDS, required=True)
    name = fields.Char(required=True, translate=True)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)

    @api.model
    def _webvue_seed_preset(self, preset, company):
        """Add the preset's visit reasons that ``company`` does not have yet, archived ones included. Never deletes."""
        english = self.with_context(lang='en_US', active_test=False)
        # The Arabic name is a translation, so it can only be written while Arabic is an active language.
        arabic_active = bool(self.env['res.lang']._get_code(SEED_ARABIC))
        present = set(english.search([('company_id', '=', company.id), ('kind', '=', 'visit')]).mapped('name'))
        reasons = PRESET_VISIT_REASONS.get(preset, ())
        for sequence, (name, arabic) in enumerate(reasons, start=1):
            if name in present:
                continue
            reason = english.create({'company_id': company.id, 'kind': 'visit', 'name': name, 'sequence': sequence * 10})
            if arabic_active:
                reason.with_context(lang=SEED_ARABIC).name = arabic
