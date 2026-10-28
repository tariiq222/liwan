# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models


class WebVueCrmViewLog(models.Model):
    """One opening of an opportunity's detail, written only while ``view_log_enabled`` is on."""

    _name = 'webvue.crm.view.log'
    _description = 'WebVue CRM view log'
    _order = 'viewed_at desc, id desc'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    user_id = fields.Many2one('res.users', required=True, index=True, ondelete='cascade')
    lead_id = fields.Many2one('crm.lead', required=True, index=True, ondelete='cascade')
    viewed_at = fields.Datetime(required=True, default=fields.Datetime.now)

    @api.model
    def _webvue_record(self, lead):
        if self.env['webvue.crm.settings']._webvue_effective()['view_log_enabled']:
            self.create({'company_id': lead.company_id.id, 'user_id': self.env.uid, 'lead_id': lead.id})
