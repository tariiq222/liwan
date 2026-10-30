# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models


class LiwanCrmViewLog(models.Model):
    """One opening of an opportunity's detail, written only while ``view_log_enabled`` is on."""

    _name = 'liwan.crm.view.log'
    _description = 'LiwanOS CRM view log'
    _order = 'viewed_at desc, id desc'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    user_id = fields.Many2one('res.users', required=True, index=True, ondelete='cascade')
    lead_id = fields.Many2one('crm.lead', required=True, index=True, ondelete='cascade')
    viewed_at = fields.Datetime(required=True, default=fields.Datetime.now)

    @api.model
    def _liwan_record(self, lead):
        if self.env['liwan.crm.settings']._liwan_effective()['view_log_enabled']:
            self.create({'company_id': lead.company_id.id, 'user_id': self.env.uid, 'lead_id': lead.id})
