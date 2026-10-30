# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.fields import Domain


class MeetingRule(models.Model):
    _inherit = 'ir.rule'

    @api.model
    def _liwan_fresh_company_domain(self, model_name, mode):
        domain = super()._liwan_fresh_company_domain(model_name, mode)
        if self.env.su:
            return domain
        meeting_models = {
            'liwan.meeting.minute': False,
            'liwan.meeting.resolution': True,
            'liwan.meeting.event': True,
            'liwan.meeting.minutes.version': True,
        }
        if model_name not in meeting_models and model_name != 'liwan.meeting.series':
            return domain
        # Mutable grant predicates stay outside native ir.rule caches so both
        # inherited grants and revocations take effect without clearing that cache.
        company_ids = self.env['liwan.access.service']._liwan_scoped_company_ids()
        if model_name == 'liwan.meeting.series':
            visibility = self.env.user._liwan_meeting_series_access_domain(self.env.company.id, company_ids)
        else:
            visibility = self.env.user._liwan_meeting_access_domain(
                self.env.company.id, company_ids, resolution=meeting_models[model_name],
            )
        visibility = Domain(visibility)
        if mode != 'read' and model_name in {'liwan.meeting.minute', 'liwan.meeting.resolution'}:
            mutation = Domain(self.env.user._liwan_meeting_manager_domain(self.env.company.id, company_ids))
            if mode in {'create', 'write'}:
                prefix = 'meeting_id.' if model_name == 'liwan.meeting.resolution' else ''
                mutation |= Domain(prefix + 'organizer_id', '=', self.env.uid)
                mutation |= Domain(prefix + 'secretary_id', '=', self.env.uid)
                if prefix:
                    mutation |= Domain('responsible_id', '=', self.env.uid)
            visibility &= mutation
        return domain & visibility
